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

try {
 await page.goto('http://localhost:8080/nodes');
 await page.getByText('node-01',{exact:true}).first().click();
 await page.getByRole('button',{name:'Sync',exact:true}).click();
 await page.getByText('Heartbeat received',{exact:true}).waitFor();
 execFileSync('docker',['stop','aurora-controller'],{stdio:'ignore'});
 await page.waitForTimeout(48000);
 const offline=await page.locator('body').innerText();
 await page.screenshot({path:`${dir}/controller-offline.png`,fullPage:true});
 if(!offline.includes('Unknown — stale heartbeat') || !offline.includes('0/3'))throw Error('stale UI not correct');
 execFileSync('docker',['start','aurora-controller'],{stdio:'ignore'});
 await page.getByText('Heartbeat received',{exact:true}).waitFor({timeout:30000});
 await page.waitForTimeout(1500);
 const recovered=await page.locator('body').innerText();
 const nodes=await api('nodes'),history=await api('nodes/node-01/metrics');
 await page.screenshot({path:`${dir}/controller-recovered.png`,fullPage:true});
 writeFileSync(`${dir}/recovery.json`,JSON.stringify({offline,recovered,nodes,history},null,2));
 console.log(JSON.stringify({dir,staleCorrect:true,recovered:true,historyPoints:history.length,oldestAge:Date.now()/1000-Math.min(...history.map(p=>p.timestamp))}));
} finally {execFileSync('docker',['start','aurora-controller'],{stdio:'ignore'});await browser.close();}
