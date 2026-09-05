/**
 * Aurora WAF API Services
 * Typed service calls for Status, Rules, Policies, Nodes, and Security Events.
 */

import { api, fetcher, API_BASE_URL, ApiError } from './fetcher';

export { api, fetcher, API_BASE_URL, ApiError };

/**
 * Health & Operational Status API
 */
export const statusApi = {
  getHealth: () => api.get<{ status: string }>('/healthz'),
  getReady: () => api.get<{ status: string }>('/readyz'),
  getStatus: () =>
    api.get<{
      version: string;
      active_release_id: string;
      rules_count: number;
      uptime_seconds: number;
      cluster_health: string;
    }>('/api/v1/status'),
};

/**
 * Rules Management API
 */
export interface RuleListItem {
  id: number;
  name: string;
  group: string;
  action: string;
  severity: string;
  priority: number;
  enabled: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface RuleListResponse {
  rules: RuleListItem[];
  next_cursor?: number;
  total_count?: number;
}

export interface RuleDetailResponse {
  id: number;
  name: string;
  description: string;
  group: string;
  action: string;
  severity: string;
  priority: number;
  enabled: boolean;
  version: number;
  conditions: Array<{
    field: string;
    operator: string;
    value: string;
  }>;
  created_at: string;
  updated_at: string;
}

export interface CreateRulePayload {
  name: string;
  description?: string;
  group?: string;
  action: string;
  severity?: string;
  priority: number;
  enabled: boolean;
  conditions: Array<{
    field: string;
    operator: string;
    value: string;
  }>;
}

export const rulesApi = {
  list: (params?: {
    limit?: number;
    after?: number;
    search?: string;
    group?: string;
    action?: string;
    severity?: string;
    enabled?: string;
  }) => api.get<RuleListResponse>('/api/v1/rules', params),

  getById: (id: number | string) =>
    api.get<RuleDetailResponse>(`/api/v1/rules/${id}`),

  getHistory: (id: number | string) =>
    api.get<any[]>(`/api/v1/rules/${id}/history`),

  getStats: () =>
    api.get<{
      total_rules: number;
      active_rules: number;
      disabled_rules: number;
      blocked_requests_24h: number;
    }>('/api/v1/rules/stats'),

  create: (payload: CreateRulePayload, idempotencyKey?: string) =>
    api.post<RuleDetailResponse>('/api/v1/rules', payload, {
      idempotencyKey,
    }),

  update: (id: number | string, payload: Partial<CreateRulePayload>) =>
    api.put<RuleDetailResponse>(`/api/v1/rules/${id}`, payload),

  publish: (idempotencyKey?: string) =>
    api.post<{ release_id: number; status: string; published_at: string }>(
      '/api/v1/rule-releases',
      undefined,
      { idempotencyKey }
    ),

  getRelease: (id: number | string) =>
    api.get<{ id: number; rules_snapshot: any; created_at: string }>(
      `/api/v1/rule-releases/${id}`
    ),
};

/**
 * IP & Access Control Rules API
 */
export const ipAccessApi = {
  list: (params?: { search?: string; type?: string; status?: string }) =>
    api.get<any[]>('/api/v1/ip-access', params),

  create: (payload: any) => api.post<any>('/api/v1/ip-access', payload),

  delete: (id: string | number) => api.delete(`/api/v1/ip-access/${id}`),
};

/**
 * Rate Limiting API
 */
export const rateLimitsApi = {
  list: (params?: { search?: string; status?: string }) =>
    api.get<any[]>('/api/v1/rate-limits', params),

  create: (payload: any) => api.post<any>('/api/v1/rate-limits', payload),

  update: (id: string | number, payload: any) =>
    api.put<any>(`/api/v1/rate-limits/${id}`, payload),

  delete: (id: string | number) => api.delete(`/api/v1/rate-limits/${id}`),
};

/**
 * Nodes & Cluster API
 */
export const nodesApi = {
  list: () => api.get<any[]>('/api/v1/nodes'),
  getById: (id: string) => api.get<any>(`/api/v1/nodes/${id}`),
  generateBootstrapToken: () =>
    api.post<{ token: string; expires_at: string }>(
      '/api/v1/nodes/bootstrap-token'
    ),
};
