import { api } from '../fetcher';

export interface AlertmanagerOverview {
  prometheus_connected: boolean;
  prometheus_latency_ms: number;
  alertmanager_connected: boolean;
  alertmanager_latency_ms: number;
  active_alerts_count: number;
  active_silences_count: number;
  total_rules_count: number;
  prometheus_url: string;
  alertmanager_url: string;
}

export interface PrometheusActiveAlert {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  state: string;
  active_at: string;
  value: string;
}

export interface PrometheusRuleItem {
  name: string;
  group: string;
  query: string;
  duration: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | string;
  state: 'firing' | 'pending' | 'inactive' | string;
  health: string;
  last_error?: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  active_alerts?: PrometheusActiveAlert[];
}

export interface AlertmanagerMatcher {
  name: string;
  value: string;
  isRegex: boolean;
  isEqual: boolean;
}

export interface AlertmanagerSilenceItem {
  id: string;
  status: 'active' | 'pending' | 'expired' | string;
  starts_at: string;
  ends_at: string;
  created_by: string;
  comment: string;
  matchers: AlertmanagerMatcher[];
}

export interface AlertmanagerSettings {
  enabled: boolean;
  alertmanager_url: string;
  prometheus_url: string;
  updated_at?: string;
}

export interface CreateSilencePayload {
  starts_at?: string;
  ends_at: string;
  created_by?: string;
  comment: string;
  matchers: AlertmanagerMatcher[];
}

export const alertsApi = {
  getOverview: () => api.get<AlertmanagerOverview>('/api/v1/integrations/alerts/overview'),
  getLiveRules: () => api.get<{ rules: PrometheusRuleItem[]; total: number }>('/api/v1/integrations/alerts/rules'),
  getFiringAlerts: () => api.get<{ alerts: PrometheusActiveAlert[]; total: number }>('/api/v1/integrations/alerts/firing'),
  getSilences: () => api.get<{ silences: AlertmanagerSilenceItem[]; total: number }>('/api/v1/integrations/alerts/silences'),
  createSilence: (payload: CreateSilencePayload) =>
    api.post<{ message: string; silence_id: string }>('/api/v1/integrations/alerts/silences', payload),
  expireSilence: (silenceId: string) =>
    api.delete<{ message: string; silence_id: string }>(`/api/v1/integrations/alerts/silences/${encodeURIComponent(silenceId)}`),
  getConfig: () => api.get<AlertmanagerSettings>('/api/v1/integrations/alerts/config'),
  updateConfig: (payload: { enabled: boolean; alertmanager_url: string; prometheus_url: string }) =>
    api.put<{ message: string }>('/api/v1/integrations/alerts/config', payload),
};
