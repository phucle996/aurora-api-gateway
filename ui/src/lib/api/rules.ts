import { api } from '../fetcher';

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

export interface RuleStatsResponse {
  total_rules: number;
  active_rules: number;
  disabled_rules: number;
  blocked_requests_24h: number;
}

export interface PublishRulesResponse {
  release_id: number;
  status: string;
  published_at: string;
}

export interface ReleaseDetailResponse {
  id: number;
  rules_snapshot: any;
  created_at: string;
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

  getStats: () => api.get<RuleStatsResponse>('/api/v1/rules/stats'),

  create: (payload: CreateRulePayload, idempotencyKey?: string) =>
    api.post<RuleDetailResponse>('/api/v1/rules', payload, {
      idempotencyKey,
    }),

  update: (id: number | string, payload: Partial<CreateRulePayload>) =>
    api.put<RuleDetailResponse>(`/api/v1/rules/${id}`, payload),

  publish: (idempotencyKey?: string) =>
    api.post<PublishRulesResponse>(
      '/api/v1/rule-releases',
      undefined,
      { idempotencyKey }
    ),

  getRelease: (id: number | string) =>
    api.get<ReleaseDetailResponse>(`/api/v1/rule-releases/${id}`),
};
