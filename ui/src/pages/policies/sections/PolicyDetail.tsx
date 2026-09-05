import React,{useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {policiesApi,type SavedPolicy,type ClusterPolicies,type PolicyRelease} from '../../../lib/api/policies';

export function PolicyDetail({policy,cluster,onChanged,onClose}:{policy:SavedPolicy;cluster:ClusterPolicies;onChanged:()=>Promise<void>;onClose:()=>void}){
 const [history,setHistory]=useState<SavedPolicy[]>([]);const [preview,setPreview]=useState<PolicyRelease|null>(null);
 const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const retry=useRef<{operation:string;key:string}|null>(null);
 useEffect(()=>{let live=true;policiesApi.detail(policy.id,true).then(h=>{if(live)setHistory(h)}).catch(e=>{if(live)setError(String(e))});setPreview(null);return()=>{live=false}},[policy.id,policy.version,cluster.release_id]);
 async function run(operation:string,restore?:number){
  if(busy)return;
  const signature=`${operation}:${policy.version}:${cluster.release_id}:${restore||0}`;
  if(retry.current?.operation!==signature)retry.current={operation:signature,key:crypto.randomUUID()};
  const key=retry.current.key;setBusy(true);setError('');
  try{
   if(operation==='restore'){await policiesApi.restore(policy.id,policy.version,restore!,key)}
   else {const result=await policiesApi.publish(policy.id,policy.version,cluster.release_id,operation==='disable',key,operation==='preview');if(operation==='preview')setPreview(result)}
   retry.current=null;await onChanged();
  }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
 }
 return <aside className="xl:col-span-5 bg-[#0B1320] border border-[#172338] p-4 space-y-4">
  <div className="flex justify-between"><h2 className="font-bold">{policy.document.name}</h2><button aria-label="Close policy details" onClick={onClose}>×</button></div>
  <p className="text-sm text-slate-400">{policy.document.description}</p>
  <p>Draft revision {policy.version} · Published revision {policy.published_version??'none'}</p>
  <p className="text-xs">Scope: {policy.document.host}{policy.document.path_prefix} · Mode: {policy.document.mode} · Priority: {policy.document.priority}</p>
  <p className="text-xs text-slate-400">Lowest priority number wins; ties use policy ID. First matching host/path scope owns the request. Unmatched rule paths are allowed.</p>
  <ul className="text-xs space-y-1">{policy.document.rules.map(r=><li key={r.id}>{r.name} · v{r.version} · {r.group} · {r.action}{(!r.runtime_ready||!r.enabled)&&<span className="text-amber-400"> — not publishable</span>}</li>)}</ul>
  {error&&<p role="alert" className="text-rose-300">{error}</p>}
  <div className="grid grid-cols-2 gap-2 text-sm">
   <Link to={`/policies/create?edit=${policy.id}`} className="border border-slate-700 p-2">Edit draft</Link>
   <Link to={`/policies/create?clone=${policy.id}`} className="border border-slate-700 p-2">Clone policy</Link>
   <button disabled={busy} onClick={()=>void run('preview')} className="border border-slate-700 p-2">Preview cluster changes</button>
   <button disabled={busy||!preview} onClick={()=>{if(window.confirm('Publish this policy to the entire cluster? Each configured agent will validate NGINX before activation.'))void run('publish')}} className="bg-emerald-700 p-2 disabled:opacity-40">Publish policy</button>
   <button disabled={busy||policy.published_version===null} onClick={()=>{if(window.confirm('Remove this policy from the next cluster release? Other published policies remain.'))void run('disable')}} className="border border-rose-800 p-2 disabled:opacity-40">Disable policy</button>
  </div>
  {preview&&<div><h3>Compiled preview — not applied</h3><p className="text-xs">{preview.membership.length} policies · {preview.digest}</p><pre className="text-xs overflow-auto max-h-64 bg-slate-950 p-2">{JSON.stringify(preview.payload,null,2)}</pre></div>}
  <section><h3 className="font-bold">Revision history (latest 100)</h3><p className="text-xs text-slate-400">Restore creates a new draft. Preview and publish it to roll back the cluster.</p>{history.map(h=><div className="flex justify-between py-2 text-xs" key={h.version}><span>v{h.version} · {h.operation} · {h.actor} · {new Date(h.created_at).toLocaleString()}</span><button disabled={busy||h.version===policy.version} onClick={()=>{if(window.confirm(`Restore revision ${h.version} as a new draft?`))void run('restore',h.version)}}>Restore</button></div>)}</section>
 </aside>;
}
