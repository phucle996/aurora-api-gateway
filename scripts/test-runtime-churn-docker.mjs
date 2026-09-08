import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import http from 'node:http';
const dir=`build/runtime-churn-${Date.now()}`;mkdirSync(dir,{recursive:true});
const token=execFileSync('docker',['exec','aurora-controller','cat','/data/admin.token'],{encoding:'utf8'}).trim();
const base='http://127.0.0.1:8080',host=`churn-${Date.now()}.test`;
const seconds=Number(process.env.CHURN_SECONDS||300),rate=Number(process.env.CHURN_RPS||10000);
assert.ok(Number.isInteger(seconds)&&seconds>=30&&Number.isInteger(rate)&&rate>0,'invalid load parameters');
const report={started:new Date().toISOString(),host,seconds,offeredRps:rate,cycles:[],loads:[],samples:[]};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let rule,policy,version=1,children=[];
const recover=process.env.CHURN_RECOVERY==='1';
async function api(method,path,body,key=crypto.randomUUID(),status=200){const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':key},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});const text=await r.text();assert.equal(r.status,status,`${method} ${path}: ${text}`);return JSON.parse(text);}
function probe(port,path,hostname=host){return new Promise((resolve,reject)=>{const q=http.get({hostname:'127.0.0.1',port,path,headers:{Host:hostname},agent:false,timeout:3000},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));r.on('error',reject)});q.on('error',reject);q.on('timeout',()=>q.destroy(Error('probe timeout')));});}
async function settle(status,release){const begin=Date.now();let last;while(Date.now()-begin<25000){last=await Promise.all([8091,8092,8093].map(p=>probe(p,'/ok')));if(last.every(s=>s===status)){for(let i=0;i<5;i++){const checks=await Promise.all([8090,8091,8092,8093].map(p=>probe(p,'/ok')));if(!checks.every(s=>s===status)){last=checks;break;}if(i===4)return Date.now()-begin;} }await sleep(250);}throw Error(`release ${release} did not converge to ${status}: ${last}`);}
function load(name,path,hostname,rps){const targets=`${dir}/${name}.targets`;writeFileSync(targets,`GET http://127.0.0.1:8090${path}\nHost: ${hostname}\n\n`);const attack=spawn('/home/phucle/.local/bin/trunks',['attack','--name',name,'--targets',targets,'--duration',`${seconds}s`,'--rate',`${rps}/1s`,'--workers','64','--max-workers','512','--timeout','3s','--max-body','0'],{stdio:['ignore','pipe','pipe'],env:{...process.env,TOKIO_WORKER_THREADS:'4'}});const summary=spawn('/home/phucle/.local/bin/trunks',['report','--report-type','json'],{stdio:['pipe','pipe','pipe']});summary.stdin.on('error',()=>{});attack.stdout.pipe(summary.stdin);let output='',errors='';summary.stdout.on('data',d=>output+=d);attack.stderr.on('data',d=>errors+=d);summary.stderr.on('data',d=>errors+=d);children.push(attack,summary);return new Promise((resolve,reject)=>{summary.on('close',code=>{try{assert.equal(code,0,errors);const data=JSON.parse(output);writeFileSync(`${dir}/${name}.json`,output);report.loads.push({name,...data});resolve(data)}catch(e){reject(e)}});attack.on('error',reject);summary.on('error',reject);});}
const logReader=spawn('docker',['logs','--follow','--tail','0','aurora-lb'],{stdio:['ignore','pipe','pipe']});
report.lbErrors=[];report.lb502BySecond={};
for(const stream of [logReader.stdout,logReader.stderr]){
 let buffer='';stream.on('data',data=>{buffer+=data;const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines){
  if(/\[(error|warn|alert)\]/.test(line)&&report.lbErrors.length<30)report.lbErrors.push(line);
  if(line.includes('" 502 ')){const time=line.match(/\[([^\]]+)\]/)?.[1]||'unknown';report.lb502BySecond[time]=(report.lb502BySecond[time]||0)+1;}
 }});
}
const draft={name:host,description:'Temporary runtime churn audit',host,path_prefix:'/',mode:'mixed',priority:1,rule_ids:[]};
try{
 report.originalPolicies=await api('GET','/api/v1/policies');
 rule=(await api('POST','/api/v2/rules',{name:host,group:'custom',severity:'low',score:0,priority:1,enabled:true,logic_mode:'all',conditions:[{field:'path',operator:'equals',value:'/ok'}],action:'block',response_code:403,log_event:false,add_to_reputation:false},undefined,201)).id;
 draft.rule_ids=[Number(rule)];policy=(await api('POST','/api/v1/policies',{...draft,expected_version:0})).id;
 let head=await api('GET','/api/v1/policies/cluster');
 let published=await api('POST',`/api/v1/policies/${policy}/publish`,{expected_version:version,expected_release:head.release_id,disable:false});
 const initial=await settle(403,published.release_id);console.log('Initial publish converged',initial,'ms');
 const end=Date.now()+seconds*1000;
 const jobs=[load('normal','/ok','normal-churn.test',Math.floor(rate*.7)),load('dynamic','/ok',host,Math.ceil(rate*.3))];
 // Consume failures immediately while keeping cleanup in this workflow.
 jobs.forEach(p=>p.catch(()=>{}));
 let cycle=0;
 while(Date.now()<end-12000){
  const start=Date.now();const mode=cycle%2===0?'detect':'mixed';
  await api('PUT',`/api/v1/policies/${policy}`,{...draft,mode,expected_version:version});version++;
  head=await api('GET','/api/v1/policies/cluster');
  const command={expected_version:version,expected_release:head.release_id,disable:false};const key=crypto.randomUUID();
  published=await api('POST',`/api/v1/policies/${policy}/publish`,command,key);
  const replay=await api('POST',`/api/v1/policies/${policy}/publish`,command,key);assert.equal(replay.release_id,published.release_id);
  const ms=await settle(mode==='detect'?200:403,published.release_id);
  const cluster=await api('GET','/api/v1/policies/cluster');
  report.cycles.push({cycle:++cycle,mode,release:published.release_id,convergenceMs:ms,totalMs:Date.now()-start,nodes:cluster.nodes});
  const normal=await Promise.all([8090,8091,8092,8093].map(p=>probe(p,'/ok','normal-churn.test')));assert.ok(normal.every(s=>s===200),'normal host was affected');
  console.log(JSON.stringify({cycle,mode,convergenceMs:ms,remainingSeconds:Math.round((end-Date.now())/1000),phases:cluster.nodes.map(n=>n.phase)}));
  if(recover && cycle===3){
    const t=Date.now();execFileSync('docker',['restart','aurora-controller'],{stdio:'ignore'});
    let ready=false;for(let i=0;i<40;i++){try{if((await fetch(base+'/readyz')).status===200){ready=true;break}}catch{}await sleep(250)}assert.ok(ready,'controller failed to recover');
    await settle(mode==='detect'?200:403,published.release_id);report.samples.push({recovery:'controller restart',ms:Date.now()-t});console.log('RECOVERED controller restart');
  }
  if(recover && cycle===6){
    for(const node of ['aurora-node-01','aurora-node-02','aurora-node-03'])execFileSync('docker',['exec',node,'/opt/nginx/usr/sbin/nginx','-s','reload'],{stdio:'ignore'});
    await settle(mode==='detect'?200:403,published.release_id);report.samples.push({recovery:'three node SIGHUP reload'});console.log('RECOVERED three node reload');
  }
  if(cycle%3===0){report.samples.push({at:new Date().toISOString(),stats:execFileSync('docker',['stats','--no-stream','--format','{{json .}}','aurora-controller','aurora-node-01','aurora-node-02','aurora-node-03','aurora-lb'],{encoding:'utf8'})});}
  await sleep(Math.max(0,10000-(Date.now()-start)));
 }
 const results=await Promise.all(jobs);
 for(let i=0;i<results.length;i++){const r=results[i],allowed=i===0?['200']:['200','403'];const invalid=Object.entries(r.status_codes||{}).filter(([code])=>!allowed.includes(code)).reduce((sum,[,n])=>sum+n,0);assert.equal(invalid,0,`unexpected status in ${i}: ${JSON.stringify(r.status_codes)}`);assert.equal(r.requests,Object.values(r.status_codes).reduce((a,b)=>a+b,0));if(i===1){assert.ok(r.status_codes['200']>0 && r.status_codes['403']>0,'load did not exercise both runtime modes');}}
 const after=await api('GET','/api/v1/policies');
 for(const original of report.originalPolicies.filter(p=>!p.document.name.startsWith('churn-'))){assert.deepEqual(after.find(p=>p.id===original.id),original,'existing policy changed during audit');}
 report.pass=true;
}catch(e){report.pass=false;report.error=String(e.stack);console.error(report.error);process.exitCode=1;}
finally{
 logReader.kill('SIGTERM');
 for(const child of children)if(child.exitCode===null)child.kill('SIGTERM');
 if(policy){try{const head=await api('GET','/api/v1/policies/cluster');const out=await api('POST',`/api/v1/policies/${policy}/publish`,{expected_version:version,expected_release:head.release_id,disable:true});await settle(200,out.release_id);await api('PUT',`/api/v1/policies/${policy}`,{...draft,mode:'detect',rule_ids:[],expected_version:version});report.cleanup='test policy disabled and detached';}catch(e){report.cleanupError=String(e);process.exitCode=1;}}
 if(rule&&!report.cleanupError){try{await api('DELETE',`/api/v1/rules/${rule}`,{expected_version:1});}catch(e){report.ruleCleanupError=String(e);process.exitCode=1;}}
 if(report.cleanupError||report.ruleCleanupError)report.pass=false;
 report.finished=new Date().toISOString();writeFileSync(`${dir}/results.json`,JSON.stringify(report,null,2));console.log('EVIDENCE',`${dir}/results.json`);
}
