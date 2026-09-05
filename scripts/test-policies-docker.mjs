// Real, isolated Docker cluster; never targets the user's named containers/volumes.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import path from 'node:path';
import http from 'node:http';
import {chromium} from '../ui/node_modules/playwright-core/index.mjs';

mkdirSync('build/policy-tests',{recursive:true});
const dir=mkdtempSync(path.resolve('build/policy-tests/docker-'));
const project=`aurora-policy-test-${Date.now()}`;
const token=randomBytes(32).toString('hex');
const compose=path.join(dir,'compose.json');
const services={controller:{image:'aurora-policies-controller:test',environment:{AURORA_DEFAULT_ADMIN_TOKEN:token},ports:['127.0.0.1::8080'],volumes:['db:/data']}};
const volumes={db:{}};
for(let i=1;i<=3;i++){const id=`node-0${i}`;volumes[id]={};services[id]={image:'aurora-policies-node:test',environment:{CONTROLLER_URL:'http://controller:8080',NODE_ID:id,AUTH_TOKEN:token,HEARTBEAT_INTERVAL:'1'},ports:['127.0.0.1::80'],volumes:[`${id}:/var/lib/aurora-policy`]};}
writeFileSync(compose,JSON.stringify({services,volumes}),{mode:0o600});
const result={project,checks:[],started:new Date().toISOString()};
function dc(...args){const r=spawnSync('docker',['compose','-p',project,'-f',compose,...args],{encoding:'utf8',timeout:60000});if(r.status!==0)throw Error(`Docker ${args[0]} failed: ${r.stderr}`);return r.stdout.trim();}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(label,predicate){let lastError;for(let i=0;i<90;i++){try{if(await predicate()){result.checks.push(label);console.log('PASS',label);return}}catch(e){lastError=e}await sleep(500)}throw Error(`Timed out: ${label}${lastError?`: ${lastError}`:''}`)}
let base,browser;
async function api(method,url,body,key=randomUUID()){const r=await fetch(base+url,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':key},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(5000)});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;}
try{
 dc('up','-d');base=`http://${dc('port','controller','8080')}`;
 const nodes=[1,2,3].map(i=>`http://${dc('port',`node-0${i}`,'80')}`);
 await wait('controller ready',async()=> (await fetch(base+'/readyz')).status===200);
 await wait('three registered nodes',async()=> (await api('GET','/api/v1/policies/cluster')).nodes.length===3);
 const ruleResponse=await fetch(base+'/api/v1/rules',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify({name:'Docker protected path',description:'fixture',group:'endpoint',action:'block',severity:'high',score:5,priority:1,path:'/ok',enabled:true})});assert.equal(ruleResponse.status,201);const rule=await ruleResponse.json();
 // Exercise the actual embedded React workflow in a browser, not a mocked API.
 browser=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/google-chrome',headless:true});
 const page=await browser.newPage();await page.goto(base+'/login');
 await page.evaluate(t=>{localStorage.setItem('aurora_admin_token',t);localStorage.setItem('aurora_admin_user',JSON.stringify({id:'operator',username:'operator',role:'admin'}))},token);
 await page.goto(base+'/policies/create');await page.getByLabel('Name',{exact:true}).fill('Docker UI policy');
 await page.getByLabel('Host (* for all)',{exact:true}).fill('protected.test');
 await page.getByLabel(/Docker protected path/).check();await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await page.waitForURL('**/policies');await page.getByRole('cell',{name:'Docker UI policy',exact:true}).click();
 await page.getByRole('button',{name:'Preview cluster changes'}).click();await page.getByText('Compiled preview — not applied').waitFor();
 page.on('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Publish policy',exact:true}).click();
 let head;await wait('UI publish observed by all three agents',async()=>{head=await api('GET','/api/v1/policies/cluster');return head.release_id>0&&head.nodes.length===3&&head.nodes.every(n=>n.phase==='observed'&&n.release_id===head.release_id)});
 const policy=(await api('GET','/api/v1/policies'))[0];
 async function verify(status){
  for(const node of nodes){
   for(const host of ['protected.test','other.test']){
    // Node fetch replaces Host with the URL authority. Use HTTP directly so
    // these requests actually exercise the published virtual-host scope.
    const actual=await new Promise((resolve,reject)=>{
     const request=http.get(node+'/ok',{agent:false,headers:{Host:host},timeout:5000},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));response.on('error',reject)});
     request.on('error',reject);request.on('timeout',()=>request.destroy(Error('traffic probe timed out')));
    });
    assert.equal(actual,host==='protected.test'?status:200,`${node} Host=${host}`);
   }
  }
 }
 await verify(403);result.checks.push('host-scoped enforcement on all Docker nodes');
 await page.getByRole('link',{name:'Edit draft',exact:true}).click();await page.getByRole('combobox',{name:/^Mode/}).selectOption('detect');await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.waitForURL('**/policies');
 await verify(403);result.checks.push('editing draft leaves published traffic unchanged');
 await page.getByRole('cell',{name:'Docker UI policy',exact:true}).click();await page.getByRole('button',{name:'Preview cluster changes'}).click();await page.getByText('Compiled preview — not applied').waitFor();await page.getByRole('button',{name:'Publish policy',exact:true}).click();
 const oldHead=head.release_id;await wait('detect revision observed',async()=>{head=await api('GET','/api/v1/policies/cluster');return head.release_id>oldHead&&head.nodes.every(n=>n.phase==='observed'&&n.release_id===head.release_id)});await verify(200);
 await api('PUT',`/api/v1/policies/${policy.id}`,{expected_version:2,restore_version:1});
 const restored=await api('POST',`/api/v1/policies/${policy.id}/publish`,{expected_version:3,expected_release:head.release_id,disable:false});
 await wait('rollback revision observed',async()=>{head=await api('GET','/api/v1/policies/cluster');return head.release_id===restored.release_id&&head.nodes.every(n=>n.phase==='observed'&&n.release_id===head.release_id)});await verify(403);
 dc('stop','controller');dc('restart','node-01');
 // Docker may allocate a different ephemeral host port when restarting.
 nodes[0]=`http://${dc('port','node-01','80')}`;
 await wait('node restart keeps durable policy without controller',async()=>{await verify(403);return true});
 dc('start','controller');base=`http://${dc('port','controller','8080')}`;
 await wait('controller restart retains release',async()=> (await api('GET','/api/v1/policies/cluster')).release_id===head.release_id);
 const disabled=await api('POST',`/api/v1/policies/${policy.id}/publish`,{expected_version:3,expected_release:head.release_id,disable:true});
 await wait('disable reconciles entire cluster',async()=>{const c=await api('GET','/api/v1/policies/cluster');return c.release_id===disabled.release_id&&c.nodes.every(n=>n.phase==='observed'&&n.release_id===c.release_id)});await verify(200);
 result.pass=true;
}catch(err){result.pass=false;result.error=String(err.stack);console.error(err);process.exitCode=1}
finally{
 if(browser)await browser.close();
 if(base){try{result.cluster=await api('GET','/api/v1/policies/cluster')}catch(e){result.clusterError=String(e)}}
 for(let i=1;i<=3;i++){try{writeFileSync(path.join(dir,`node-0${i}-nginx.log`),dc('exec','-T',`node-0${i}`,'cat','/var/log/nginx/error.log'),{mode:0o600})}catch{}}
 try{writeFileSync(path.join(dir,'containers.log'),dc('logs','--no-color'),{mode:0o600});dc('down','--remove-orphans')}catch(e){result.cleanupError=String(e);process.exitCode=1}
 result.finished=new Date().toISOString();writeFileSync(path.join(dir,'results.json'),JSON.stringify(result,null,2));console.log('EVIDENCE',path.join(dir,'results.json'));console.log('Fixture containers removed; isolated volumes retained for diagnosis.');
}
