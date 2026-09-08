import https from 'node:https';
import {createHash} from 'node:crypto';
import {chromium} from '../ui/node_modules/playwright-core/index.mjs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
const run=promisify(execFile),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const dir=`build/tls-mtls-audit-${Date.now()}`;mkdirSync(dir,{recursive:true});
const certDir=mkdtempSync(`${tmpdir()}/aurora-tls-`);
const nodes=['aurora-node-01','aurora-node-02','aurora-node-03'];
const token=execFileSync('docker',['exec','aurora-controller','cat','/data/admin.token'],{encoding:'utf8'}).trim();
const report={checks:[],requests:[],limitations:['This suite covers NGINX-to-origin TLS/mTLS; edge TLS is a separate workflow.']};
const servers=[],domains=[],pools=[],trusted=[];
async function api(method,path,body,status=200){const r=await fetch('http://localhost:8080'+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const t=await r.text();assert.equal(r.status,status,`${method} ${path}: ${t}`);return JSON.parse(t);}
async function probe(port){return new Promise((resolve,reject)=>{const q=http.get({hostname:'domain-a.aurora.test',port,path:'/tls-check',agent:false,timeout:5000},r=>{let b='';r.on('data',x=>b+=x);r.on('end',()=>resolve({status:r.statusCode,body:b}));});q.on('error',reject);q.on('timeout',()=>q.destroy(Error('timeout')));});}
async function settle(status){for(let i=0;i<80;i++){const results=await Promise.all([8090,8091,8092,8093].map(probe));if(results.every(r=>r.status===status)){report.requests.push({expected:status,results});return results;}await sleep(500);}throw Error(`TLS routing did not converge to ${status}`);}
try{
 for(const [name,subject] of [['ca','Aurora Test CA'],['wrong-ca','Untrusted Test CA']])execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',`${certDir}/${name}.key`,'-out',`${certDir}/${name}.crt`,'-days','1','-subj',`/CN=${subject}`],{stdio:'ignore'});
 for(const [name,usage] of [['origin','serverAuth'],['client','clientAuth'],['client2','clientAuth'],['wrong-client','clientAuth']]){
  execFileSync('openssl',['req','-newkey','rsa:2048','-nodes','-keyout',`${certDir}/${name}.key`,'-out',`${certDir}/${name}.csr`,'-subj',`/CN=${name}.aurora.test`],{stdio:'ignore'});
  writeFileSync(`${certDir}/${name}.ext`,`subjectAltName=DNS:${name}.aurora.test\nextendedKeyUsage=${usage}\nbasicConstraints=CA:FALSE\n`);
  execFileSync('openssl',['x509','-req','-in',`${certDir}/${name}.csr`,'-CA',`${certDir}/${name==='wrong-client'?'wrong-ca':'ca'}.crt`,'-CAkey',`${certDir}/${name==='wrong-client'?'wrong-ca':'ca'}.key`,'-CAcreateserial','-out',`${certDir}/${name}.crt`,'-days','1','-extfile',`${certDir}/${name}.ext`],{stdio:'ignore'});
 }
 const ca=readFileSync(`${certDir}/ca.crt`),key=readFileSync(`${certDir}/origin.key`),cert=readFileSync(`${certDir}/origin.crt`);
 for(const mtls of [false,true]){const s=https.createServer({key,cert,ca,requestCert:mtls,rejectUnauthorized:mtls},(q,r)=>{r.setHeader('Content-Type','application/json');r.end(JSON.stringify({tls:q.socket.getProtocol(),sni:q.socket.servername,clientAuthorized:q.socket.authorized,clientCN:q.socket.getPeerCertificate().subject?.CN}));});await new Promise(r=>s.listen(0,'0.0.0.0',r));servers.push(s);}
 const networks=JSON.parse(execFileSync('docker',['inspect','aurora-node-01'],{encoding:'utf8'}))[0].NetworkSettings.Networks;
 const gateway=Object.entries(networks).find(([n])=>n.endsWith('_default'))[1].Gateway;
 let payload={name:`tls_audit_${Date.now()}`,architecture_type:'Single Server',algorithm:'round_robin',servers:[{id:'tls',address:`${gateway}:${servers[0].address().port}`,weight:1}],internal_ssl:{enabled:true,verifyCert:false,sniHost:'origin.aurora.test'},probes:[],transport:{httpVersion:'HTTP/1.1'}};
 const pool=await api('POST','/api/v1/upstreams',payload,201);pools.push(pool.id);
 const domain=await api('POST','/api/v1/domains',{domain:'domain-a.aurora.test',upstream:payload.name},201);domains.push(domain.id);
 let replies=await settle(200);for(const r of replies){const b=JSON.parse(r.body);assert.equal(b.sni,'origin.aurora.test');assert.ok(b.tls.startsWith('TLS'));}report.checks.push('HTTPS origin negotiates real TLS and receives configured SNI on LB and 3 nodes');
 payload={...payload,internal_ssl:{...payload.internal_ssl,verifyCert:true}};
 await api('PUT',`/api/v1/upstreams/${pool.id}`,payload);await settle(502);report.checks.push('Untrusted origin certificate fails closed on all nodes');
 payload={...payload,internal_ssl:{...payload.internal_ssl,caCert:ca.toString()}};
 await api('PUT',`/api/v1/upstreams/${pool.id}`,payload);
 await settle(200);report.checks.push('Custom CA delivered automatically per upstream; no host trust-store changes');
 await api('PUT',`/api/v1/upstreams/${pool.id}`,{...payload,internal_ssl:{...payload.internal_ssl,sniHost:'wrong.aurora.test'}});await settle(502);report.checks.push('Trusted certificate with wrong hostname fails closed');
 await api('PUT',`/api/v1/upstreams/${pool.id}`,payload);await settle(200);report.checks.push('Corrected SNI recovers without recreating domain');
 await api('PUT',`/api/v1/upstreams/${pool.id}`,{...payload,servers:[{id:'mtls',address:`${gateway}:${servers[1].address().port}`,weight:1}]});await settle(502);report.checks.push('Origin requiring mTLS rejects WAF connection without client certificate');

 payload={...payload,servers:[{id:'mtls',address:`${gateway}:${servers[1].address().port}`,weight:1}],internal_ssl:{...payload.internal_ssl,mTLS:true,clientCert:readFileSync(`${certDir}/client.crt`,'utf8'),clientKey:readFileSync(`${certDir}/client.key`,'utf8')}};
 const updated=await api('PUT',`/api/v1/upstreams/${pool.id}`,payload);
 assert.equal(updated.internal_ssl.clientKey,undefined);assert.equal(updated.internal_ssl.clientKeyConfigured,true);
 replies=await settle(200);for(const r of replies){assert.equal(JSON.parse(r.body).clientAuthorized,true);assert.equal(JSON.parse(r.body).clientCN,'client.aurora.test');}
 report.checks.push('NGINX presents client certificate; origin authorizes real mTLS on LB and all 3 nodes');
 for(const path of [`/api/v1/upstreams/${pool.id}`,'/api/v1/upstreams','/api/v1/upstream-sync/node-01']){const data=await api('GET',path);assert.ok(!JSON.stringify(data).includes('PRIVATE KEY'));}
 const publicConfig=await fetch('http://localhost:8080/api/v1/domain-routing/node-01',{headers:{Authorization:`Bearer ${token}`}});assert.ok(!(await publicConfig.text()).includes('PRIVATE KEY'));
 const denied=await fetch(`http://localhost:8080/api/v1/domain-routing/node-01/bundle?token=${token}`);assert.equal(denied.status,403);
 report.checks.push('Private keys redacted from administrative responses; secret bundle rejects query token');
 const keepKey={...payload,internal_ssl:{...payload.internal_ssl}};delete keepKey.internal_ssl.clientKey;
 await api('PUT',`/api/v1/upstreams/${pool.id}`,keepKey);await settle(200);report.checks.push('Metadata edits retain stored private key');
 const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
 try{const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(t=>localStorage.setItem('aurora_admin_token',t),token);
  await page.goto(`http://localhost:8080/upstreams/${pool.id}/edit`);
  await page.getByText('Private key is stored.',{exact:false}).waitFor();
  assert.equal(await page.locator('#client-key-upload').inputValue(),'');
  await page.getByRole('button',{name:'Save Changes',exact:true}).click();await page.waitForURL('**/upstreams');
  assert.deepEqual(errors,[]);await settle(200);report.checks.push('Browser edit hides stored private key and saves mTLS without re-upload');
 }finally{await browser.close();}

 await api('PUT',`/api/v1/upstreams/${pool.id}`,{...payload,internal_ssl:{...payload.internal_ssl,clientKey:readFileSync(`${certDir}/client2.key`,'utf8')}},400);
 await settle(200);report.checks.push('Mismatched certificate/key rejected without changing working mTLS');
 await api('PUT',`/api/v1/upstreams/${pool.id}`,{...payload,internal_ssl:{...payload.internal_ssl,clientCert:readFileSync(`${certDir}/wrong-client.crt`,'utf8'),clientKey:readFileSync(`${certDir}/wrong-client.key`,'utf8')}});
 await settle(502);report.checks.push('Untrusted client identity fails closed through WAF');
 await api('PUT',`/api/v1/upstreams/${pool.id}`,payload);await settle(200);
 await run('docker',['restart','aurora-node-01']);
 for(let i=0;i<40;i++){try{const r=await probe(8091);if(r.status===200&&JSON.parse(r.body).clientAuthorized)break;}catch{}if(i===39)throw Error('node restart did not recover mTLS');await sleep(500);}
 await settle(200);report.checks.push('Node restart retains client identity and custom CA');
 for(const node of nodes){const stat=await run('docker',['exec',node,'find','/var/lib/aurora-routing/certificates','-name','*.pem','-printf','%m %u\n']);assert.ok(stat.stdout.trim().split('\n').every(x=>x==='600 root'));}
 report.checks.push('Node credential files owned by root with mode 0600');
 const load={requests:0,errors:0,identities:{},rotations:0};const end=Date.now()+30000;
 const workers=Array.from({length:32},async()=>{while(Date.now()<end){try{const r=await probe(8090);assert.equal(r.status,200);const b=JSON.parse(r.body);assert.equal(b.clientAuthorized,true);load.identities[b.clientCN]=(load.identities[b.clientCN]||0)+1;load.requests++;}catch{load.errors++;}}});
 const rotate=(async()=>{let i=0;while(Date.now()<end-4000){const name=i++%2?'client':'client2';await api('PUT',`/api/v1/upstreams/${pool.id}`,{...payload,internal_ssl:{...payload.internal_ssl,clientCert:readFileSync(`${certDir}/${name}.crt`,'utf8'),clientKey:readFileSync(`${certDir}/${name}.key`,'utf8')}});load.rotations++;await sleep(5000);}})();
 await Promise.all([...workers,rotate]);report.load=load;assert.equal(load.errors,0);assert.ok(load.identities['client.aurora.test']>0&&load.identities['client2.aurora.test']>0);report.checks.push('mTLS certificate/key rotation under continuous traffic');

 for(const [name,opts,expected] of [
  ['no client certificate',{},false],
  ['valid client certificate',{key:readFileSync(`${certDir}/client.key`),cert:readFileSync(`${certDir}/client.crt`)},true],
  ['untrusted client certificate',{key:readFileSync(`${certDir}/wrong-ca.key`),cert:readFileSync(`${certDir}/wrong-ca.crt`)},false]
 ]){const success=await new Promise(resolve=>{const q=https.get({hostname:'127.0.0.1',port:servers[1].address().port,servername:'origin.aurora.test',ca,agent:false,timeout:5000,...opts},r=>{r.resume();r.on('end',()=>resolve(r.statusCode===200));});q.on('error',()=>resolve(false));q.on('timeout',()=>q.destroy());});assert.equal(success,expected,name);report.checks.push(`Direct mTLS origin: ${name} ${success?'accepted':'rejected'}`);}
 report.pass=true;
}catch(e){report.pass=false;report.error=String(e.stack);process.exitCode=1;}
finally{
 for(const id of domains)try{await api('DELETE',`/api/v1/domains/${id}`);}catch(e){report.cleanupError=String(e);}
 for(const id of pools)try{await api('DELETE',`/api/v1/upstreams/${id}`);}catch(e){report.cleanupError=String(e);}
 for(const node of trusted)try{await run('docker',['exec',node,'rm','-f','/usr/local/share/ca-certificates/aurora-audit.crt']);await run('docker',['exec',node,'update-ca-certificates','--fresh']);await run('docker',['exec',node,'/opt/nginx/usr/sbin/nginx','-s','reload']);}catch(e){report.cleanupError=String(e);}
 await sleep(3000);
 for(const node of nodes)try{
  const active=(await run('docker',['exec',node,'cat','/var/lib/aurora-routing/active-domain-routing.conf'])).stdout;
  for(const name of ['ca','wrong-ca','client','client2','wrong-client'])for(const ext of ['crt','key']){
   const data=readFileSync(`${certDir}/${name}.${ext}`,'utf8');
   for(const content of [data,data.trim()]){const hash=createHash('sha256').update(content).digest('hex');
    if(!active.includes(hash))await run('docker',['exec',node,'rm','-f',`/var/lib/aurora-routing/certificates/${hash}.pem`]);
   }
  }
 }catch(e){report.cleanupError=String(e);}
 for(const s of servers){s.closeAllConnections();await new Promise(r=>s.close(r));}
 rmSync(certDir,{recursive:true,force:true});if(report.cleanupError){report.pass=false;process.exitCode=1;}
 writeFileSync(`${dir}/results.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,checks:report.checks,error:report.error,cleanupError:report.cleanupError,load:report.load,evidence:`${dir}/results.json`},null,2));
}
