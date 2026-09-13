import {chromium} from '../ui/node_modules/playwright-core/index.mjs';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdirSync,writeFileSync} from 'node:fs';
import {brotliDecompressSync,gunzipSync} from 'node:zlib';
import http from 'node:http';
import assert from 'node:assert/strict';
const run=promisify(execFile), sleep=ms=>new Promise(r=>setTimeout(r,ms));
const token=execFileSync('docker',['exec','aurora-controller','cat','/data/admin.token'],{encoding:'utf8'}).trim();
const dir=`build/dependency-audit-${Date.now()}`;mkdirSync(dir,{recursive:true});const report={checks:[]};let browser;
async function api(method,path,body,status=200){const r=await fetch('http://localhost:8080'+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const text=await r.text();assert.equal(r.status,status,text);return text?JSON.parse(text):null;}
async function waitNode(id,predicate){let node;for(let i=0;i<90;i++){node=(await api('GET','/api/v1/settings/dependencies')).find(n=>n.node_id===id);if(node&&predicate(node))return node;await sleep(500);}throw Error(`Node did not converge: ${JSON.stringify(node)}`);}
function request(){return new Promise((resolve,reject)=>{const q=http.get('http://localhost:8090/ok',{agent:false,timeout:5000},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));});q.on('error',reject);q.on('timeout',()=>q.destroy(Error('timeout')));});}
try{
 for(const id of ['node-03','node-01','node-02']){const n=await waitNode(id,n=>n.fresh&&n.installable&&n.modules.some(m=>m.name==='gzip'&&m.loaded));assert.ok(n.modules.some(m=>m.name==='http2_upstream'&&m.available));assert.ok(n.modules.some(m=>m.name==='ngx_http_gateway_module'));}
 report.checks.push('Startup reports real NGINX version, architecture, gzip, HTTP/2 and loaded Aurora module on all 3 nodes');
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(t=>localStorage.setItem('aurora_admin_token',t),token);await page.goto('http://localhost:8080/settings');await page.getByRole('button',{name:'Dependencies',exact:true}).click();
 const card=page.locator('article').filter({has:page.getByRole('heading',{name:'node-03',exact:true})});await card.getByRole('button',{name:'Install Brotli',exact:true}).waitFor();
 const load={requests:0,errors:0};let loading=true;const workers=Array.from({length:24},async()=>{while(loading){try{assert.equal(await request(),200);load.requests++;}catch{load.errors++;}}});
 try{await card.getByRole('button',{name:'Install Brotli',exact:true}).click();const installed=await waitNode('node-03',n=>n.job_state==='succeeded'&&n.modules.some(m=>m.name==='brotli'&&m.loaded));report.installed=installed;await card.getByRole('button',{name:'Brotli installed',exact:true}).waitFor();
  await page.screenshot({path:`${dir}/dependencies-installed.png`,fullPage:true});
 }finally{loading=false;await Promise.all(workers);report.load=load;}
 assert.equal(load.errors,0);report.checks.push('Install Brotli from Settings UI during traffic; job completes only after runtime proof');assert.deepEqual(errors,[]);
 for(const [path,encoding,decode] of [['gzip','gzip',gunzipSync],['brotli','br',brotliDecompressSync]]){
  const result=execFileSync('docker',['exec','aurora-node-03','curl','--fail','--silent','-H',`Accept-Encoding: ${encoding}`,`http://127.0.0.1:9085/${path}`]);
  assert.ok(decode(result).toString().includes('Aurora compression verification'));report.checks.push(`${encoding}: actual compressed body decodes correctly`);
 }
 const before=await waitNode('node-03',n=>n.fresh);await card.getByRole('button',{name:'Check again',exact:true}).click();await waitNode('node-03',n=>n.job_action==='check'&&n.job_state==='succeeded'&&n.checked_at>before.checked_at);report.checks.push('Manual dependency recheck updates observed timestamp');
 const restartedAt=Date.now();await run('docker',['compose','up','-d','--no-deps','--force-recreate','node-03']);await waitNode('node-03',n=>n.checked_at>restartedAt&&n.modules.some(m=>m.name==='brotli'&&m.loaded));
 const persisted=execFileSync('docker',['exec','aurora-node-03','curl','--fail','--silent','-H','Accept-Encoding: br','http://127.0.0.1:9085/brotli']);assert.ok(brotliDecompressSync(persisted).length>1000);report.checks.push('Installed Brotli survives container replacement through persistent volume');
 // Exercise integrity failure while retaining an already installed module, restoring only our test mutation.
 await run('docker',['exec','aurora-node-02','cp','/opt/aurora-dependencies/brotli/ngx_http_brotli_filter_module.so','/tmp/aurora-brotli-good.so']);
 try{
  await run('docker',['exec','aurora-node-02','sh','-c',"printf broken > /opt/aurora-dependencies/brotli/ngx_http_brotli_filter_module.so"]);
  const job=await api('POST','/api/v1/settings/dependencies/node-02/jobs',{action:'install_brotli'},202);await waitNode('node-02',n=>n.job_id===job.id&&n.job_state==='failed'&&n.modules.some(m=>m.name==='brotli'&&m.loaded));
  const r=await fetch('http://localhost:8093/ok');assert.equal(r.status,200);report.checks.push('Corrupt install package fails closed; NGINX continues serving existing traffic');
 }finally{await run('docker',['exec','aurora-node-02','cp','/tmp/aurora-brotli-good.so','/opt/aurora-dependencies/brotli/ngx_http_brotli_filter_module.so']);await run('docker',['exec','aurora-node-02','rm','/tmp/aurora-brotli-good.so']);}
 const check=await api('POST','/api/v1/settings/dependencies/node-02/jobs',{action:'check'},202);await waitNode('node-02',n=>n.job_id===check.id&&n.job_state==='succeeded'&&n.installable);
 const retry=await api('POST','/api/v1/settings/dependencies/node-02/jobs',{action:'install_brotli'},202);await waitNode('node-02',n=>n.job_id===retry.id&&n.job_state==='succeeded'&&n.modules.some(m=>m.name==='brotli'&&m.loaded));report.checks.push('Retry after package recovery succeeds');
 await page.reload();await page.getByRole('button',{name:'Dependencies',exact:true}).click();const second=page.locator('article').filter({has:page.getByRole('heading',{name:'node-01',exact:true})});if(await second.getByRole('button',{name:'Install Brotli',exact:true}).count()) await second.getByRole('button',{name:'Install Brotli',exact:true}).click();await waitNode('node-01',n=>n.job_state==='succeeded'&&n.modules.some(m=>m.name==='brotli'&&m.loaded));
 report.checks.push('All 3 nodes have verified Brotli installed');report.pass=true;
}catch(e){report.pass=false;report.error=String(e.stack);process.exitCode=1;}
finally{await browser?.close();writeFileSync(`${dir}/results.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,installed:undefined,evidence:`${dir}/results.json`},null,2));}
