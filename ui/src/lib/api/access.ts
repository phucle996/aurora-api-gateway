import { api } from '../fetcher';

export interface AccessRuleDocument {
  name: string;
  description: string;
  action: 'allow' | 'block' | 'log';
  enabled: boolean;
  priority: number;
  source: 'ip' | 'cidr' | 'country' | 'asn' | 'group';
  values: string[];
  host: string;
  path_prefix: string;
  method: string;
  schedule: string;
  expires_at: number;
  log: boolean;
  reputation: boolean;
  alert: boolean;
}

export interface AccessGroupDocument {
  name: string;
  description?: string;
  networks: string[];
}

export interface AccessDatasetDocument {
  name: string;
  networks: { cidr: string; country: string; asn: string }[];
}

export interface AccessObject {
  id: number;
  kind: 'rule' | 'group' | 'dataset';
  version: number;
  document: AccessRuleDocument | AccessGroupDocument | AccessDatasetDocument;
  deleted: boolean;
  updated_at: string;
  actor: string;
}

export interface AccessStatus {
  release_id: number;
  nodes: {
    id: string;
    release_id: number;
    phase: string;
    message: string;
    updated_at: string;
  }[];
}

export interface AccessActivity {
  risk_score: number;
  node_id: string;
  rule_id: number;
  release_id: number;
  ip: string;
  action: string;
  reputation: boolean;
  alert: boolean;
  created_at: string;
}

export interface AccessChange {
  id: number;
  kind: AccessObject['kind'];
  expected_version: number;
  expected_release: number;
  delete: boolean;
  document: unknown;
}

export interface AccessCatalogCountry {
  code: string;
  cidr_count: number;
}

export interface AccessCatalogASN {
  asn: string;
  cidr_count: number;
}

export interface AccessCatalog {
  hosts: string[];
  countries: AccessCatalogCountry[];
  asns: AccessCatalogASN[];
}

export const accessApi = {
  list: (id = 0, history = false) =>
    api.get<AccessObject[]>('/api/v1/access', id ? { id, history } : {}),
  status: () => api.get<AccessStatus>('/api/v1/access/status'),
  activity: () => api.get<AccessActivity[]>('/api/v1/access/activity'),
  catalog: () => api.get<AccessCatalog>('/api/v1/access/catalog'),
  change: (body: AccessChange, key: string) =>
    api.post<{ id: number; version: number; release_id: number }>(
      '/api/v1/access/changes',
      body,
      { idempotencyKey: key }
    ),
};
