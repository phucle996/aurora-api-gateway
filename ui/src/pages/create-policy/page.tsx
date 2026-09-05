import React,{useEffect,useRef,useState} from 'react';
import {Link,useNavigate,useSearchParams} from 'react-router-dom';
import {policiesApi,type PolicyDraft,type PolicyRule} from '../../lib/api/policies';

export default function CreatePolicyPage(){
 const [params]=useSearchParams();const navigate=useNavigate();
 const source=params.get('edit')||params.get('clone');const editing=params.has('edit');
 const [form,setForm]=useState<PolicyDraft>({name:'',description:'',host:'*',path_prefix:'/',mode:'mixed',priority:100,rule_ids:[],expected_version:0});
 const [rules,setRules]=useState<PolicyRule[]>([]);const [ready,setReady]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const retry=useRef<{body:string;key:string}|null>(null);
 useEffect(()=>{let live=true;setReady(false);
  Promise.all([policiesApi.catalog(),source?policiesApi.detail(Number(source)):Promise.resolve([])]).then(([catalog,rows])=>{
   if(!live)return;setRules(catalog);
   if(source){const p=rows[0];if(!p)throw Error('Policy not found');const d=p.document;setForm({name:d.name+(editing?'':' (copy)'),description:d.description,host:d.host,path_prefix:d.path_prefix,mode:d.mode,priority:d.priority,rule_ids:d.rule_ids,expected_version:editing?p.version:0})}
   setReady(true);
  }).catch(e=>{if(live)setError(e instanceof Error?e.message:String(e))});return()=>{live=false};
 },[source,editing]);
 async function save(e:React.FormEvent){
  e.preventDefault();if(busy||!ready)return;const body=JSON.stringify(form);
  if(retry.current?.body!==body)retry.current={body,key:crypto.randomUUID()};
  setBusy(true);setError('');
  try{await policiesApi.save(editing?Number(source):null,form,retry.current.key);retry.current=null;navigate('/policies')}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
 }
 const groups=[...new Set(rules.map(r=>r.group))];
 return <form onSubmit={save} className="p-6 space-y-4">
  <Link to="/policies" className="text-emerald-400">← Policies</Link>
  <h1 className="text-xl font-bold">{editing?'Edit policy draft':source?'Clone policy':'Create policy'}</h1>
  <p className="text-sm text-slate-400">Applies cluster-wide after preview and publish. Saving captures the current revisions of selected rules. No traffic changes on save.</p>
  {error&&<p role="alert" className="text-rose-300">{error}</p>}
  {!ready&&!error&&<p>Loading policy and rule catalog…</p>}
  <fieldset disabled={!ready||busy} className="space-y-4 disabled:opacity-50">
   <section className="grid md:grid-cols-2 gap-4 bg-[#0B1320] border border-[#172338] p-4">
    <label className="space-y-1">Name<input required maxLength={120} className="block w-full bg-slate-950 border border-slate-700 p-2" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
    <label className="space-y-1">Priority (lower wins)<input type="number" required min={0} max={1000000} className="block w-full bg-slate-950 border border-slate-700 p-2" value={form.priority} onChange={e=>setForm({...form,priority:Number(e.target.value)})}/></label>
    <label className="space-y-1">Host (* for all)<input required maxLength={253} className="block w-full bg-slate-950 border border-slate-700 p-2" value={form.host} onChange={e=>setForm({...form,host:e.target.value})}/></label>
    <label className="space-y-1">Path prefix<input required maxLength={8192} className="block w-full bg-slate-950 border border-slate-700 p-2" value={form.path_prefix} onChange={e=>setForm({...form,path_prefix:e.target.value})}/></label>
    <label>Mode<select className="block w-full bg-slate-950 border border-slate-700 p-2" value={form.mode} onChange={e=>setForm({...form,mode:e.target.value as PolicyDraft['mode']})}><option value="mixed">Mixed — respect rule actions</option><option value="detect">Detect — log matches, never block</option><option value="block">Block — preserve allow rules, block other matches</option></select></label>
    <label>Description<textarea maxLength={2000} className="block w-full bg-slate-950 border border-slate-700 p-2" value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
   </section>
   <p className="text-xs text-slate-400">Host is exact and case-insensitive. /admin matches /admin and /admin/…, not /administrator. First matching policy wins; unmatched rule paths are allowed. Rules currently match exact normalized paths. Blocking response is 403; challenge, rate-limit and custom responses are not supported here.</p>
   <section className="border border-[#172338] p-4 space-y-3"><h2>Rule groups — select actual saved rules ({form.rule_ids.length})</h2>
    {rules.length===0&&<p>No rules yet. <Link to="/rules/create" className="text-emerald-400">Create a rule</Link> first.</p>}
    {groups.map(group=><div key={group} className="border-b border-slate-800 pb-3"><div className="flex justify-between"><h3>{group}</h3><button type="button" className="text-emerald-400 text-xs" onClick={()=>{const ids=rules.filter(r=>r.group===group).map(r=>r.id);const all=ids.every(id=>form.rule_ids.includes(id));setForm({...form,rule_ids:all?form.rule_ids.filter(id=>!ids.includes(id)):[...new Set([...form.rule_ids,...ids])]})}}>Toggle group</button></div>
     {rules.filter(r=>r.group===group).map(r=><label key={r.id} className="flex items-center gap-2 text-sm py-1"><input type="checkbox" checked={form.rule_ids.includes(r.id)} onChange={()=>setForm({...form,rule_ids:form.rule_ids.includes(r.id)?form.rule_ids.filter(id=>id!==r.id):[...form.rule_ids,r.id]})}/>{r.name} · v{r.version} · {r.action}{(!r.enabled||!r.runtime_ready)&&<span className="text-amber-400">Draft only: {r.enabled?'unsupported runtime conditions':'disabled rule'}</span>}</label>)}
    </div>)}
   </section>
   <p className="text-xs text-slate-400">Audit revisions are always retained. Log actions use the existing bounded NGINX audit log, not a fabricated security-event feed.</p>
   <button className="bg-emerald-700 px-4 py-2" type="submit">{busy?'Saving…':'Save draft'}</button>
  </fieldset>
 </form>;
}
