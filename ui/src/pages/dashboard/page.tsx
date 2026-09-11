import React, { useEffect, useState, useCallback, useRef } from 'react';
import { DashboardHeader } from './sections/DashboardHeader';
import { DashboardMetrics } from './sections/DashboardMetrics';
import { DashboardSpecSyncPanel } from './sections/DashboardSpecSyncPanel';
import { DashboardNodesSummary } from './sections/DashboardNodesSummary';
import { DashboardClusterHealth } from './sections/DashboardClusterHealth';
import { DashboardStatusBanner } from './sections/DashboardStatusBanner';

import { nodesApi, type NodeRecord, type NodeHeartbeat } from '../../lib/api/nodes';
import { systemApi, type SystemInfo } from '../../lib/api/system';
import { specApi, type ClusterSpecInfo } from '../../lib/api/spec';
import { API_BASE_URL, getAuthToken } from '../../lib/fetcher';

export default function DashboardPage() {
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [clusterSpec, setClusterSpec] = useState<ClusterSpecInfo | null>(null);
  const [streamState, setStreamState] = useState<'Live' | 'Polling' | 'Disconnected'>('Polling');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const requestID = useRef(0);

  // Fetch baseline fleet snapshot
  const loadData = useCallback(async (showSpin = false) => {
    if (showSpin) setIsRefreshing(true);
    const reqId = ++requestID.current;

    try {
      const [nodesData, infoData, specData] = await Promise.all([
        nodesApi.list().catch(() => [] as NodeRecord[]),
        systemApi.getInfo().catch(() => null),
        specApi.getClusterSpec().catch(() => null),
      ]);

      if (reqId === requestID.current) {
        setNodes(nodesData);
        setSystemInfo(infoData);
        setClusterSpec(specData);
      }
    } finally {
      if (showSpin && reqId === requestID.current) {
        setIsRefreshing(false);
      }
    }
  }, []);

  // Periodic polling fallback (every 15 seconds)
  useEffect(() => {
    void loadData(false);
    const interval = setInterval(() => {
      void loadData(false);
    }, 15000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Real-time SSE Stream
  useEffect(() => {
    const token = getAuthToken();
    const es = new EventSource(
      `${API_BASE_URL}/api/v1/events/stream${
        token ? `?token=${encodeURIComponent(token)}` : ''
      }`,
      { withCredentials: true }
    );

    es.onopen = () => {
      setStreamState('Live');
    };

    es.onerror = () => {
      setStreamState('Polling');
    };

    const handleHeartbeat = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data);
        const updates: NodeHeartbeat[] = (
          Array.isArray(parsed) ? parsed : [parsed]
        ).filter(
          (u: NodeHeartbeat) =>
            typeof u.node_id === 'string' &&
            Number.isFinite(u.timestamp) &&
            u.timestamp > 0
        );

        if (updates.length > 0) {
          setNodes((prevNodes) =>
            prevNodes.map((n) => {
              const u = updates.find((it) => it.node_id === n.id);
              if (!u) return n;
              return {
                ...n,
                ip: u.ip || n.ip,
                status: u.status,
                sync: u.sync || n.sync,
                ruleset: u.ruleset || n.ruleset,
                lastHeartbeatTimestamp: u.timestamp * 1000,
              };
            })
          );
        }
      } catch {
        // Fallback polling reconciles
      }
    };

    es.addEventListener('nodes_heartbeat', handleHeartbeat);
    es.addEventListener('node_heartbeat', handleHeartbeat);
    es.addEventListener('node_sync', () => {
      void loadData(false);
    });

    return () => {
      es.close();
    };
  }, [loadData]);

  return (
    <div className="p-6 w-full space-y-5">
      {/* 1. Header with Target Spec Release, SHA-256 Digest & Live Telemetry status */}
      <DashboardHeader
        clusterSpec={clusterSpec}
        streamState={streamState}
        onRefresh={() => void loadData(true)}
        isRefreshing={isRefreshing}
      />

      {/* 2. Top 4 Fleet & Spec KPI Cards */}
      <DashboardMetrics
        nodes={nodes}
        clusterSpec={clusterSpec}
        isLoading={isRefreshing}
      />

      {/* 3. Main Row: Fleet 3-Pillar Lifecycle Matrix (2 cols) + Declarative Spec Sync Panel (1 col) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <DashboardNodesSummary
            nodes={nodes}
            clusterSpec={clusterSpec}
            onRefresh={() => void loadData(true)}
          />
        </div>
        <div className="lg:col-span-1">
          <DashboardSpecSyncPanel
            nodes={nodes}
            clusterSpec={clusterSpec}
            onRefresh={() => void loadData(true)}
          />
        </div>
      </div>

      {/* 4. Bottom Row: Control Plane Runtime & Storage Persistence Health */}
      <div className="grid grid-cols-1 gap-5">
        <DashboardClusterHealth systemInfo={systemInfo} nodes={nodes} />
      </div>

      {/* 5. Operational Status Banner */}
      <DashboardStatusBanner />
    </div>
  );
}
