import { api } from '../fetcher';
import type { DomainItem } from '../../pages/domains/types';

export interface ListDomainsParams extends Record<string, string | number | boolean | null | undefined> {
  search?: string;
  status?: string;
  tls_type?: string;
  tag?: string;
  page?: number;
  limit?: number;
}

export interface ListDomainsResponse {
  items: DomainItem[];
  counts: {
    total: number;
    active: number;
    inactive: number;
    mtls_enabled: number;
  };
  total_filtered: number;
  page: number;
  limit: number;
}

export interface DomainCatalogItem {
  id: number;
  domain: string;
  root_domain: string;
  status: string;
  upstream?: string;
}

export interface CreateDomainPayload {
  domain: string;
  root_domain?: string;
  status?: string;
  tls_type?: string;
  min_tls_version?: string;
  hsts_enabled?: boolean;
  ocsp_stapling?: boolean;
  client_ca_subject?: string;
  upstream: string;
  upstream_algorithm?: string;
  health_check_path?: string;
  tags?: string[];
  description?: string;
}

export interface UpdateDomainPayload {
  status?: string;
  tls_type?: string;
  min_tls_version?: string;
  hsts_enabled?: boolean;
  ocsp_stapling?: boolean;
  client_ca_subject?: string;
  upstream: string;
  upstream_algorithm?: string;
  health_check_path?: string;
  tags?: string[];
  description?: string;
}

// This private boundary mapping keeps the server's snake_case contract consistent
// across reads and mutation responses; no browser persistence is authoritative.
type DomainResponse = {
 id: number; domain: string; root_domain: string; status: DomainItem['status'];
 tls_type: DomainItem['tlsType']; tls_expiry?: string; tls_auto_renew?: boolean;
 min_tls_version?: DomainItem['minTlsVersion']; hsts_enabled?: boolean; ocsp_stapling?: boolean;
 client_ca_subject?: string; upstream: string; upstream_algorithm?: DomainItem['upstreamAlgorithm'];
 health_check_path?: string; rules_count: number; policies_count: number; ip_rules_count: number;
 rate_limits_count: number; tags: string[]; created_at: string; updated_at: string; created_by: string; description: string;
};
function domainFromResponse(d: DomainResponse): DomainItem {
 return { id: String(d.id), domain: d.domain, rootDomain: d.root_domain, status: d.status,
 tlsType: d.tls_type, tlsExpiry: d.tls_expiry, tlsAutoRenew: d.tls_auto_renew,
 minTlsVersion: d.min_tls_version, hstsEnabled: d.hsts_enabled, ocspStapling: d.ocsp_stapling,
 clientCaSubject: d.client_ca_subject, upstream: d.upstream, upstreamAlgorithm: d.upstream_algorithm,
 healthCheckPath: d.health_check_path, rulesCount: d.rules_count, policiesCount: d.policies_count,
 ipRulesCount: d.ip_rules_count, rateLimitsCount: d.rate_limits_count, tags: d.tags ?? [],
 createdAt: d.created_at, updatedAt: d.updated_at, createdBy: d.created_by, description: d.description };
}
export const domainsApi = {
 list: async (params?: ListDomainsParams): Promise<ListDomainsResponse> => {
  const result = await api.get<Omit<ListDomainsResponse, 'items'> & {items: DomainResponse[]}>('/api/v1/domains', params);
  return {...result, items: result.items.map(domainFromResponse)};
 },
 catalog: () => api.get<DomainCatalogItem[]>('/api/v1/domains/catalog'),
 get: async (id: string | number) => domainFromResponse(await api.get<DomainResponse>(`/api/v1/domains/${id}`)),
 create: async (payload: CreateDomainPayload) => domainFromResponse(await api.post<DomainResponse>('/api/v1/domains', payload)),
 update: async (id: string | number, payload: UpdateDomainPayload) => domainFromResponse(await api.put<DomainResponse>(`/api/v1/domains/${id}`, payload)),
 delete: (id: string | number) => api.delete<{status: string; id: number}>(`/api/v1/domains/${id}`),
};
