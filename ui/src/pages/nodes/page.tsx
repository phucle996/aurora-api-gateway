import React, { useState, useEffect, useCallback, useRef } from 'react';
import { NodesStats } from './sections/NodesStats';
import { NodesTable, type NodeItem } from './sections/NodesTable';
import { NodeDetail } from './sections/NodeDetail';
import { nodesApi } from '../../lib/api';
import type { NodeHeartbeat, NodeSyncLog } from '../../lib/api/nodes';
import { API_BASE_URL, getAuthToken } from '../../lib/fetcher';

// Tính toán thời gian tương đối động từ timestamp
export function formatRelativeTime(timestamp?: number): string {
  if (!timestamp) return 'Never';
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 60) {
    return `${diffSec}s ago`;
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHours = Math.floor(diffMin / 60);
  return `${diffHours}h ago`;
}

export default function NodesPage() {
  const [records, setRecords] = useState<NodeItem[]>([]);
  const [selectedID, setSelectedID] = useState<string | null>(null);
  const [displayNode, setDisplayNode] = useState<NodeItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streamState, setStreamState] = useState('Connecting');
  const [heartbeats, setHeartbeats] = useState<Record<string, NodeHeartbeat>>({});
  const [latestSyncEvent, setLatestSyncEvent] = useState<NodeSyncLog | null>(null);
  const [now, setNow] = useState(Date.now());
  const requestID = useRef(0);
  const nodes: NodeItem[] = records.map(n => {
    const fresh = !!n.lastHeartbeatTimestamp && now - n.lastHeartbeatTimestamp <= 45000;
    return {
      ...n, status: fresh ? n.status : 'Not Ready',
      metricsAvailable: fresh && n.metricsAvailable,
      lastHeartbeat: formatRelativeTime(n.lastHeartbeatTimestamp),
      policySync: fresh ? n.policySync : 'Unknown (stale heartbeat)',
    };
  });
  const selectedNode = nodes.find(n => n.id === selectedID) || null;
  const latestHeartbeatEvent = selectedID ? heartbeats[selectedID] : undefined;

  useEffect(() => {
    if (selectedNode) setDisplayNode(selectedNode);
  }, [records, selectedID, now]);

  const fetchNodes = useCallback(async (initial = false) => {
    const request = ++requestID.current;
    if (initial) setIsLoading(true);
    try {
      const data = await nodesApi.list();
      if (request !== requestID.current) return;
      if (!Array.isArray(data)) throw new Error('Invalid nodes response');
      setRecords(prev => data.map(item => {
        const incoming = { ...item, lastHeartbeatTimestamp: (item.lastHeartbeatTimestamp || 0) * 1000 };
        const old = prev.find(n => n.id === item.id);
        return old && (old.lastHeartbeatTimestamp || 0) > incoming.lastHeartbeatTimestamp ? old : incoming;
      }));
      setError(null);
    } catch (err) {
      if (request === requestID.current) setError(err instanceof Error ? err.message : 'Unable to fetch nodes');
    } finally { if (request === requestID.current) setIsLoading(false); }
  }, []);

  useEffect(() => {
    void fetchNodes(true);
    const poll = setInterval(() => void fetchNodes(), 15000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { ++requestID.current; clearInterval(poll); clearInterval(clock); };
  }, [fetchNodes]);

  useEffect(() => {
    const token = getAuthToken();
    const es = new EventSource(`${API_BASE_URL}/api/v1/events/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`, { withCredentials: true });
    es.onopen = () => { setStreamState('Live'); void fetchNodes(); };
    es.onerror = () => setStreamState('Disconnected — retrying; refreshing every 15s');
    const message = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data);
        const updates: NodeHeartbeat[] = (Array.isArray(parsed) ? parsed : [parsed]).filter((u: NodeHeartbeat) =>
          typeof u.node_id === 'string' && Number.isFinite(u.timestamp) && u.timestamp > 0 && u.timestamp <= Date.now() / 1000 + 5 &&
          [u.rps, u.active_conns, u.cpu_usage, u.memory_usage].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0));
        setHeartbeats(prev => {
          const next = { ...prev };
          for (const u of updates) if (!next[u.node_id] || next[u.node_id].timestamp < u.timestamp) next[u.node_id] = u;
          return next;
        });
        setRecords(prev => prev.map(n => {
          const u = updates.filter(it => it.node_id === n.id).sort((a, b) => b.timestamp - a.timestamp)[0];
          if (!u || u.timestamp * 1000 <= (n.lastHeartbeatTimestamp || 0)) return n;
          return {
            ...n, ip: u.ip || n.ip, status: u.status, requestsPerSecond: u.rps.toFixed(1),
            activeConnections: String(u.active_conns), cpuUsage: u.cpu_usage, memoryUsage: u.memory_usage,
            sync: u.sync, policySync: u.sync, ruleset: u.ruleset, metricsScope: u.metrics_scope,
            metricsAvailable: u.metrics_available, runtimeStartedAt: u.runtime_started_at,
            lastHeartbeatTimestamp: u.timestamp * 1000
          };
        }));
      } catch { setStreamState('Invalid event — waiting for refresh'); }
    };
    es.addEventListener('nodes_heartbeat', message);
    es.addEventListener('node_heartbeat', message);
    es.addEventListener('node_sync', (event: MessageEvent) => {
      try { setLatestSyncEvent(JSON.parse(event.data)); } catch { /* REST history reconciles on refresh. */ }
    });
    return () => es.close();
  }, [fetchNodes]);

  const handleSelectNode = (node: NodeItem) => setSelectedID(id => id === node.id ? null : node.id);

  return (
    <div className="p-6 w-full space-y-6">
      {/* Top KPI Metrics & Cluster Status */}
      <NodesStats nodes={nodes} />
      {/* Grid: Nodes Table + Right Drawer / Detail */}
      <div className={`flex flex-col lg:flex-row items-start transition-all duration-300 ${selectedNode ? 'gap-5' : 'gap-0'}`}>
        {/* Table Area: Tự động kéo dãn toàn màn hình khi đóng panel chi tiết */}
        <div className="flex-1 min-w-0 w-full transition-all duration-300 ease-in-out">
          <NodesTable
            nodes={nodes}
            isLoading={isLoading}
            onRefresh={() => fetchNodes(false)}
            selectedNodeId={selectedNode?.id || ''}
            onSelectNode={handleSelectNode}
          />
        </div>

        {/* Selected Node Detail Panel: Co dãn và xuất hiện mượt mà */}
        <div
          className={`shrink-0 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden ${selectedNode
              ? 'w-full lg:w-[420px] opacity-100 translate-x-0 max-h-[3000px]'
              : 'w-0 lg:w-0 opacity-0 lg:translate-x-8 max-h-0 lg:max-h-none pointer-events-none'
            }`}
        >
          <div className="w-full lg:w-[420px]">
            {displayNode && (
              <NodeDetail
                key={displayNode.id}
                node={displayNode}
                latestHeartbeatEvent={latestHeartbeatEvent}
                latestSyncEvent={latestSyncEvent}
                onClose={() => setSelectedID(null)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

