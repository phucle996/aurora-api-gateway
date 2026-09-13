import { api } from '../fetcher';

export interface SystemInfo {
  product: string;
  version: string;
  build: string;
  go_version: string;
  uptime_seconds: number;
  uptime_formatted: string;
  architecture: string;
  state_persistence: string;
  database_path: string;
  database_size_bytes: number;
  database_size_formatted: string;
  memory_alloc_bytes: number;
  memory_alloc_formatted: string;
}

export const systemApi = {
  getInfo: () => api.get<SystemInfo>('/api/v1/system/info'),
};
