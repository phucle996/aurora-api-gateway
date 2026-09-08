import { api } from '../fetcher';

export interface RateLimitIpConfig {
  source: string;
  subnet_mask: string;
}

export interface RateLimitHeaderConfig {
  header_name: string;
  operator: string;
  header_value: string;
  case_sensitive: boolean;
}

export interface RateLimitPathConfig {
  path: string;
  match_type: string;
}

export interface CreateRateLimitRuleRequest {
  name: string;
  description: string;
  enabled_dimensions: string[];
  dimension_order: string[];
  ip_config: RateLimitIpConfig;
  header_config: RateLimitHeaderConfig;
  path_config: RateLimitPathConfig;
  rate_limit: number;
  rate_unit: string;
  burst: number;
  action_exceeded: string;
  custom_response: boolean;
  response_code: number;
  response_body: string;
  log_events: boolean;
  add_reputation: boolean;
  enable_alert: boolean;
  status: string;
}

export interface ListRateLimitRulesParams extends Record<string, string | number | boolean | null | undefined> {
  search?: string;
  status?: string;
  page?: number;
  limit?: number;
}

export interface RateLimitStats {
  mode?: string;
  enabled?: boolean;
  total_hits: number;
  total_blocked: number;
  total_throttled: number;
  avg_latency_ms: number;
  hits_change_pct: number;
  blocked_change_pct: number;
  throttled_change_pct: number;
  latency_change_pct: number;
}

export interface RateLimitHourlyMetric {
  timestamp: string;
  total_hits: number;
  blocked_count: number;
  throttled_count: number;
}

export interface RateLimitTopEndpoint {
  endpoint: string;
  method: string;
  rule_name: string;
  requests: number;
  blocked: number;
  block_ratio: number;
}

export interface RateLimitMetricsResponse {
  mode?: string;
  enabled?: boolean;
  range: string;
  sort: string;
  velocity_series: RateLimitHourlyMetric[];
  top_endpoints: RateLimitTopEndpoint[];
}

export const rateLimitsApi = {
  create: async (data: CreateRateLimitRuleRequest) => {
    return api.post<any>('/api/v1/rate-limits', data);
  },
  list: async (params?: ListRateLimitRulesParams) => {
    return api.get<any>('/api/v1/rate-limits', params);
  },
  getById: async (id: number | string) => {
    return api.get<any>(`/api/v1/rate-limits/${id}`);
  },
  delete: async (id: number | string) => {
    return api.delete<any>(`/api/v1/rate-limits/${id}`);
  },
  getStats: async () => {
    return api.get<RateLimitStats>('/api/v1/rate-limits/stats');
  },
  getMetrics: async (params?: { range?: string; sort?: string }) => {
    return api.get<RateLimitMetricsResponse>('/api/v1/rate-limits/metrics', params);
  },
};
