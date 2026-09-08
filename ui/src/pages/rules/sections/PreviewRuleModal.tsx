import { useEffect, useRef, useState } from 'react';
import { X, Play, Copy } from 'lucide-react';
import { getAuthToken } from '../../../lib/fetcher';
import type { SavedDetail } from './SavedRuleDetail';

interface Evaluation {
 matched: boolean; action: string; response_code: number; latency_ms: number;
 evaluation_time_ns: number; explanation: string;
 details: { field: string; operator: string; value: string; extracted_value: string; matched: boolean }[];
}
export interface PreviewRuleModalProps { isOpen: boolean; onClose: () => void; detail: SavedDetail | null }
export function PreviewRuleModal({isOpen,onClose,detail}: PreviewRuleModalProps) {
 const [url,setUrl]=useState('/'); const [method,setMethod]=useState('GET');
 const [body,setBody]=useState(''); const [headers,setHeaders]=useState('{}'); const [clientIP,setClientIP]=useState('');
 const [result,setResult]=useState<Evaluation|null>(null); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 const request=useRef<AbortController|null>(null);
 useEffect(()=>{ request.current?.abort();setResult(null);setError('');setBusy(false);setUrl('/');setBody('');setHeaders('{}');setClientIP('');return()=>request.current?.abort(); },[isOpen,detail?.id,detail?.version]);
 if(!isOpen||!detail)return null;
 const run=async()=>{
  request.current?.abort(); const controller=new AbortController();request.current=controller;
  setBusy(true);setError('');setResult(null);
  try {
   const parsedHeaders:unknown=JSON.parse(headers);
   if(!parsedHeaders||Array.isArray(parsedHeaders)||typeof parsedHeaders!=='object'||Object.values(parsedHeaders).some(v=>typeof v!=='string'))throw Error('Headers must be a JSON object of strings.');
   const token=getAuthToken();
   const response=await fetch('/api/v1/rules/test',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},credentials:'same-origin',signal:controller.signal,
    body:JSON.stringify({url,method,body,headers:parsedHeaders,client_ip:clientIP,conditions:detail.conditions,logic_mode:detail.logic_mode,action:detail.action,response_code:detail.response_code ?? 0})});
   if(!response.ok)throw Error(await response.text());
   const data=await response.json();
   if(typeof data.matched!=='boolean'||!Number.isFinite(data.latency_ms)||!Number.isFinite(data.evaluation_time_ns)||!Array.isArray(data.details))throw Error('Invalid evaluator response');
   if(!controller.signal.aborted)setResult(data);
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Evaluation failed');}
  finally{if(!controller.signal.aborted)setBusy(false);}
 };
 return <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-label="Preview rule">
  <div className="bg-card text-foreground border border-border rounded-lg p-5 w-full max-w-4xl max-h-[90vh] overflow-auto space-y-4">
   <div className="flex justify-between"><h2 className="font-semibold">Preview: {detail.name} · saved v{detail.version}</h2><button type="button" onClick={onClose} aria-label="Close preview modal"><X size={18}/></button></div>
   <p className="text-sm text-muted-foreground">Evaluates the saved match conditions on the controller. No upstream request, deployment, event logging or reputation change is performed. Scope filters and runtime enforcement are not tested here.</p>
   {!detail.runtime_ready&&<p className="text-amber-500">This definition is not supported for deployment: {detail.runtime_issues.join('; ')}</p>}
   <div className="flex gap-2"><select aria-label="Test method" value={method} onChange={e=>setMethod(e.target.value)} className="bg-background border p-2">{['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].map(m=><option key={m}>{m}</option>)}</select><input aria-label="Test URL" value={url} onChange={e=>setUrl(e.target.value)} className="bg-background border p-2 flex-1"/></div>
   <label className="block text-sm">Headers (JSON)<textarea aria-label="Test headers" value={headers} onChange={e=>setHeaders(e.target.value)} className="block w-full bg-background border p-2 font-mono"/></label>
   <label className="block text-sm">Request body<textarea aria-label="Test body" value={body} onChange={e=>setBody(e.target.value)} className="block w-full bg-background border p-2"/></label>
   <label className="block text-sm">Client IP<input aria-label="Test client IP" value={clientIP} onChange={e=>setClientIP(e.target.value)} className="block w-full bg-background border p-2"/></label>
   <button type="button" disabled={busy} onClick={run} className="bg-blue-600 text-white px-4 py-2 rounded flex items-center gap-2 disabled:opacity-50"><Play size={14}/>{busy?'Evaluating…':'Run test'}</button>
   {error&&<p role="alert" className="text-rose-500">{error}</p>}
   {result&&<section className="space-y-3" aria-label="Evaluation result"><p>{result.matched?'Conditions matched':'Conditions did not match'} · configured action: {result.action} · measured evaluation: {result.evaluation_time_ns} ns</p>
    <div className="flex justify-between"><span>Actual evaluator API response</span><button aria-label="Copy evaluation" onClick={async()=>{try{await navigator.clipboard.writeText(JSON.stringify(result,null,2));}catch{setError('Could not copy result');}}}><Copy size={16}/></button></div><pre className="text-xs p-3 bg-background overflow-auto">{JSON.stringify(result,null,2)}</pre></section>}
   <details><summary>Saved configuration</summary><pre className="text-xs overflow-auto p-3">{JSON.stringify(detail,null,2)}</pre></details>
  </div>
 </div>;
}
