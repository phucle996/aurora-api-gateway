import { api } from '../fetcher';

export interface NodeHeartbeat {
  node_id: string;
  timestamp: number;
  ip: string;
  status: NodeRecord['status'];
  sync: NodeRecord['sync'];
  ruleset: string;
}

export interface NodeRecord {
  lastHeartbeatTimestamp?: number;
  runtimeStartedAt?: number;
  id: string;
  name: string;
  hostname?: string;
  ip: string;
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
  getSyncHistory: (id: string) =>
    api.get<NodeSyncLog[]>(`/api/v1/nodes/${id}/sync-history`),
  getConfig: (id: string) =>
    api.get<{ node_id: string; path: string; config: string; fetched_at: string }>(
      `/api/v1/nodes/${id}/config`
    ),
  delete: (id: string) =>
    api.delete<{ status: string; id: string }>(`/api/v1/nodes/${id}`),
};

