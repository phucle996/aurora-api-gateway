import React,{useEffect,useRef,useState} from 'react';
import {Link,useNavigate,useSearchParams} from 'react-router-dom';
import {accessApi,type AccessRuleDocument,type AccessObject} from '../../lib/api/access';

export function CreateIpRulePage(){
 const [params]=useSearchParams();const navigate=useNavigate();const id=Number(params.get('edit')||0);const clone=Number(params.get('clone')||0);
 const [form,setForm]=useState<AccessRuleDocument>({name:'',description:'',action:'block',enabled:true,priority:100,source:'ip',values:[],host:'*',path_prefix:'/',method:'*',schedule:'always',expires_at:0,log:true,reputation:false,alert:false});
 const [values,setValues]=useState('');const [objects,setObjects]=useState<AccessObject[]>([]);const [authority,setAuthority]=useState<{version:number;release:number}|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const receipt=useRef<{body:string;key:string}|null>(null);
 useEffect(()=>{let live=true;setAuthority(null);Promise.all([accessApi.list(),accessApi.status()]).then(([items,status])=>{if(!live)return;setObjects(items);const item=items.find(x=>x.id===(id||clone)&&x.kind==='rule');if((id||clone)&&!item)throw Error('Access rule not found');if(item){const doc=item.document as AccessRuleDocument;setForm({...doc,name:doc.name+(clone?' (copy)':'')});setValues(doc.values.join('\n'))}setAuthority({version:id?item!.version:0,release:status.release_id})}).catch(e=>{if(live)setError(String(e))});return()=>{live=false}},[id,clone]);
 async function save(e:React.FormEvent){e.preventDefault();if(!authority||busy)return;setBusy(true);setError('');const doc={...form,values:values.split(/[\s,]+/).filter(Boolean)};const command={id,kind:'rule' as const,expected_version:authority.version,expected_release:authority.release,delete:false,document:doc};const body=JSON.stringify(command);if(receipt.current?.body!==body)receipt.current={body,key:crypto.randomUUID()};try{await accessApi.change(command,receipt.current.key);navigate('/ip-access')}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 const input='block mt-1 w-full bg-[#0E1726] border border-[#1C293D] p-2 text-sm';
 return <form onSubmit={save} className="p-6 space-y-5">
  <Link to="/ip-access" className="text-emerald-400 text-sm">← IP & Access Control</Link>
  <h1 className="text-xl font-bold">{id?'Edit':clone?'Clone':'Add'} Access Rule</h1>
  <p className="text-sm text-slate-400">Saving requests deployment to all configured nodes. Lowest priority number wins; ties use rule ID. The first matching access rule wins. Allowed requests continue through WAF policies.</p>
  {error&&<div role="alert" className="text-rose-300">{error} <button type="button" onClick={()=>location.reload()} className="underline">Reload latest configuration</button></div>}
  {!authority&&!error&&<p role="status">Loading configuration…</p>}
  <fieldset disabled={!authority||busy} className="grid lg:grid-cols-2 gap-4 disabled:opacity-50">
   <section className="border border-[#172338] bg-[#0B1320] p-4 space-y-3"><h2 className="font-semibold">Basic information</h2>
    <label className="block text-sm">Rule name<input required maxLength={120} className={input} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
    <label className="block text-sm">Description<textarea maxLength={2000} className={input} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
    <label htmlFor="access-action" className="block text-sm">Action</label><select id="access-action" className={input} value={form.action} onChange={e=>setForm({...form,action:e.target.value as AccessRuleDocument['action']})}><option value="block">Block (403)</option><option value="allow">Allow through access control</option><option value="log">Log only</option></select>
    <label className="block text-sm">Priority<input required type="number" min={0} max={1000000} className={input} value={form.priority} onChange={e=>setForm({...form,priority:Number(e.target.value)})}/></label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={e=>setForm({...form,enabled:e.target.checked})}/>Enabled</label>
   </section>
   <section className="border border-[#172338] bg-[#0B1320] p-4 space-y-3"><h2 className="font-semibold">Source</h2>
    <label htmlFor="access-source" className="block text-sm">Source type</label><select id="access-source" className={input} value={form.source} onChange={e=>{setForm({...form,source:e.target.value as AccessRuleDocument['source']});setValues('')}}>{[['ip','IP address'],['cidr','CIDR / Network'],['country','Country'],['asn','ASN'],['group','IP group']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
    {form.source==='group'?<div className="space-y-2">{objects.filter(o=>o.kind==='group').map(o=><label key={o.id} className="flex gap-2 text-sm"><input type="checkbox" checked={values.split('\n').includes(String(o.id))} onChange={e=>setValues(e.target.checked?[...values.split('\n').filter(Boolean),String(o.id)].join('\n'):values.split('\n').filter(v=>v!==String(o.id)).join('\n'))}/>{o.document.name}</label>)}<Link to="/ip-access?tab=groups" className="text-sm text-emerald-400">Manage groups</Link></div>:<label className="block text-sm">Source values (one per line)<textarea required rows={6} className={input+' font-mono'} value={values} onChange={e=>setValues(e.target.value)} placeholder={form.source==='country'?'VN\nUS':form.source==='asn'?'AS13335':form.source==='cidr'?'192.0.2.0/24\n2001:db8::/32':'192.0.2.1\n2001:db8::1'}/></label>}
    {(form.source==='country'||form.source==='asn')&&<p className="text-xs text-amber-300">Matches only networks in your imported datasets. Import coverage before enabling this rule. <Link to="/ip-access?tab=datasets" className="underline">Manage datasets</Link></p>}
   </section>
   <section className="border border-[#172338] bg-[#0B1320] p-4 space-y-3"><h2 className="font-semibold">Scope & duration</h2>
    <label className="block text-sm">Host (* for all)<input required className={input} value={form.host} onChange={e=>setForm({...form,host:e.target.value})}/></label>
    <label className="block text-sm">Path prefix<input required className={input} value={form.path_prefix} onChange={e=>setForm({...form,path_prefix:e.target.value})}/></label><p className="text-xs text-slate-400">/admin matches /admin and /admin/…, with a path segment boundary.</p>
    <label htmlFor="access-method" className="block text-sm">HTTP method</label><select id="access-method" className={input} value={form.method} onChange={e=>setForm({...form,method:e.target.value})}>{['*','GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS','CONNECT','TRACE'].map(x=><option key={x}>{x}</option>)}</select>
    <label htmlFor="access-schedule" className="block text-sm">Schedule (UTC)</label><select id="access-schedule" className={input} value={form.schedule} onChange={e=>setForm({...form,schedule:e.target.value})}>{[['always','Always'],['business_hours','Mon–Fri 09:00–18:00 UTC'],['weekend','Saturday & Sunday UTC'],['night','22:00–06:00 UTC']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
    <label className="block text-sm">Expires at (UTC, empty = permanent)<input type="datetime-local" className={input} value={form.expires_at?new Date(form.expires_at*1000).toISOString().slice(0,16):''} onChange={e=>setForm({...form,expires_at:e.target.value?Math.floor(Date.parse(e.target.value+'Z')/1000):0})}/></label>
    <p className="text-xs text-slate-400">Schedules and temporary bans use each node’s UTC clock and keep working while the controller is offline.</p>
   </section>
   <section className="border border-[#172338] bg-[#0B1320] p-4 space-y-3"><h2 className="font-semibold">Match activity</h2>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.log} onChange={e=>setForm({...form,log:e.target.checked})}/>Log matching requests</label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.reputation} onChange={e=>setForm({...form,reputation:e.target.checked})}/>Increase matched IP risk score</label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.alert} onChange={e=>setForm({...form,alert:e.target.checked})}/>Create in-app alert</label>
    <p className="text-xs text-slate-400">Activity is sampled up to 100 matches per worker per second and delivered asynchronously. Each recorded reputation match adds one risk point, capped at 1000. Scores do not create extra blocking rules. Alerts appear in Access Activity.</p>
    <h3 className="font-semibold pt-3">Preview</h3><p className="text-sm break-words">{form.action.toUpperCase()} · {form.host}{form.path_prefix} · {form.method==='*'?'All methods':form.method} · {values.split(/[\s,]+/).filter(Boolean).length} source values</p>
   </section>
   <div className="flex gap-3"><Link to="/ip-access" className="border border-slate-700 px-4 py-2">Cancel</Link><button className="bg-emerald-600 px-4 py-2" type="submit">{busy?'Saving…':id?'Save & apply':'Create & apply'}</button></div>
  </fieldset>
 </form>
}
export default CreateIpRulePage;
