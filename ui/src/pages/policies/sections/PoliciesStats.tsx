import React from 'react';
import type { SavedPolicy } from '../../../lib/api/policies';
export function PoliciesStats({policies}:{policies:SavedPolicy[]}) {
 const counts = [
  ['Total policies',policies.length],
  ['Published policies',policies.filter(p=>p.published_version!==null).length],
  ['Unpublished changes',policies.filter(p=>p.published_version!==p.version).length],
  ['Created this month',policies.filter(p=>p.created_at.slice(0,7)===new Date().toISOString().slice(0,7)).length],
 ];
 return <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">{counts.map(([label,value])=><div key={label} className="bg-[#0B1320] border border-[#172338] p-4"><div className="text-xs text-slate-400 uppercase">{label}</div><div className="text-2xl text-white font-mono mt-2">{value}</div></div>)}</div>;
}
