import { api } from '../fetcher';
export interface PolicyRule { id:number; version:number; name:string; group:string; action:string; enabled:boolean; runtime_ready:boolean }
export interface PolicyDocument { name:string; description:string; host:string; path_prefix:string; mode:'mixed'|'block'|'detect'; priority:number; rule_ids:number[]; rules:PolicyRule[] }
export interface SavedPolicy { id:number; version:number; published_version:number|null; status:'Draft'|'Published'|'Disabled'; document:PolicyDocument; created_at:string; updated_at:string; actor?:string; operation?:string }
export interface PolicyRelease { release_id:number; digest:string; payload:unknown; membership:{id:number;version:number;name:string}[]; preview:boolean }
export interface ClusterPolicies { release_id:number; nodes:{id:string;release_id:number;phase:string;message:string;updated_at:string}[] }
export type PolicyDraft = Omit<PolicyDocument,'rules'> & { expected_version:number };
export const policiesApi = {
 list:()=>api.get<SavedPolicy[]>('/api/v1/policies'),
 detail:(id:number,history=false)=>api.get<SavedPolicy[]>(`/api/v1/policies/${id}`,{history}),
 catalog:()=>api.get<PolicyRule[]>('/api/v1/policies/catalog'),
 cluster:()=>api.get<ClusterPolicies>('/api/v1/policies/cluster'),
 save:(id:number|null,body:PolicyDraft,key:string)=>id?api.put<{id:number;version:number}>(`/api/v1/policies/${id}`,body,{idempotencyKey:key}):api.post<{id:number;version:number}>('/api/v1/policies',body,{idempotencyKey:key}),
 restore:(id:number,version:number,restore:number,key:string)=>api.put(`/api/v1/policies/${id}`,{expected_version:version,restore_version:restore},{idempotencyKey:key}),
 publish:(id:number,version:number,head:number,disable:boolean,key:string,preview=false)=>api.post<PolicyRelease>(`/api/v1/policies/${id}/publish${preview?'?preview=true':''}`,{expected_version:version,expected_release:head,disable},{idempotencyKey:key}),
};
