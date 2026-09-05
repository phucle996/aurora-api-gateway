import { api } from '../fetcher';

export interface MetricsConfigResponse {
  mode: 'standalone' | 'prometheus' | 'disabled';
  prometheus_url: string;
  prometheus_job: string;
  updated_at: string;
}

export interface UpdateMetricsConfigPayload {
  mode: string;
  prometheus_url: string;
  prometheus_job: string;
}

export interface TestConnectionResponse {
  success: boolean;
  message: string;
  latency_ms: number;
}

export const integrationsApi = {
  getMetricsConfig: () =>
    api.get<MetricsConfigResponse>('/api/v1/settings/integrations/metrics'),

  updateMetricsConfig: (payload: UpdateMetricsConfigPayload) =>
    api.put<any>('/api/v1/settings/integrations/metrics', payload),

  testPrometheus: (url: string) =>
    api.post<TestConnectionResponse>(
      '/api/v1/settings/integrations/metrics/test',
      { url }
    ),
};
