import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { chromium } from '../ui/node_modules/playwright-core/index.mjs';
const token = execFileSync('docker',['exec','aurora-controller','cat','/data/admin.token'],{encoding:'utf8'}).trim();
const dir = `build/nodes-audit/verified-${Date.now()}`; mkdirSync(dir,{recursive:true});
const api = async path => { const r = await fetch(`http://localhost:8080/api/v1/${path}`,{headers:{Authorization:`Bearer ${token}`}}); if(!r.ok) throw Error(`API ${r.status}`); return r.json(); };
const browser = await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const context = await browser.newContext({viewport:{width:1600,height:1100}});
await context.addInitScript(token => {
 localStorage.setItem('aurora_admin_token',token); localStorage.setItem('aurora_admin_user',JSON.stringify({id:'usr_admin_01',username:'admin',role:'admin'}));
 window.observations=[];
 const Native=window.EventSource;
 window.EventSource=class extends Native { constructor(...args) { super(...args); this.addEventListener('nodes_heartbeat',e => {
  const received=Date.now(),data=JSON.parse(e.data);
  requestAnimationFrame(()=>requestAnimationFrame(()=>window.observations.push({received,rendered:Date.now(),data,rows:[...document.querySelectorAll('tbody tr')].map(r=>r.innerText)})));
 }); }};
},token);
const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
const results={started:new Date().toISOString(),stages:[],errors};
try {
 await page.goto('http://localhost:8080/nodes');
 await page.getByText('node-01',{exact:true}).first().click();
 await page.getByRole('button',{name:'Metrics',exact:true}).click();
 await page.getByText('Last 1 hour',{exact:true}).first().waitFor();
 results.before=await api('nodes');
 const agent=new http.Agent({keepAlive:true,maxSockets:128});
 let inFlight=0;
 for(const [rps,seconds] of [[0,10],[1000,20],[5000,30],[0,15]]) {
  const stage={targetRps:rps,seconds,count:0,failed:0,latencies:[],samples:[]}; const start=performance.now();
  let lastSample=0;
  while(performance.now()-start<seconds*1000) {
   const elapsed=performance.now()-start;
   const due=Math.floor(elapsed*rps/1000)-stage.count;
   for(let i=0;i<Math.min(due,128-inFlight);i++) {
    inFlight++;stage.count++;const sent=performance.now();
    const req=http.get('http://localhost:8090/ok',{agent},res=>{res.resume();res.on('end',()=>{inFlight--;if(res.statusCode!==200)stage.failed++;stage.latencies.push(performance.now()-sent);});});
    req.setTimeout(3000,()=>req.destroy());req.on('error',()=>{inFlight--;stage.failed++;});
   }
   if(elapsed-lastSample>2000) { lastSample=elapsed;stage.samples.push({at:Date.now(),nodes:await api('nodes')}); }
   if(stage.failed>20) throw Error('load error cutoff');
   await new Promise(r=>setTimeout(r,2));
  }
  while(inFlight) await new Promise(r=>setTimeout(r,10));
  stage.actualRps=stage.count/((performance.now()-start)/1000);stage.latencies.sort((a,b)=>a-b);
  stage.p95=stage.latencies[Math.floor(stage.latencies.length*.95)]||0;stage.p99=stage.latencies[Math.floor(stage.latencies.length*.99)]||0;delete stage.latencies;
  results.stages.push(stage);console.log(JSON.stringify({target:rps,count:stage.count,failed:stage.failed,rps:stage.actualRps,p95:stage.p95}));
  if(rps===5000)await page.screenshot({path:`${dir}/under-load.png`,fullPage:true});
 }
 agent.destroy();
 results.after=await api('nodes');
 results.events=await page.evaluate(()=>window.observations);
 results.history=await api('nodes/node-01/metrics');
 results.scopeValid=results.after.every(n=>n.metricsScope==='container'&&n.metricsAvailable&&n.runtimeStartedAt>0);
 results.hourValid=results.history.every(p=>p.timestamp>=Date.now()/1000-3602&&p.timestamp<=Date.now()/1000);
 results.cgroups=[];
 for(const n of results.after){
  const data=execFileSync('docker',['exec',`aurora-${n.id}`,'sh','-c','cat /sys/fs/cgroup/memory.current /sys/fs/cgroup/memory.stat /sys/fs/cgroup/memory.max /proc/meminfo'],{encoding:'utf8'});
  const lines=data.split('\n'),current=Number(lines[0]),inactive=Number(data.match(/^inactive_file (\d+)/m)[1]),total=Number(data.match(/^MemTotal:\s+(\d+)/m)[1])*1024;
  results.cgroups.push({node:n.id,workingSetBytes:current-inactive,memoryPercent:(current-inactive)/total*100,reportedPercent:n.memoryUsage});
  const cfg=await api(`nodes/${n.id}/config`);
  if(cfg.config.includes(token))throw Error('credential exposed');
  const raw=await (await fetch(`http://localhost:${8091+Number(n.id.slice(-1))-1}/_aurora/config`)).text();
  if(raw.includes(token))throw Error('direct config credential exposed');
 }
 await page.getByRole('button',{name:'Config',exact:true}).click(); await page.getByText('Redacted snapshot',{exact:true}).waitFor();
 await page.locator('pre').filter({hasText:'[REDACTED]'}).waitFor();
 await page.screenshot({path:`${dir}/config.png`,fullPage:true});
 await page.getByRole('button',{name:'Sync',exact:true}).click();
 results.renderChecks=results.events.flatMap(e=>e.data.filter(n=>n.metrics_available).map(n=>({node:n.node_id,match:e.rows.some(row=>row.includes(n.node_id)&&row.includes(n.rps.toFixed(1))),eventAge:e.received-n.timestamp*1000,renderMs:e.rendered-e.received})));
 writeFileSync(`${dir}/results.json`,JSON.stringify(results,null,2));
 console.log(JSON.stringify({dir,scopeValid:results.scopeValid,hourValid:results.hourValid,events:results.events.length,checks:results.renderChecks.length,mismatches:results.renderChecks.filter(c=>!c.match).length,cgroups:results.cgroups,errors}));
 if(!results.scopeValid||!results.hourValid||errors.length||results.renderChecks.some(c=>!c.match))process.exitCode=1;
} finally {await browser.close();}
