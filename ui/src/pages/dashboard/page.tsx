import React, { useState } from 'react';
import { DashboardHeader } from './sections/DashboardHeader';
import { DashboardMetrics } from './sections/DashboardMetrics';
import { DashboardTrafficChart } from './sections/DashboardTrafficChart';
import { DashboardAttackTypes } from './sections/DashboardAttackTypes';
import { DashboardTopBlockedIps } from './sections/DashboardTopBlockedIps';
import { DashboardNodesSummary } from './sections/DashboardNodesSummary';
import { DashboardClusterHealth } from './sections/DashboardClusterHealth';
import { DashboardRecentEvents } from './sections/DashboardRecentEvents';
import { DashboardStatusBanner } from './sections/DashboardStatusBanner';

export default function DashboardPage() {
  const [timeRange, setTimeRange] = useState('24h');

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <DashboardHeader
        timeRange={timeRange}
        onTimeRangeChange={(range) => setTimeRange(range)}
      />

      {/* Top 6 KPI Metric Cards */}
      <DashboardMetrics />

      {/* Middle Row: Request Traffic (2 cols on lg) + Top Attack Types (1 col on lg) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <DashboardTrafficChart />
        </div>
        <div className="lg:col-span-1">
          <DashboardAttackTypes />
        </div>
      </div>

      {/* Top Source IPs Blocked */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-3">
          <DashboardTopBlockedIps />
        </div>
      </div>

      {/* Bottom Row: NGINX Nodes + Cluster Health + Recent Security Events */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <DashboardNodesSummary />
        <DashboardClusterHealth />
        <DashboardRecentEvents />
      </div>

      {/* Status Operational Footer Banner */}
      <DashboardStatusBanner />
    </div>
  );
}
