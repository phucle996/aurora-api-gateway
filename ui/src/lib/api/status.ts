import { api } from '../fetcher';

export interface SystemStatusResponse {
  version: string;
  active_release_id: string;
  rules_count: number;
  uptime_seconds: number;
  cluster_health: string;
}

export const statusApi = {
  getHealth: () => api.get<{ status: string }>('/healthz'),
  getReady: () => api.get<{ status: string }>('/readyz'),
  getStatus: () => api.get<SystemStatusResponse>('/api/v1/status'),
};
