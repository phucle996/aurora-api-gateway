import { api } from '../fetcher';

export interface AnalyticsQueryItem {
  id: string;
  metric_key: string;
  aggregation?: string;
  filters?: Record<string, string>;
  group_by?: string[];
}

export interface AnalyticsQueryRequest {
  source_id: string;
  queries: AnalyticsQueryItem[];
  start: number;
  end: number;
  step_seconds: number;
}

export interface AnalyticsRawQueryRequest {
  source_id: string;
  query: string;
  start: number;
  end: number;
  step_seconds: number;
}

export interface AnalyticsSeries {
  query_id: string;
  metric_key: string;
  labels: Record<string, string>;
  timestamps: number[];
  values: number[];
}

export interface AnalyticsQueryResponse {
  series: AnalyticsSeries[];
  execution_time_ms: number;
  total_series: number;
}

export interface MetricDefinition {
  key: string;
  name: string;
  unit: string;
  description: string;
  supported_aggregations: string[];
  supported_group_by: string[];
  extension_required?: string;
  promql_template: string;
}

export interface MetricCatalogCategory {
  id: string;
  name: string;
  description: string;
  extension_required?: string;
  metrics: MetricDefinition[];
}

export interface TelemetrySourceInfo {
  id: string;
  name: string;
  type: string;
  status: 'connected' | 'unreachable' | 'disabled';
  url?: string;
}

export interface MetricCatalogResponse {
  sources: TelemetrySourceInfo[];
  categories: MetricCatalogCategory[];
}

// ─── Connection & Enterprise Security Models ───────────────────────────────

export interface ConnectionConfig {
  mode: 'prometheus' | 'disabled';
  prometheus_url: string;
  prometheus_job: string;

  // Authentication
  auth_type: 'none' | 'bearer' | 'basic' | 'headers';
  auth_token?: string;
  auth_username?: string;
  auth_password?: string;
  custom_headers?: Record<string, string>;

  // TLS & mTLS
  tls_enabled?: boolean;
  insecure_skip?: boolean;
  ca_cert_pem?: string;
  client_cert_pem?: string;
  client_key_pem?: string;

  updated_at?: string;
}

export interface RuntimeMetadata {
  engine: string;
  version: string;
  revision?: string;
  latency_ms: number;
  active_targets: number;
  total_targets: number;
  status: 'connected' | 'unreachable' | 'disabled';
  last_checked_at: number;
  error_message?: string;
}

export interface ConnectionStatusResponse {
  extension_enabled: boolean;
  config: ConnectionConfig;
  metadata?: RuntimeMetadata;
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
  latency_ms: number;
  metadata?: RuntimeMetadata;
}

export const analyticsApi = {
  query: (payload: AnalyticsQueryRequest) =>
    api.post<AnalyticsQueryResponse>('/api/v1/analytics/query', payload),

  queryRaw: (payload: AnalyticsRawQueryRequest) =>
    api.post<AnalyticsQueryResponse>('/api/v1/analytics/query-raw', payload),

  getCatalog: () =>
    api.get<MetricCatalogResponse>('/api/v1/analytics/catalog'),

  getConnection: () =>
    api.get<ConnectionStatusResponse>('/api/v1/analytics/connection'),

  updateConnection: (payload: ConnectionConfig) =>
    api.put<{ message: string }>('/api/v1/analytics/connection', payload),

  testConnection: (payload: ConnectionConfig) =>
    api.post<TestConnectionResult>('/api/v1/analytics/connection/test', payload),
};
