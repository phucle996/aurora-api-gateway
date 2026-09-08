import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { rulesApi, type RuleDetailResponse, type RuleHistoryItem } from '../../lib/api/rules';

export default function RuleHistoryPage(){
 const {id:routeID}=useParams();const [params]=useSearchParams();const id=routeID||params.get('id')||'';
 const [detail,setDetail]=useState<RuleDetailResponse|null>(null);const [versions,setVersions]=useState<RuleHistoryItem[]>([]);
 const [before,setBefore]=useState<number|undefined>();const [left,setLeft]=useState<number>();const [right,setRight]=useState<number>();
 const [error,setError]=useState('');const [notice,setNotice]=useState('');const [loading,setLoading]=useState(false);const [restoring,setRestoring]=useState(false);
 const request=useRef(0);const restoringRef=useRef(false);
 const load=useCallback(async()=>{
  const seq=++request.current;setLoading(true);setError('');setDetail(null);setVersions([]);setBefore(undefined);
  try{
   if(!/^[1-9][0-9]*$/.test(id))throw Error('Select a valid rule ID.');
   const [record,history]=await Promise.all([rulesApi.getById(id),rulesApi.getHistory(id)]);
   if(seq!==request.current)return;
   if(!Array.isArray(history.items))throw Error('Invalid revision history response');
   setDetail(record);setVersions(history.items);setBefore(history.next_before);
   setRight(history.items[0]?.version);setLeft(history.items[1]?.version??history.items[0]?.version);
  }catch(e){if(seq===request.current)setError(e instanceof Error?e.message:'Unable to read history');}
  finally{if(seq===request.current)setLoading(false);}
 },[id]);
 useEffect(()=>{setNotice('');void load();return()=>{++request.current;};},[load]);
 const more=async()=>{
  if(!before||loading)return;const seq=request.current;setLoading(true);
  try{const history=await rulesApi.getHistory(id,{before});if(seq!==request.current)return;setVersions(prev=>[...new Map([...prev,...history.items].map(v=>[v.version,v])).values()].sort((a,b)=>b.version-a.version));setBefore(history.next_before);}
  catch(e){if(seq===request.current)setError(e instanceof Error?e.message:'Unable to read older revisions');}
  finally{if(seq===request.current)setLoading(false);}
 };
 const restore=async()=>{
  if(!detail||right===undefined||restoringRef.current)return;
  if(!window.confirm(`Restore saved revision v${right}? This creates a new saved revision and does not deploy it.`))return;
  restoringRef.current=true;setRestoring(true);setError('');const seq=request.current;
  try{const result=await rulesApi.rollback(id,right,detail.version);if(seq!==request.current)return;setNotice(`Revision v${result.version} saved from v${result.target_version}. No deployment was performed.`);await load();}
  catch(e){if(seq===request.current)setError((e instanceof Error?e.message:'Restore failed')+'. Refresh the history before retrying if the response was lost.');}
  finally{restoringRef.current=false;setRestoring(false);}
 };
 return <div className="p-6 space-y-5 text-foreground">
  <div className="flex justify-between"><div><h1 className="text-xl font-semibold">Rule History</h1><p className="text-sm text-muted-foreground">Immutable saved revisions. Saved versions do not prove deployment.</p></div><Link to="/rules" className="text-blue-500">Back to rules</Link></div>
  {error&&<p role="alert" className="text-rose-500">{error}</p>}{notice&&<p role="status" className="text-emerald-500">{notice}</p>}
  <button disabled={loading||restoring} onClick={load} className="border border-border px-3 py-2 rounded">Refresh history</button>
  {loading&&<p role="status">Loading revisions…</p>}
  {detail&&<div className="bg-card border border-border p-4"><h2 className="font-semibold">{detail.name} · #{detail.id}</h2><p>Current saved revision: v{detail.version} · {detail.enabled?'Enabled definition':'Disabled definition'}</p><p className="text-sm text-muted-foreground">Created: {detail.created_at||'Unknown'} · Actor: {detail.created_by||'Unknown'} · Current policy assignments: {detail.assigned_policies}</p><Link to={`/edit-rule?id=${id}`} className="text-blue-500">Edit rule</Link></div>}
  {!loading&&!error&&versions.length===0&&<p>No recorded revision history.</p>}
  {versions.length>0&&<>
   <div className="overflow-x-auto border border-border"><table className="w-full text-left text-sm"><thead><tr>{['Saved revision','Saved at (UTC)','Actor','Action','Definition status'].map(h=><th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{versions.map(v=><tr key={v.version} className="border-t border-border cursor-pointer" onClick={()=>setRight(v.version)}><td className="p-3">v{v.version}{v.version===detail?.version?' (current saved)':''}</td><td className="p-3">{v.updated_at}</td><td className="p-3">{v.actor||'Unknown'}</td><td className="p-3">{v.action}</td><td className="p-3">{v.enabled?'Enabled':'Disabled'}</td></tr>)}</tbody></table></div>
   {before&&<button disabled={loading} onClick={more} className="border p-2">Load older revisions</button>}
   <div className="flex gap-3 items-center"><span>Compare saved snapshots:</span><select aria-label="From version" value={left} onChange={e=>setLeft(Number(e.target.value))} className="bg-background border p-2">{versions.map(v=><option key={v.version} value={v.version}>v{v.version}</option>)}</select><select aria-label="To version" value={right} onChange={e=>setRight(Number(e.target.value))} className="bg-background border p-2">{versions.map(v=><option key={v.version} value={v.version}>v{v.version}</option>)}</select><button disabled={restoring||loading||!detail||right===detail.version} onClick={restore} className="bg-blue-600 text-white px-3 py-2 disabled:opacity-50">{restoring?'Restoring…':'Restore selected revision'}</button></div>
   <div className="grid md:grid-cols-2 gap-4">{[left,right].map((version,index)=><section key={index} className="bg-card border border-border p-4 min-w-0"><h3>Saved revision v{version}</h3><pre className="text-xs overflow-auto mt-3">{JSON.stringify(versions.find(v=>v.version===version),null,2)}</pre></section>)}</div>
  </>}
 </div>;
}
