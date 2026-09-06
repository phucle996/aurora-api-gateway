import { api } from '../fetcher';

export interface RuleListItem {
  id: string;
  name: string;
  group: string;
  action: string;
  severity: string;
  priority: number;
  score?: number;
  path?: string;
  enabled: boolean;
  version: number;
  schema_version: number;
  runtime_ready: boolean;
  updated_at: string;
}

export interface RuleListResponse {
  items: RuleListItem[];
  total: number;
  next_after?: string;
}

export interface RuleConditionItem {
  field: string;
  operator: string;
  value: string;
  header_name?: string;
}

export interface RuleDetailResponse {
  id: string;
  version: number;
  schema_version: number;
  name: string;
  description: string;
  group: string;
  action: string;
  severity: string;
  score: number;
  priority: number;
  path?: string;
  enabled: boolean;
  assigned_policies: number;
  created_at: string;
  created_by: string;
  updated_at: string;
  runtime_ready: boolean;
  runtime_issues: string[];
  logic_mode: string;
  conditions: RuleConditionItem[];
  source_ip: string;
  host_domain: string;
  path_prefix: string;
  http_method: string;
  response_code: number | null;
  custom_response: string;
  log_event: boolean;
  add_to_reputation: boolean;
}

export interface CreateRuleDefinitionPayload {
  name: string;
  description?: string;
  group: string;
  severity: string;
  score: number;
  enabled: boolean;
  priority: number;
  policy_id?: number | null;
  logic_mode: 'all' | 'any';
  conditions: RuleConditionItem[];
  action: 'allow' | 'log' | 'block';
  response_code?: number | null;
  custom_response?: string;
  log_event?: boolean;
  add_to_reputation?: boolean;
  source_ip?: string;
  host_domain?: string;
  path_prefix?: string;
  http_method?: string;
}

export interface UpdateRuleDefinitionPayload extends CreateRuleDefinitionPayload {
  expected_version: number;
}

export interface RuleHistoryItem {
  version: number;
  score: number;
  schema_version: number;
  source_ip: string;
  host_domain: string;
  path_prefix: string;
  http_method: string;
  log_event: boolean;
  add_to_reputation: boolean;
  name: string;
  description: string;
  group: string;
  action: string;
  severity: string;
  priority: number;
  path: string;
  enabled: boolean;
  actor: string;
  updated_at: string;
  logic_mode: string;
  conditions_json: string;
  response_code: number | null;
  custom_response: string;
}

export interface RuleHistoryResponse {
  items: RuleHistoryItem[];
  next_before?: number;
}

export interface RuleStatsResponse {
  as_of: string;
  comparison_before: string;
  history_available: boolean;
  total: number;
  enabled: number;
  log: number;
  block: number;
  total_delta: number | null;
  enabled_delta: number | null;
  log_delta: number | null;
  block_delta: number | null;
}

export interface RollbackRuleResponse {
  id: number;
  version: number;
  target_version: number;
  name: string;
  action: string;
  enabled: boolean;
  message: string;
}

export const rulesApi = {
  list: (params?: {
    limit?: number;
    after?: string | number;
    search?: string;
    group?: string;
    action?: string;
    severity?: string;
    enabled?: string;
  }) => api.get<RuleListResponse>('/api/v1/rules', params),

  getById: (id: number | string) =>
    api.get<RuleDetailResponse>(`/api/v1/rules/${encodeURIComponent(String(id))}`),

  getHistory: (id: number | string, params?: { limit?: number; before?: number }) =>
    api.get<RuleHistoryResponse>(`/api/v1/rules/${encodeURIComponent(String(id))}/history`, params),

  getStats: () => api.get<RuleStatsResponse>('/api/v1/rules/stats'),

  createDefinition: (payload: CreateRuleDefinitionPayload, idempotencyKey?: string) =>
    api.post<{ id: string; version: number; state: string; runtime_ready: boolean; runtime_issues: string[] }>(
      '/api/v2/rules',
      payload,
      { idempotencyKey: idempotencyKey || crypto.randomUUID() }
    ),

  updateDefinition: (id: number | string, payload: UpdateRuleDefinitionPayload, idempotencyKey?: string) =>
    api.put<{ id: string; version: number; state: string; runtime_ready: boolean; runtime_issues: string[] }>(
      `/api/v2/rules/${encodeURIComponent(String(id))}`,
      payload,
      { idempotencyKey: idempotencyKey || crypto.randomUUID() }
    ),

  delete: (id: number | string, expectedVersion: number) =>
    api.delete<{ id: string; version: number; state: string }>(
      `/api/v1/rules/${encodeURIComponent(String(id))}`,
      { body: { expected_version: expectedVersion } }
    ),

  rollback: (id: number | string, targetVersion: number, expectedVersion: number) =>
    api.post<RollbackRuleResponse>(
      `/api/v1/rules/${encodeURIComponent(String(id))}/rollback`,
      { target_version: targetVersion, expected_version: expectedVersion }
    ),
};
