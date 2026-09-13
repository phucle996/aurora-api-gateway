import React, { useEffect, useState, useCallback, useRef } from 'react';
import { DashboardHeader } from './sections/DashboardHeader';
import { DashboardMetrics } from './sections/DashboardMetrics';
import { DashboardSpecSyncPanel } from './sections/DashboardSpecSyncPanel';
import { DashboardNodesSummary } from './sections/DashboardNodesSummary';
import { DashboardClusterHealth } from './sections/DashboardClusterHealth';
import { DashboardStatusBanner } from './sections/DashboardStatusBanner';

import { systemApi, type SystemInfo } from '../../lib/api/system';
import { specApi, type ClusterSpecInfo } from '../../lib/api/spec';
import { API_BASE_URL, getAuthToken } from '../../lib/fetcher';

export default function DashboardPage() {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [clusterSpec, setClusterSpec] = useState<ClusterSpecInfo | null>(null);
  const [streamState, setStreamState] = useState<'Live' | 'Polling' | 'Disconnected'>('Polling');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const requestID = useRef(0);

  // Fetch baseline system & cluster spec snapshot
  const loadData = useCallback(async (showSpin = false) => {
    if (showSpin) setIsRefreshing(true);
    const reqId = ++requestID.current;

    try {
      const [infoData, specData] = await Promise.all([
        systemApi.getInfo().catch(() => null),
        specApi.getClusterSpec().catch(() => null),
      ]);

      if (reqId === requestID.current) {
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

    es.addEventListener('spec_update', () => {
      void loadData(false);
    });
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
        systemInfo={systemInfo}
        clusterSpec={clusterSpec}
        isLoading={isRefreshing}
      />

      {/* 3. Main Row: Stateless Architecture Overview (2 cols) + Declarative Spec Sync Panel (1 col) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <DashboardNodesSummary
            systemInfo={systemInfo}
            clusterSpec={clusterSpec}
            onRefresh={() => void loadData(true)}
          />
        </div>
        <div className="lg:col-span-1">
          <DashboardSpecSyncPanel
            clusterSpec={clusterSpec}
            onRefresh={() => void loadData(true)}
          />
        </div>
      </div>

      {/* 4. Bottom Row: Control Plane Runtime & Storage Persistence Health */}
      <div className="grid grid-cols-1 gap-5">
        <DashboardClusterHealth systemInfo={systemInfo} />
      </div>

      {/* 5. Operational Status Banner */}
      <DashboardStatusBanner />
    </div>
  );
}
