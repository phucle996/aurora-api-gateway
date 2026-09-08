import {execFileSync,spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import http from 'node:http';
import http2 from 'node:http2';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {chromium} from '../ui/node_modules/playwright-core/index.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const directory=`build/origin-transport-audit-${Date.now()}`;mkdirSync(directory,{recursive:true});
const certDir=mkdtempSync(`${tmpdir()}/aurora-origin-`);
const token=execFileSync('docker',['exec','aurora-controller','cat','/data/admin.token'],{encoding:'utf8'}).trim();
const report={checks:[]};let fixture,pool,domain;
const body=Buffer.from('upstream request compression\n'.repeat(1000));
const digest=createHash('sha256').update(body).digest('hex');
async function api(method,path,payload,status=200){const r=await fetch(`http://localhost:8080${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined});const text=await r.text();assert.equal(r.status,status,`${method} ${path}: ${text}`);return JSON.parse(text);}
function request(port=8090,data=body,headers={},chunked=false,path='/echo'){return new Promise((resolve,reject)=>{const q=http.request({hostname:'domain-a.aurora.test',port,path,method:'POST',agent:false,timeout:10000,headers:{'Content-Type':'application/octet-stream',...(!chunked?{'Content-Length':data.length}:{}),...headers}},r=>{const chunks=[];r.on('data',c=>chunks.push(c));r.on('error',reject);r.on('end',()=>{let value;try{value=JSON.parse(Buffer.concat(chunks))}catch{}resolve({status:r.statusCode,value});});});q.on('error',reject);q.on('timeout',()=>q.destroy(Error('timeout')));if(chunked){q.write(data.subarray(0,100));q.end(data.subarray(100));}else q.end(data);});}
async function settle(protocol,encoding,client){let last;for(let i=0;i<80;i++){last=await Promise.all([8090,8091,8092,8093].map(p=>request(p)));if(last.every(r=>r.status===200&&r.value?.protocol===protocol&&r.value.encoding===encoding&&(!client||r.value.client===client))){for(const r of last){assert.equal(r.value.sha256,digest);assert.equal(r.value.host,'domain-a.aurora.test');}return last;}await sleep(500);}throw Error(`routing did not settle ${protocol}/${encoding}: ${JSON.stringify(last)}`);}
try{
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',`${certDir}/ca.key`,'-out',`${certDir}/ca.crt`,'-days','1','-subj','/CN=Aurora Origin Test CA'],{stdio:'ignore'});
 for(const [name,usage] of [['origin','serverAuth'],['client','clientAuth']]){
  execFileSync('openssl',['req','-newkey','rsa:2048','-nodes','-keyout',`${certDir}/${name}.key`,'-out',`${certDir}/${name}.csr`,'-subj',`/CN=${name}.aurora.test`],{stdio:'ignore'});
  writeFileSync(`${certDir}/${name}.ext`,`subjectAltName=DNS:${name}.aurora.test\nextendedKeyUsage=${usage}\nbasicConstraints=CA:FALSE\n`);
  execFileSync('openssl',['x509','-req','-in',`${certDir}/${name}.csr`,'-CA',`${certDir}/ca.crt`,'-CAkey',`${certDir}/ca.key`,'-CAcreateserial','-out',`${certDir}/${name}.crt`,'-days','1','-extfile',`${certDir}/${name}.ext`],{stdio:'ignore'});
 }
 fixture=spawn('./build/origin-fixture',[certDir],{stdio:['ignore','pipe','pipe']});
 const ports=await new Promise((resolve,reject)=>{let output='';fixture.stdout.on('data',b=>{output+=b;if(output.includes('\n'))resolve(JSON.parse(output.split('\n')[0]));});fixture.on('error',reject);fixture.on('exit',c=>reject(Error(`fixture exit ${c}`)));});
 const networks=JSON.parse(execFileSync('docker',['inspect','aurora-node-01'],{encoding:'utf8'}))[0].NetworkSettings.Networks;
 const gateway=Object.entries(networks).find(([n])=>n.endsWith('_default'))[1].Gateway;
 let payload={name:`origin_audit_${Date.now()}`,architecture_type:'Single Server',algorithm:'round_robin',servers:[{id:'origin',address:`${gateway}:${ports.plain}`,weight:1}],internal_ssl:{enabled:false},probes:[],dynamic_dns:true,transport:{httpVersion:'HTTP/1.1',requestCompression:'none'}};
 pool=await api('POST','/api/v1/upstreams',payload,201);domain=await api('POST','/api/v1/domains',{domain:'domain-a.aurora.test',upstream:payload.name},201);
 for(const protocol of ['HTTP/1.0','HTTP/1.1','HTTP/2'])for(const encoding of ['none']){
  const tls=protocol==='HTTP/3';payload={...payload,servers:[{id:'origin',address:`${gateway}:${ports[tls?'quic':'plain']}`,weight:1}],internal_ssl:tls?{enabled:true,verifyCert:true,sniHost:'origin.aurora.test',caCert:readFileSync(`${certDir}/ca.crt`,'utf8')}:{enabled:false},transport:{httpVersion:protocol,requestCompression:encoding,compressionMinBytes:1024,compressionLevel:3}};
  await api('PUT',`/api/v1/upstreams/${pool.id}`,payload);const results=await settle(protocol.match(/HTTP\/[23]$/)?`${protocol}.0`:protocol,encoding==='none'?'':encoding);
  if(encoding!=='none')assert.ok(results.every(r=>r.value.wire_bytes<body.length/5));report.checks.push(`${protocol} + ${encoding}: backend protocol/body/hash verified through LB and 3 nodes`);
 }
 for(const protocol of ['HTTP/2']){
  payload={...payload,servers:[{id:'origin',address:`${gateway}:${ports[protocol==='HTTP/2'?'mtls':'quic_mtls']}`,weight:1}],internal_ssl:{enabled:true,verifyCert:true,sniHost:'origin.aurora.test',caCert:readFileSync(`${certDir}/ca.crt`,'utf8'),mTLS:true,clientCert:readFileSync(`${certDir}/client.crt`,'utf8'),clientKey:readFileSync(`${certDir}/client.key`,'utf8')},transport:{...payload.transport,httpVersion:protocol}};
  const saved=await api('PUT',`/api/v1/upstreams/${pool.id}`,payload);assert.equal(saved.internal_ssl.clientKey,undefined);const results=await settle(`${protocol}.0`,'','client.aurora.test');assert.ok(results.every(r=>r.value.client==='client.aurora.test'));report.checks.push(`${protocol} + verified upstream mTLS`);
 }
 payload={...payload,servers:[{id:'origin',address:`${gateway}:${ports.plain}`,weight:1}],internal_ssl:{enabled:false},transport:{...payload.transport,httpVersion:'HTTP/2',enableGrpc:true}};
 await api('PUT',`/api/v1/upstreams/${pool.id}`,payload);await sleep(5000);
 const client=http2.connect('http://localhost:8091');
 try{const result=await new Promise((resolve,reject)=>{const q=client.request({':method':'POST',':path':'/grpc',':authority':'domain-a.aurora.test','content-type':'application/grpc','te':'trailers'});let headers,trailers;const chunks=[];q.on('response',h=>headers=h);q.on('trailers',h=>trailers=h);q.on('data',c=>chunks.push(c));q.on('error',reject);q.on('end',()=>resolve({headers,trailers,body:Buffer.concat(chunks)}));const frame=Buffer.alloc(5);frame.writeUInt32BE(body.length,1);q.end(Buffer.concat([frame,body]));});assert.equal(result.headers[':status'],200);assert.equal(result.headers['origin-encoding'],'');assert.equal(result.trailers['grpc-status'],'0');assert.equal(result.body.subarray(5).toString(),digest);report.checks.push('Native gRPC framing and status trailers through NGINX');}finally{client.close();}
 payload={...payload,transport:{...payload.transport,enableGrpc:false,requestCompression:'none'}};
 await api('PUT',`/api/v1/upstreams/${pool.id}`,payload);await settle('HTTP/2.0','');
 const encoded=await request(8090,gzipSync(body),{'Content-Encoding':'gzip'});assert.equal(encoded.value.sha256,digest);report.checks.push('Client compressed request forwarded unchanged');
 for(const transport of [{httpVersion:'HTTP/3'},{httpVersion:'HTTP/2',requestCompression:'gzip'}])await api('PUT',`/api/v1/upstreams/${pool.id}`,{...payload,transport},400);
 report.checks.push('Unsupported HTTP/3 and request compression rejected by API');
 const load={requests:0,errors:0,changes:0,errorSamples:[],encodings:{},protocols:{}};const end=Date.now()+30000;
 await Promise.all([...Array.from({length:32},async()=>{while(Date.now()<end){try{const r=await request();assert.equal(r.status,200);assert.equal(r.value.sha256,digest);load.requests++;load.encodings[r.value.encoding]=(load.encodings[r.value.encoding]||0)+1;load.protocols[r.value.protocol]=(load.protocols[r.value.protocol]||0)+1;}catch(e){load.errors++;if(load.errorSamples.length<20)load.errorSamples.push(String(e));}}}), (async()=>{let i=0;while(Date.now()<end-4000){const choice=i++%3;await api('PUT',`/api/v1/upstreams/${pool.id}`,{...payload,transport:{...payload.transport,httpVersion:choice===0?'HTTP/1.1':'HTTP/2',requestCompression:'none'}});load.changes++;await sleep(4000);}})()]);report.load=load;assert.equal(load.errors,0);assert.equal(Object.keys(load.encodings).length,1);report.checks.push('Continuous request-body integrity during live native protocol changes');
 report.pass=true;
}catch(e){report.pass=false;report.error=String(e.stack);process.exitCode=1;}
finally{
 try{if(domain)await api('DELETE',`/api/v1/domains/${domain.id}`);if(pool)await api('DELETE',`/api/v1/upstreams/${pool.id}`);}catch(e){report.cleanupError=String(e);report.pass=false;process.exitCode=1;}
 fixture?.kill();rmSync(certDir,{recursive:true,force:true});writeFileSync(`${directory}/results.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,evidence:`${directory}/results.json`},null,2));
}
