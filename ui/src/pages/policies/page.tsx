import React, {useCallback,useEffect,useState} from 'react';
import { Link } from 'react-router-dom';
import { PoliciesStats } from './sections/PoliciesStats';
import { PoliciesTable, type PolicyItem } from './sections/PoliciesTable';
import { PolicyDetail } from './sections/PolicyDetail';
import { policiesApi, type SavedPolicy, type ClusterPolicies } from '../../lib/api/policies';

export default function PoliciesPage(){
 const [policies,setPolicies]=useState<SavedPolicy[]>([]);
 const [cluster,setCluster]=useState<ClusterPolicies|null>(null);
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const [search,setSearch]=useState('');const [filter,setFilter]=useState('All Statuses');
 const [error,setError]=useState('');const [loaded,setLoaded]=useState(false);
 const refresh=useCallback(async()=>{try{const [rows,state]=await Promise.all([policiesApi.list(),policiesApi.cluster()]);setPolicies(rows);setCluster(state);setError('');setLoaded(true)}catch(e){setError(e instanceof Error?e.message:String(e))}},[]);
 useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),5000);return()=>clearInterval(timer)},[refresh]);
 const rows:PolicyItem[]=policies.map(p=>({id:String(p.id),name:p.document.name,description:p.document.description,scope:p.document.host+p.document.path_prefix,mode:p.document.mode==='block'?'Block':p.document.mode==='detect'?'Detect':'Mixed',ruleSetsCount:p.document.rules.length,lastUpdated:new Date(p.updated_at).toLocaleString(),status:p.status,priority:p.document.priority<100?'High':p.document.priority<1000?'Medium':'Low',ruleGroups:[...new Set(p.document.rules.map(r=>r.group))]}));
 const selected=policies.find(p=>String(p.id)===selectedId);
 const filtered=rows.filter(p=>(filter==='All Statuses'||p.status===filter)&&`${p.name} ${p.scope}`.toLowerCase().includes(search.toLowerCase()));
 return <div className="p-6 space-y-4">
  <div className="flex justify-between border-b border-[#152030] pb-3"><div><h1 className="text-xl font-bold text-white">Policies</h1><p className="text-xs text-slate-400">Cluster-wide policy management. Drafts do not change running traffic.</p></div><Link className="bg-emerald-600 text-white px-4 py-2" to="/policies/create">Create Policy</Link></div>
  {error&&<div role="alert" className="text-rose-300">{error} <button onClick={()=>void refresh()}>Retry</button></div>}
  {!loaded&&!error&&<p role="status">Loading policies…</p>}
  {loaded&&<><PoliciesStats policies={policies}/>
   <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start"><PoliciesTable policies={filtered} selectedId={selectedId||''} onSelect={id=>setSelectedId(id===selectedId?null:id)} searchQuery={search} onSearchChange={setSearch} statusFilter={filter} onStatusFilterChange={setFilter}/>
    {selected&&cluster&&<PolicyDetail key={selected.id} policy={selected} cluster={cluster} onChanged={refresh} onClose={()=>setSelectedId(null)}/>}
   </div>{filtered.length===0&&<p>No policies found.</p>}
  </>}
 </div>;
}
