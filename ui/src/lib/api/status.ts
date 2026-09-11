import { api } from '../fetcher';

export interface ControllerStatusResponse {
  component: string;
  stage: string;
  enforcement_ready: boolean | null;
  message: string;
}

export const statusApi = {
  getHealth: () => api.get<{ status: string }>('/healthz'),
  getReady: () => api.get<{ status: string }>('/readyz'),
  getStatus: () => api.get<ControllerStatusResponse>('/api/v1/status'),
};
