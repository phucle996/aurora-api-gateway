import { api } from '../fetcher';

export type NotificationChannelId = 'email' | 'slack' | 'telegram' | 'discord' | 'webhook' | 'pagerduty';

export interface NotificationChannelItem {
  id: NotificationChannelId;
  name: string;
  description: string;
  enabled: boolean;
  config_json: string;
  last_tested_at: string;
  last_test_status: 'success' | 'failed' | '' | string;
  last_test_message: string;
  updated_at: string;
}

export interface NotificationRuleItem {
  id: string;
  name: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  enabled: boolean;
  updated_at: string;
}

export interface NotificationOverview {
  channels: NotificationChannelItem[];
  rules: NotificationRuleItem[];
}

export interface TestNotificationResult {
  success: boolean;
  message: string;
  latency_ms: number;
}

export const notificationsApi = {
  getOverview: () => api.get<NotificationOverview>('/api/v1/settings/notifications'),
  updateChannel: (id: string, enabled: boolean, configJSON: string) =>
    api.put<{ message: string; id: string; enabled: boolean }>(`/api/v1/settings/notifications/channels/${id}`, {
      enabled,
      config_json: configJSON,
    }),
  updateRule: (id: string, enabled: boolean) =>
    api.put<{ message: string; id: string; enabled: boolean }>(`/api/v1/settings/notifications/rules/${id}`, {
      enabled,
    }),
  testChannel: (id: string) =>
    api.post<TestNotificationResult>(`/api/v1/settings/notifications/channels/${id}/test`, {}),
};
