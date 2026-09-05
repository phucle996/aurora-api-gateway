import { api } from '../fetcher';

export interface NodeRecord {
  id: string;
  name: string;
  hostname?: string;
  ip: string;
  role: string;
  status: 'Ready' | 'Not Ready' | 'Draining';
  version: string;
  active_release_id?: number;
  ruleset: string;
  sync: 'In Sync' | 'Drift' | 'Syncing';
  lastHeartbeat: string;
  created_at: string;
  joinMethod: string;
  certificate: string;
  policySync: string;
  lastSyncTime: string;
  cpuUsage: number;
  memoryUsage: number;
  activeConnections: string;
  requestsPerSecond: string;
  uptime: string;
}

export interface NodeMetricPoint {
  timestamp: number;
  timeLabel: string;
  rps: number;
  cpuUsage: number;
  memoryUsage: number;
  activeConnections: number;
}

export interface NodeSyncLog {
  id: number;
  node_id: string;
  event_type: 'release_applied' | 'reload_completed' | 'drift_detected';
  release_id?: number;
  message: string;
  created_at: string;
}

export const nodesApi = {
  list: () => api.get<NodeRecord[]>('/api/v1/nodes'),
  getById: (id: string) => api.get<NodeRecord>(`/api/v1/nodes/${id}`),
  getMetrics: (id: string) =>
    api.get<NodeMetricPoint[]>(`/api/v1/nodes/${id}/metrics`),
  getSyncHistory: (id: string) =>
    api.get<NodeSyncLog[]>(`/api/v1/nodes/${id}/sync-history`),
};

