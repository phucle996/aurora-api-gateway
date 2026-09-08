import http from 'node:http';
import dns from 'node:dns/promises';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execAsync=promisify(execFile);
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from '../ui/node_modules/playwright-core/index.mjs';
const dir=`build/domain-upstream-audit-${Date.now()}`;mkdirSync(dir,{recursive:true});
const token=execFileSync('docker',['exec','aurora-controller','cat','/data/admin.token'],{encoding:'utf8'}).trim();
const report={started:new Date().toISOString(),checks:[],traffic:[],issues:[]};
const domains=[],upstreams=[],backends=[];let browser;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(method,path,body,status=200){const r=await fetch('http://localhost:8080'+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});const text=await r.text();assert.equal(r.status,status,`${method} ${path}: ${text}`);return text?JSON.parse(text):null;}
async function request(host,port,path,method='GET',body='',resolve=false){return new Promise((resolveResult,reject)=>{const req=http.request({hostname:host,port,path,method,agent:false,timeout:5000,...(resolve?{lookup:(_h,_o,cb)=>cb(null,[{address:'127.0.0.1',family:4}])}:{}),headers:{'Content-Type':'text/plain'}},r=>{let text='';r.on('data',x=>text+=x);r.on('end',()=>resolveResult({status:r.statusCode,body:text,headers:r.headers}));r.on('error',reject)});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('timeout')));req.end(body);});}
try{
 const network=JSON.parse(execFileSync('docker',['inspect','aurora-node-01'],{encoding:'utf8'}))[0].NetworkSettings.Networks;
 const gateway=Object.entries(network).find(([name])=>name.endsWith('_default'))[1].Gateway;
 for(const label of ['A','B']){const b={label,hits:0,server:null,port:0};b.server=http.createServer((req,res)=>{b.hits++;let body='';req.on('data',x=>body+=x);req.on('end',()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({backend:label,method:req.method,url:req.url,host:req.headers.host,body}));});});await new Promise(r=>b.server.listen(0,'0.0.0.0',r));b.port=b.server.address().port;backends.push(b);}
 const pool={name:'audit_origin_'+Date.now(),architecture_type:'Load Balancer',algorithm:'round_robin',servers:backends.map((b,i)=>({id:`server-${i}`,address:`${gateway}:${b.port}`,weight:1,maxFails:1,failTimeout:'1s',healthy:true})),internal_ssl:{enabled:false,verifyCert:false},probes:[],transport:{httpVersion:'HTTP/1.1',keepAliveConnections:16,enableWebSocket:false,enableSse:false,enableGrpc:false}};
 const u=await api('POST','/api/v1/upstreams',pool,201);upstreams.push(u.id);report.checks.push('create upstream pool');
 for(const host of ['domain-a.aurora.test','domain-b.aurora.test']){const d=await api('POST','/api/v1/domains',{domain:host,upstream:pool.name,status:'Active',tls_type:'Self-signed',description:'E2E audit fixture'},201);domains.push(d.id);}
 report.checks.push('create two domains bound to pool');
 assert.equal((await api('GET',`/api/v1/upstreams/${u.id}`)).bound_domains_count,2);report.checks.push('bound domain count is two');
 const renamed={...pool,name:pool.name+'_renamed'};await api('PUT',`/api/v1/upstreams/${u.id}`,renamed);
 for(const id of domains)assert.equal((await api('GET',`/api/v1/domains/${id}`)).upstream,renamed.name);report.checks.push('pool rename updates domain references');
 const snapshotResponse=await fetch('http://localhost:8080/api/v1/domain-routing/node-01',{headers:{Authorization:`Bearer ${token}`}});
 assert.equal(snapshotResponse.status,200);const routingText=await snapshotResponse.text();
 assert.ok(routingText.includes('server_name domain-a.aurora.test;') && routingText.includes('proxy_pass http://aurora_route_'));
 report.checks.push('complete domain routing snapshot');
 await sleep(10000);
 for(const b of backends){const {stdout:raw}=await execAsync('docker',['exec','aurora-node-01','curl','--max-time','5','-sS',`http://${gateway}:${b.port}/direct-check`],{encoding:'utf8',timeout:7000});assert.equal(JSON.parse(raw).backend,b.label);}report.checks.push('node can directly reach both real backends');
 for(const host of ['domain-a.aurora.test','domain-b.aurora.test']){
  let configured=readFileSync('/etc/hosts','utf8').split('\n').some(line=>line.trim().startsWith('127.0.0.1 ') && line.split(/\s+/).includes(host));if(configured)assert.equal((await dns.lookup(host)).address,'127.0.0.1');
  report.checks.push(`${host}: ${configured?'system resolver /etc/hosts':'temporary resolver override; /etc/hosts pending'}`);
  for(const port of [8090,8091,8092,8093]){
   for(const path of ['/ok','/echo?test=1']){const r=await request(host,port,path,'GET','',!configured);report.traffic.push({host,port,path,...r});}
  }
  const post=await request(host,8090,'/echo','POST','audit-body',!configured);report.traffic.push({host,port:8090,path:'/echo',method:'POST',...post});
 }
 const proxied=report.traffic.filter(x=>x.body.includes('"backend":'));assert.equal(proxied.length,18,'all domain GET/POST requests must reach an origin');
 for(const r of report.traffic){assert.equal(r.status,200);const body=JSON.parse(r.body);assert.equal(body.url,r.path);assert.equal(body.host,r.host);if(r.method==='POST')assert.equal(body.body,'audit-body');}
 report.checks.push('18 real GET/POST requests preserve host, path, query and body across LB and 3 nodes');
 // Unknown binding and duplicate domain are checked using separate temporary records.
 const bad=await fetch('http://localhost:8080/api/v1/domains',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({domain:'invalid-binding.aurora.test',upstream:'pool-that-does-not-exist',tls_type:'Self-signed'})});
 const badData=await bad.json();if(bad.status===201){domains.push(badData.id);report.issues.push('Domain accepts a nonexistent upstream.');}else report.checks.push('nonexistent upstream rejected');
 await api('PUT',`/api/v1/domains/${domains[0]}`,{upstream:renamed.name,status:'Inactive',tls_type:'Self-signed'});assert.equal((await api('GET',`/api/v1/domains/${domains[0]}`)).status,'Inactive');report.checks.push('domain status update persists');

 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1500,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(t=>{localStorage.setItem('aurora_admin_token',t);localStorage.setItem('aurora_admin_user',JSON.stringify({id:'operator',username:'operator',role:'admin'}));},token);
 await page.goto('http://localhost:8080/domains');await page.getByText('domain-a.aurora.test',{exact:true}).first().waitFor();await page.screenshot({path:`${dir}/domains.png`,fullPage:true});report.browserErrors=errors;
 report.browserDomainRequests=[];
 for(const host of ['domain-a.aurora.test','domain-b.aurora.test']) {
  const configured=readFileSync('/etc/hosts','utf8').split('\n').some(line=>line.trim().startsWith('127.0.0.1 ') && line.split(/\s+/).includes(host));
  if(!configured)continue;
  const response=await page.goto(`http://${host}:8090/echo?browser=1`);
  report.browserDomainRequests.push({url:page.url(),status:response.status(),body:await page.locator('body').innerText()});
  await page.screenshot({path:`${dir}/${host}.png`,fullPage:true});
 }
 report.hostsTestCompleted=report.checks.filter(x=>x.includes('system resolver /etc/hosts')).length===2;
 const deletion=await fetch(`http://localhost:8080/api/v1/upstreams/${u.id}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`}});if(deletion.ok){upstreams.splice(upstreams.indexOf(u.id),1);report.issues.push('Deleting an upstream with bound domains succeeds and leaves dangling references.');}else report.checks.push('bound upstream deletion rejected');

 // Restore active routing, then observe changes through real requests on every node.
 await api('PUT',`/api/v1/domains/${domains[0]}`,{upstream:renamed.name,status:'Active',tls_type:'Self-signed'});
 async function settledBackend(expected) {
  const deadline=Date.now()+45000;
  while(Date.now()<deadline){
   const replies=await Promise.all([8090,8091,8092,8093].map(port=>request('domain-a.aurora.test',port,'/runtime-check')));
   if(replies.every(r=>r.status===200 && JSON.parse(r.body).backend===expected))return;
   await sleep(500);
  }
  throw Error(`routing did not settle to backend ${expected}`);
 }
 for(const b of backends){
  await api('PUT',`/api/v1/upstreams/${u.id}`,{...renamed,servers:[{id:b.label,address:`${gateway}:${b.port}`,weight:1,maxFails:0}]});
  await settledBackend(b.label);
 }
 report.checks.push('pool target updates reach all nodes and LB');
 // Direct origin binding is independent of the named pool.
 await api('PUT',`/api/v1/domains/${domains[0]}`,{upstream:`http://${gateway}:${backends[0].port}`,status:'Active',tls_type:'Self-signed'});
 await settledBackend('A');
 report.checks.push('direct origin binding reaches backend A');
 await api('PUT',`/api/v1/domains/${domains[0]}`,{upstream:renamed.name,status:'Active',tls_type:'Self-signed'});
 await settledBackend('B');
 // Invalid runtime text must be rejected without changing the working route.
 await api('PUT',`/api/v1/upstreams/${u.id}`,{...renamed,servers:[{id:'bad',address:'127.0.0.1;return 200;',weight:1}]},400);
 await settledBackend('B');report.checks.push('invalid upstream update preserves working route');
 // A syntactically safe but unresolvable origin fails nginx -t; the old route survives.
 await api('PUT',`/api/v1/upstreams/${u.id}`,{...renamed,servers:[{id:'unresolvable',address:'routing-test-does-not-exist.invalid:8080',weight:1}]});
 await sleep(6000);await settledBackend('B');
 const validationLog=(await execAsync('docker',['exec','aurora-node-01','cat','/var/lib/aurora-routing/routing-validation.log'],{encoding:'utf8'})).stdout;
 assert.ok(validationLog.includes('host not found'),'node must reject the unresolved origin during validation');
 await api('PUT',`/api/v1/upstreams/${u.id}`,{...renamed,servers:[{id:'B',address:`${gateway}:${backends[1].port}`,weight:1,maxFails:0}]});
 await settledBackend('B');report.checks.push('failed nginx validation preserves last working route and recovers');
 // A dead primary falls back to the configured backup for idempotent GETs.
 await api('PUT',`/api/v1/upstreams/${u.id}`,{...renamed,algorithm:'least_conn',servers:[{id:'dead',address:`${gateway}:1`,weight:1,maxFails:1,failTimeout:'1s'},{id:'backup',address:`${gateway}:${backends[0].port}`,weight:1,backup:true}]});
 await settledBackend('A');report.checks.push('least_conn with unavailable primary uses backup');
 await api('PUT',`/api/v1/upstreams/${u.id}`,{...renamed,servers:[{id:'B',address:`${gateway}:${backends[1].port}`,weight:1,maxFails:0}]});
 await settledBackend('B');
 const activePolicy=JSON.parse((await execAsync('docker',['exec','aurora-node-01','cat','/var/lib/aurora-policy/active-policy.json'],{encoding:'utf8'})).stdout);
 const blockedPath=activePolicy.policies?.find(p=>p.host==='*')?.rules?.find(r=>r.action==='block')?.path ?? activePolicy.block_paths?.[0];
 assert.ok(blockedPath,'a published blocking rule is required for the WAF regression check');
 const baseline=await request('localhost',8091,blockedPath);
 const routedBlock=await request('domain-a.aurora.test',8091,blockedPath);
 assert.equal(baseline.status,403,'WAF baseline must enforce the published blocking policy');
 assert.equal(routedBlock.status,403,'domain proxy must preserve WAF enforcement');
 report.checks.push('WAF blocks requests before proxying to origin');
 // Browser create/edit must survive reload and be present in SQLite-backed APIs.
 await page.goto('http://localhost:8080/domains/create');
 await page.getByLabel('Domain hostname').fill('browser-routing.aurora.test');
 await page.getByLabel('Upstream pool or direct origin URL').fill(renamed.name);
 await page.getByRole('button',{name:'Create Domain',exact:true}).click();
 await page.waitForURL('**/domains');
 const createdByUI=(await api('GET','/api/v1/domains?limit=100')).items.find(d=>d.domain==='browser-routing.aurora.test');
 assert.ok(createdByUI,'browser create must persist to API');domains.push(createdByUI.id);
 await page.goto(`http://localhost:8080/domains/${createdByUI.id}/edit`);
 await page.getByLabel('Description').fill('Saved by browser E2E');
 await page.getByRole('button',{name:'Save Domain',exact:true}).click();await page.waitForURL('**/domains');
 await page.reload();assert.equal((await api('GET',`/api/v1/domains/${createdByUI.id}`)).description,'Saved by browser E2E');
 report.checks.push('browser create and edit persist across reload');
 assert.deepEqual(errors,[],'browser must have no uncaught errors');
 // Continuous traffic while changing the authoritative pool configuration.
 const load={requests:0,errors:0,statuses:{},backends:{},changes:0,durationMs:0};
 const loadStart=Date.now(),loadEnd=loadStart+60000;
 const workers=Array.from({length:64},async()=>{
  while(Date.now()<loadEnd){
   try{const r=await request('domain-a.aurora.test',8090,'/load?runtime=1');load.requests++;load.statuses[r.status]=(load.statuses[r.status]||0)+1;
    if(r.status!==200){load.errors++;continue;}const parsed=JSON.parse(r.body);assert.ok(['A','B'].includes(parsed.backend));load.backends[parsed.backend]=(load.backends[parsed.backend]||0)+1;
   }catch{load.errors++;}
  }
 });
 const churn=(async()=>{let i=0;while(Date.now()<loadEnd-5000){const b=backends[i++%2];await api('PUT',`/api/v1/upstreams/${u.id}`,{...renamed,servers:[{id:b.label,address:`${gateway}:${b.port}`,weight:1,maxFails:0}]});load.changes++;await sleep(5000);}})();
 await Promise.all([...workers,churn]);load.durationMs=Date.now()-loadStart;report.runtimeLoad=load;
 assert.equal(load.errors,0,'continuous runtime churn must not lose traffic');assert.ok(load.backends.A>0 && load.backends.B>0);
 report.checks.push('60 seconds continuous traffic with pool updates every 5 seconds');
 report.backendHits=backends.map(b=>({label:b.label,hits:b.hits}));
 console.log(JSON.stringify({checks:report.checks,issues:report.issues,runtimeLoad:report.runtimeLoad,backendHits:report.backendHits},null,2));
}catch(e){report.error=String(e.stack);console.error(report.error);process.exitCode=1;}
finally{
 if(browser)await browser.close();
 for(const id of domains){try{await api('DELETE',`/api/v1/domains/${id}`);}catch(e){report.issues.push(`Cleanup domain ${id}: ${e}`);}}
 for(const id of upstreams){try{await api('DELETE',`/api/v1/upstreams/${id}`);}catch(e){report.issues.push(`Cleanup upstream ${id}: ${e}`);}}
 for(const b of backends){b.server.closeAllConnections();await new Promise(r=>b.server.close(r));}
 report.pass=!report.error && report.issues.length===0;if(!report.pass)process.exitCode=1;
 report.finished=new Date().toISOString();writeFileSync(`${dir}/results.json`,JSON.stringify(report,null,2));console.log('EVIDENCE',`${dir}/results.json`);
}
