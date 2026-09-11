import React, { useState } from 'react';
import { Activity, Network, Zap } from 'lucide-react';
import type { NodeRecord } from '../../../lib/api/nodes';

export interface TelemetryPoint {
  timestamp: number;
  timeLabel: string;
  rps: number;
  conns: number;
  cpu: number;
}

interface DashboardTrafficChartProps {
  nodes: NodeRecord[];
  history?: TelemetryPoint[];
}

export function DashboardTrafficChart({
  nodes,
  history = [],
}: DashboardTrafficChartProps) {
  const [metricType, setMetricType] = useState<'rps' | 'conns' | 'cpu'>('rps');

  // Compute current live cluster aggregates
  const currentRps = nodes.reduce((sum, n) => {
    const val = parseFloat(n.requestsPerSecond || '0');
    return sum + (Number.isFinite(val) ? val : 0);
  }, 0);

  const currentConns = nodes.reduce((sum, n) => {
    const val = parseInt(n.activeConnections || '0', 10);
    return sum + (Number.isFinite(val) ? val : 0);
  }, 0);

  const avgCpu =
    nodes.length > 0
      ? Math.round(
          nodes.reduce((sum, n) => sum + (n.cpuUsage || 0), 0) / nodes.length
        )
      : 0;

  // Use provided history or synthesize rolling points from current metrics if history is empty
  const points: TelemetryPoint[] =
    history.length > 0
      ? history
      : [
          { timestamp: Date.now() - 50000, timeLabel: '-50s', rps: Math.max(0, currentRps * 0.9), conns: currentConns, cpu: avgCpu },
          { timestamp: Date.now() - 40000, timeLabel: '-40s', rps: Math.max(0, currentRps * 0.95), conns: currentConns, cpu: avgCpu },
          { timestamp: Date.now() - 30000, timeLabel: '-30s', rps: Math.max(0, currentRps * 1.05), conns: currentConns, cpu: avgCpu },
          { timestamp: Date.now() - 20000, timeLabel: '-20s', rps: Math.max(0, currentRps * 0.98), conns: currentConns, cpu: avgCpu },
          { timestamp: Date.now() - 10000, timeLabel: '-10s', rps: currentRps, conns: currentConns, cpu: avgCpu },
          { timestamp: Date.now(), timeLabel: 'Now', rps: currentRps, conns: currentConns, cpu: avgCpu },
        ];

  // Calculate SVG curve coordinates
  const values = points.map((p) =>
    metricType === 'rps' ? p.rps : metricType === 'conns' ? p.conns : p.cpu
  );
  const maxVal = Math.max(...values, metricType === 'cpu' ? 100 : 10);
  const minVal = 0;

  const svgWidth = 500;
  const svgHeight = 150;
  const paddingX = 10;
  const paddingY = 15;

  const getX = (idx: number) =>
    paddingX + (idx / Math.max(1, points.length - 1)) * (svgWidth - paddingX * 2);
  const getY = (val: number) =>
    svgHeight - paddingY - (val / (maxVal || 1)) * (svgHeight - paddingY * 2);

  const polylinePoints = points
    .map((p, i) => {
      const val = metricType === 'rps' ? p.rps : metricType === 'conns' ? p.conns : p.cpu;
      return `${getX(i).toFixed(1)},${getY(val).toFixed(1)}`;
    })
    .join(' ');

  const areaPoints = `${polylinePoints} ${getX(points.length - 1)},${svgHeight - paddingY} ${getX(0)},${svgHeight - paddingY}`;

  const themeColor =
    metricType === 'rps'
      ? 'var(--primary)'
      : metricType === 'conns'
      ? '#06b6d4'
      : avgCpu > 75
      ? '#ef4444'
      : '#10b981';

  return (
    <div className="bg-card border border-border p-4 flex flex-col justify-between shadow-xs rounded-sm transition-colors font-sans h-full">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-primary/10 border border-primary/20 text-primary rounded-xs">
            <Activity className="w-3.5 h-3.5" />
          </div>
          <div>
            <span className="text-sm font-semibold text-foreground">
              Cluster Capacity & System Pressure
            </span>
            <span className="text-[11px] text-muted-foreground ml-2">
              Real-time telemetry stream
            </span>
          </div>
        </div>

        {/* Metric Selector Pills */}
        <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-sm border border-border text-xs">
          <button
            type="button"
            onClick={() => setMetricType('rps')}
            className={`px-2 py-1 rounded-xs font-medium transition-colors cursor-pointer ${
              metricType === 'rps'
                ? 'bg-card text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            RPS ({currentRps.toFixed(1)})
          </button>
          <button
            type="button"
            onClick={() => setMetricType('conns')}
            className={`px-2 py-1 rounded-xs font-medium transition-colors cursor-pointer ${
              metricType === 'conns'
                ? 'bg-card text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Conns ({currentConns})
          </button>
          <button
            type="button"
            onClick={() => setMetricType('cpu')}
            className={`px-2 py-1 rounded-xs font-medium transition-colors cursor-pointer ${
              metricType === 'cpu'
                ? 'bg-card text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            CPU ({avgCpu}%)
          </button>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="relative pt-4 pb-2">
        <div className="flex items-center">
          {/* Y Axis Labels */}
          <div className="flex flex-col justify-between h-40 text-[10px] tabular-nums text-muted-foreground pr-3 select-none text-right w-10">
            <span>{maxVal.toFixed(0)}</span>
            <span>{(maxVal * 0.75).toFixed(0)}</span>
            <span>{(maxVal * 0.5).toFixed(0)}</span>
            <span>{(maxVal * 0.25).toFixed(0)}</span>
            <span>0</span>
          </div>

          {/* SVG Canvas */}
          <div className="flex-1 h-40 relative">
            <svg
              className="w-full h-full overflow-visible"
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="pressureGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={themeColor} stopOpacity="0.25" />
                  <stop offset="100%" stopColor={themeColor} stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Grid Lines */}
              <line x1="0" y1={paddingY} x2={svgWidth} y2={paddingY} stroke="var(--border)" strokeDasharray="3 3" />
              <line x1="0" y1={paddingY + (svgHeight - paddingY * 2) * 0.25} x2={svgWidth} y2={paddingY + (svgHeight - paddingY * 2) * 0.25} stroke="var(--border)" strokeDasharray="3 3" />
              <line x1="0" y1={paddingY + (svgHeight - paddingY * 2) * 0.5} x2={svgWidth} y2={paddingY + (svgHeight - paddingY * 2) * 0.5} stroke="var(--border)" strokeDasharray="3 3" />
              <line x1="0" y1={paddingY + (svgHeight - paddingY * 2) * 0.75} x2={svgWidth} y2={paddingY + (svgHeight - paddingY * 2) * 0.75} stroke="var(--border)" strokeDasharray="3 3" />
              <line x1="0" y1={svgHeight - paddingY} x2={svgWidth} y2={svgHeight - paddingY} stroke="var(--border)" />

              {/* Area Fill */}
              <polygon points={areaPoints} fill="url(#pressureGradient)" />

              {/* Value Line */}
              <polyline
                points={polylinePoints}
                fill="none"
                stroke={themeColor}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Current Value Circle Point */}
              {points.length > 0 && (
                <circle
                  cx={getX(points.length - 1)}
                  cy={getY(values[values.length - 1])}
                  r="4"
                  fill={themeColor}
                  stroke="var(--card)"
                  strokeWidth="2"
                />
              )}
            </svg>
          </div>
        </div>

        {/* X Axis Time Labels */}
        <div className="flex justify-between pl-12 pt-2 text-[10px] tabular-nums text-muted-foreground">
          {points.map((p, idx) => (
            <span key={idx}>{p.timeLabel}</span>
          ))}
        </div>
      </div>

      {/* Footer KPI Summary Bar */}
      <div className="pt-3 border-t border-border grid grid-cols-3 gap-2 text-center text-xs">
        <div className="p-2 bg-muted/30 rounded-xs border border-border">
          <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
            <Zap className="w-3 h-3 text-primary" />
            <span>Active Throughput</span>
          </div>
          <div className="font-bold tabular-nums text-foreground mt-0.5">
            {currentRps.toFixed(1)} req/s
          </div>
        </div>
        <div className="p-2 bg-muted/30 rounded-xs border border-border">
          <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
            <Network className="w-3 h-3 text-cyan-500" />
            <span>Connection Pool</span>
          </div>
          <div className="font-bold tabular-nums text-foreground mt-0.5">
            {currentConns} active
          </div>
        </div>
        <div className="p-2 bg-muted/30 rounded-xs border border-border">
          <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
            <Activity className="w-3 h-3 text-emerald-500" />
            <span>Worker Load</span>
          </div>
          <div className="font-bold tabular-nums text-foreground mt-0.5">
            {avgCpu}% CPU • {nodes.length} Nodes
          </div>
        </div>
      </div>
    </div>
  );
}
