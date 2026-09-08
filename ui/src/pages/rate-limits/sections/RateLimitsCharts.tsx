import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  BarChart3,
  Flame,
  Filter,
  Clock,
  AreaChart as AreaChartIcon,
  Layers,
  RefreshCw,
} from 'lucide-react';
import { rateLimitsApi } from '../../../lib/api/rate-limits';

interface MetricPoint {
  time: string;
  total: number;
  blocked: number;
  throttled: number;
}

interface EndpointMetric {
  path: string;
  method: 'POST' | 'GET' | 'PUT' | 'DELETE';
  ruleName: string;
  hits: number;
  blockedCount: number;
  throttledCount: number;
  pctOfTotal: number;
  action: 'BLOCK' | 'RATE LIMIT';
}

// Helper: build smooth cubic spline path for SVG
function buildSplinePath(
  points: { x: number; y: number }[],
  closeToY?: number
): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let d = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;

    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }

  if (closeToY !== undefined) {
    const last = points[points.length - 1];
    const first = points[0];
    d += ` L ${last.x.toFixed(1)},${closeToY} L ${first.x.toFixed(1)},${closeToY} Z`;
  }

  return d;
}

interface RateLimitsChartsProps {
  onSelectEndpoint?: (path: string) => void;
  selectedEndpoint?: string;
}

export function RateLimitsCharts({
  onSelectEndpoint,
  selectedEndpoint = '',
}: RateLimitsChartsProps) {
  const [timeRange, setTimeRange] = useState<'24h' | '12h' | '6h'>('24h');
  const [chartView, setChartView] = useState<'area' | 'bar'>('area');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<'hits' | 'blocked'>('hits');
  const [realSeries, setRealSeries] = useState<MetricPoint[]>([]);
  const [realEndpoints, setRealEndpoints] = useState<EndpointMetric[]>([]);
  const [loading, setLoading] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Fetch live metrics from control-plane API
  const fetchMetrics = React.useCallback(() => {
    setLoading(true);
    rateLimitsApi
      .getMetrics({
        range: timeRange,
        sort: sortBy === 'blocked' ? 'blocked' : 'requests',
      })
      .then((res) => {
        if (!res) return;
        if (res.velocity_series && res.velocity_series.length > 0) {
          const mapped: MetricPoint[] = res.velocity_series.map((item) => {
            const timeParts = item.timestamp.split(' ');
            const timeStr = timeParts.length > 1 ? timeParts[1].substring(0, 5) : item.timestamp;
            return {
              time: timeStr,
              total: item.total_hits,
              blocked: item.blocked_count,
              throttled: item.throttled_count,
            };
          });
          setRealSeries(mapped);
        } else {
          setRealSeries([]);
        }

        if (res.top_endpoints && res.top_endpoints.length > 0) {
          const totalReqs = res.top_endpoints.reduce((acc, ep) => acc + ep.requests, 0);
          const mappedEps: EndpointMetric[] = res.top_endpoints.map((ep) => ({
            path: ep.endpoint,
            method: (ep.method as any) || 'GET',
            ruleName: ep.rule_name || 'Rate Limit',
            hits: ep.requests,
            blockedCount: ep.blocked,
            throttledCount: Math.max(0, ep.requests - ep.blocked),
            pctOfTotal: totalReqs > 0 ? Number(((ep.requests / totalReqs) * 100).toFixed(1)) : 0,
            action: ep.blocked > 0 ? 'BLOCK' : 'RATE LIMIT',
          }));
          setRealEndpoints(mappedEps);
        } else {
          setRealEndpoints([]);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch rate limit metrics:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [timeRange, sortBy]);

  React.useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 10000); // 10s auto-refresh
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  // Active data slice (nếu DB chưa có dữ liệu, tạo baseline points theo giờ)
  const data: MetricPoint[] = useMemo(() => {
    if (realSeries.length > 0) {
      return realSeries;
    }
    // Baseline zero-points khi chưa có traffic
    const hoursCount = timeRange === '6h' ? 6 : timeRange === '12h' ? 12 : 24;
    const now = new Date();
    const baseline: MetricPoint[] = [];
    for (let i = hoursCount - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 3600 * 1000);
      const hourStr = `${String(d.getHours()).padStart(2, '0')}:00`;
      baseline.push({ time: hourStr, total: 0, blocked: 0, throttled: 0 });
    }
    return baseline;
  }, [realSeries, timeRange]);

  // True peak in current range
  const peakItem: MetricPoint = useMemo(() => {
    return data.reduce((prev: MetricPoint, curr: MetricPoint) => (curr.total > prev.total ? curr : prev), data[0]);
  }, [data]);

  const maxVal = useMemo(() => {
    const highest = Math.max(...data.map((d: MetricPoint) => d.total));
    if (highest === 0) return 100;
    return Math.ceil((highest * 1.15) / 10) * 10;
  }, [data]);

  // Endpoints list
  const sortedEndpoints: EndpointMetric[] = useMemo(() => {
    return realEndpoints;
  }, [realEndpoints]);

  // Coordinate calculations for SVG (viewBox: 0 0 600 160)
  const SVG_WIDTH = 600;
  const SVG_HEIGHT = 160;
  const PADDING_TOP = 10;
  const PADDING_BOTTOM = 20;
  const PLOT_HEIGHT = SVG_HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  const pointsTotal = useMemo(() => {
    return data.map((d, i) => {
      const x = (i / (data.length - 1)) * SVG_WIDTH;
      const y = PADDING_TOP + PLOT_HEIGHT * (1 - d.total / maxVal);
      return { x, y };
    });
  }, [data, maxVal]);

  const pointsBlocked = useMemo(() => {
    return data.map((d, i) => {
      const x = (i / (data.length - 1)) * SVG_WIDTH;
      const y = PADDING_TOP + PLOT_HEIGHT * (1 - d.blocked / maxVal);
      return { x, y };
    });
  }, [data, maxVal]);

  const pathAreaTotal = useMemo(
    () => buildSplinePath(pointsTotal, SVG_HEIGHT - PADDING_BOTTOM),
    [pointsTotal]
  );
  const pathLineTotal = useMemo(() => buildSplinePath(pointsTotal), [pointsTotal]);

  const pathAreaBlocked = useMemo(
    () => buildSplinePath(pointsBlocked, SVG_HEIGHT - PADDING_BOTTOM),
    [pointsBlocked]
  );
  const pathLineBlocked = useMemo(() => buildSplinePath(pointsBlocked), [pointsBlocked]);

  // Mouse hover tracking
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const ratio = mouseX / rect.width;
    const idx = Math.round(ratio * (data.length - 1));
    setHoverIndex(Math.max(0, Math.min(idx, data.length - 1)));
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
  };

  const currentHoverItem = hoverIndex !== null ? data[hoverIndex] : null;

  // Ticks for Y-Axis
  const yTicks = [maxVal, Math.round(maxVal * 0.75), Math.round(maxVal * 0.5), Math.round(maxVal * 0.25), 0];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 font-sans">
      {/* 1. Left Chart: Rate Limit Hits Velocity Timeline (7 Cols) */}
      <div className="lg:col-span-7 bg-card border border-border p-4 flex flex-col justify-between shadow-xs rounded-sm transition-all hover:border-border/80">
        <div>
          {/* Header & Controls */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-border">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-primary/10 text-primary rounded-xs">
                {chartView === 'area' ? (
                  <AreaChartIcon className="w-4 h-4" />
                ) : (
                  <BarChart3 className="w-4 h-4" />
                )}
              </div>
              <div>
                <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  Rate Limit Hits Velocity
                </h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Throttled requests vs Hard 429 Rejections over time
                </p>
              </div>
            </div>

            {/* View toggles & Time range buttons */}
            <div className="flex items-center gap-2">
              {/* Area vs Bar Toggle */}
              <div className="flex items-center bg-muted p-0.5 rounded text-[11px] border border-border">
                <button
                  type="button"
                  onClick={() => setChartView('area')}
                  title="Smooth Area Curve"
                  className={`p-1 rounded transition-colors cursor-pointer ${
                    chartView === 'area'
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <AreaChartIcon className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setChartView('bar')}
                  title="Stacked Slender Bars"
                  className={`p-1 rounded transition-colors cursor-pointer ${
                    chartView === 'bar'
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Time range buttons */}
              <div className="flex items-center gap-1 bg-muted p-0.5 rounded text-[11px] border border-border">
                {(['24h', '12h', '6h'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => {
                      setTimeRange(r);
                      setHoverIndex(null);
                    }}
                    className={`px-2 py-0.5 rounded font-mono text-[10px] transition-colors cursor-pointer ${
                      timeRange === r
                        ? 'bg-card text-foreground font-semibold shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Legends & Current Hover Detail Banner */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 pb-1 text-[11px]">
            <div className="flex items-center gap-3.5">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-destructive rounded-xs inline-block" />
                <span className="text-muted-foreground">Blocked (429)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-emerald-500 rounded-xs inline-block" />
                <span className="text-muted-foreground">Throttled (Delayed)</span>
              </div>
            </div>

            {/* Dynamic Status / Hover Preview */}
            {currentHoverItem ? (
              <div className="flex items-center gap-2 font-mono text-[10px] bg-muted/90 px-2 py-0.5 rounded border border-border">
                <Clock className="w-3 h-3 text-primary" />
                <span className="font-semibold text-foreground">{currentHoverItem.time}</span>
                <span className="text-muted-foreground">Total:</span>
                <span className="font-bold text-foreground">{currentHoverItem.total.toLocaleString()}</span>
                <span className="text-destructive font-medium">({currentHoverItem.blocked} blk)</span>
                <span className="text-emerald-500 font-medium">({currentHoverItem.throttled} thr)</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
                <Flame className="w-3 h-3 text-amber-500" />
                <span>
                  Peak: <strong className="text-foreground">{peakItem.time}</strong> ({peakItem.total.toLocaleString()} hits)
                </span>
              </div>
            )}
          </div>

          {/* Chart Canvas Area */}
          <div className="relative pt-4 pb-1">
            <div className="flex gap-2.5 h-48">
              {/* Y Axis Grid Labels */}
              <div className="flex flex-col justify-between text-[10px] font-mono text-muted-foreground text-right w-10 select-none pb-5">
                {yTicks.map((val, idx) => (
                  <span key={idx}>{val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val}</span>
                ))}
              </div>

              {/* Chart Body */}
              <div className="flex-1 flex flex-col justify-end">
                <div className="h-full flex items-end justify-between border-b border-l border-border px-1 pb-0.5 relative overflow-hidden">
                  {/* Horizontal Grid lines */}
                  <div className="absolute inset-0 pointer-events-none flex flex-col justify-between">
                    <div className="w-full border-b border-dashed border-border/50" />
                    <div className="w-full border-b border-dashed border-border/50" />
                    <div className="w-full border-b border-dashed border-border/50" />
                    <div className="w-full border-b border-dashed border-border/50" />
                    <div className="w-full" />
                  </div>

                  {/* Mode 1: Smooth Area Spline View */}
                  {chartView === 'area' ? (
                    <div className="w-full h-full relative">
                      <svg
                        ref={svgRef}
                        className="w-full h-full cursor-crosshair overflow-visible"
                        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
                        preserveAspectRatio="none"
                        onMouseMove={handleMouseMove}
                        onMouseLeave={handleMouseLeave}
                      >
                        <defs>
                          {/* Gradient for Total / Throttled */}
                          <linearGradient id="velocityThrottledGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
                            <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                          </linearGradient>
                          {/* Gradient for Blocked */}
                          <linearGradient id="velocityBlockedGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#ef4444" stopOpacity="0.45" />
                            <stop offset="100%" stopColor="#ef4444" stopOpacity="0.0" />
                          </linearGradient>
                        </defs>

                        {/* Throttled Area & Line */}
                        <path d={pathAreaTotal} fill="url(#velocityThrottledGrad)" />
                        <path
                          d={pathLineTotal}
                          fill="none"
                          stroke="#10b981"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />

                        {/* Blocked Area & Line */}
                        <path d={pathAreaBlocked} fill="url(#velocityBlockedGrad)" />
                        <path
                          d={pathLineBlocked}
                          fill="none"
                          stroke="#ef4444"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />

                        {/* Peak Marker */}
                        {pointsTotal.length > 0 && (() => {
                          const peakIdx = data.findIndex((d) => d.time === peakItem.time);
                          if (peakIdx >= 0 && pointsTotal[peakIdx]) {
                            const p = pointsTotal[peakIdx];
                            return (
                              <g key="peak-indicator">
                                <circle
                                  cx={p.x}
                                  cy={p.y}
                                  r="4"
                                  fill="#f59e0b"
                                  stroke="var(--card)"
                                  strokeWidth="2"
                                />
                                <text
                                  x={p.x}
                                  y={p.y - 8}
                                  textAnchor="middle"
                                  fill="#f59e0b"
                                  fontSize="9"
                                  fontWeight="bold"
                                  className="font-mono"
                                >
                                  Peak
                                </text>
                              </g>
                            );
                          }
                          return null;
                        })()}

                        {/* Hover Crosshair & Indicator Dots */}
                        {hoverIndex !== null && pointsTotal[hoverIndex] && (
                          <g key="hover-guide">
                            <line
                              x1={pointsTotal[hoverIndex].x}
                              y1={PADDING_TOP}
                              x2={pointsTotal[hoverIndex].x}
                              y2={SVG_HEIGHT - PADDING_BOTTOM}
                              stroke="var(--foreground)"
                              strokeOpacity="0.4"
                              strokeWidth="1"
                              strokeDasharray="2 2"
                            />
                            {/* Total dot */}
                            <circle
                              cx={pointsTotal[hoverIndex].x}
                              cy={pointsTotal[hoverIndex].y}
                              r="4.5"
                              fill="#10b981"
                              stroke="var(--card)"
                              strokeWidth="2"
                            />
                            {/* Blocked dot */}
                            <circle
                              cx={pointsBlocked[hoverIndex].x}
                              cy={pointsBlocked[hoverIndex].y}
                              r="4.5"
                              fill="#ef4444"
                              stroke="var(--card)"
                              strokeWidth="2"
                            />
                          </g>
                        )}
                      </svg>
                    </div>
                  ) : (
                    /* Mode 2: Slender Stacked Bar Chart with safe widths */
                    <div className="w-full h-full flex items-end justify-between px-2 gap-1 relative">
                      {data.map((item, idx) => {
                        const totalPct = Math.min(100, Math.round((item.total / maxVal) * 100));
                        const blockedPct = item.total > 0 ? Math.round((item.blocked / item.total) * 100) : 0;
                        const throttledPct = 100 - blockedPct;
                        const isHovered = hoverIndex === idx;
                        const isPeak = item.time === peakItem.time;

                        return (
                          <div
                            key={item.time}
                            onMouseEnter={() => setHoverIndex(idx)}
                            onMouseLeave={() => setHoverIndex(null)}
                            className="flex-1 h-full flex flex-col justify-end items-center relative cursor-pointer"
                          >
                            {/* Peak Tag */}
                            {isPeak && (
                              <div className="absolute -top-5 text-[8px] font-mono font-bold bg-amber-500 text-amber-950 px-1 rounded-xs pointer-events-none whitespace-nowrap shadow-xs">
                                Peak
                              </div>
                            )}

                            {/* Slender bar with max-w to prevent chunky blocks */}
                            <div
                              className={`w-full max-w-4 sm:max-w-5 flex flex-col rounded-t-xs overflow-hidden transition-all duration-150 ${
                                isHovered
                                  ? 'ring-2 ring-primary ring-offset-1 scale-y-105 origin-bottom opacity-100'
                                  : 'hover:opacity-95 opacity-85'
                              }`}
                              style={{ height: `${totalPct}%` }}
                            >
                              <div
                                className="w-full bg-destructive transition-all"
                                style={{ height: `${blockedPct}%` }}
                                title={`${item.time} - Blocked: ${item.blocked}`}
                              />
                              <div
                                className="w-full bg-emerald-500/80 transition-all"
                                style={{ height: `${throttledPct}%` }}
                                title={`${item.time} - Throttled: ${item.throttled}`}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* X Axis Time Labels */}
                <div className="flex justify-between text-[10px] font-mono text-muted-foreground pt-1.5 px-1 select-none">
                  <span>{data[0]?.time}</span>
                  <span>{data[Math.floor(data.length * 0.25)]?.time}</span>
                  <span>{data[Math.floor(data.length * 0.5)]?.time}</span>
                  <span>{data[Math.floor(data.length * 0.75)]?.time}</span>
                  <span>{data[data.length - 1]?.time}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Insight */}
        <div className="pt-2 border-t border-border/70 flex items-center justify-between text-[11px] text-muted-foreground mt-2">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>NGINX Token Bucket: Rate enforcement steady at <strong>0% drop rate</strong></span>
          </div>
          <span className="font-mono text-[10px]">
            {chartView === 'area' ? 'Spline interpolation' : 'Slender bars'} · {timeRange} window
          </span>
        </div>
      </div>

      {/* 2. Right Chart: Top Endpoints by Rate Limit Hits (5 Cols) */}
      <div className="lg:col-span-5 bg-card border border-border p-4 flex flex-col justify-between shadow-xs rounded-sm transition-all hover:border-border/80">
        <div>
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <div>
              <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                Top Targeted Endpoints
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Endpoints with highest throttling & rejection counts
              </p>
            </div>

            {/* Sort toggles */}
            <div className="flex items-center gap-1 bg-muted p-0.5 rounded text-[11px] border border-border">
              <button
                type="button"
                onClick={() => setSortBy('hits')}
                className={`px-2 py-0.5 rounded font-mono text-[10px] transition-colors cursor-pointer ${
                  sortBy === 'hits'
                    ? 'bg-card text-foreground font-semibold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Hits
              </button>
              <button
                type="button"
                onClick={() => setSortBy('blocked')}
                className={`px-2 py-0.5 rounded font-mono text-[10px] transition-colors cursor-pointer ${
                  sortBy === 'blocked'
                    ? 'bg-card text-foreground font-semibold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Blocked
              </button>
            </div>
          </div>

          {/* Endpoints List */}
          <div className="space-y-3 pt-3">
            {sortedEndpoints.length === 0 ? (
              <div className="py-8 px-4 text-center border border-dashed border-border/80 rounded-sm bg-muted/10">
                <p className="text-xs font-semibold text-muted-foreground">
                  Chưa có endpoint nào chạm ngưỡng Rate Limit
                </p>
                <p className="text-[11px] text-muted-foreground/80 mt-1">
                  Hệ thống telemetry thu thập off-main-path qua UDP Syslog (port 5140).
                </p>
              </div>
            ) : (
              sortedEndpoints.map((ep) => {
                const isSelected = selectedEndpoint === ep.path;
                const blockedPct = ep.hits > 0 ? Math.round((ep.blockedCount / ep.hits) * 100) : 0;
                const throttledPct = 100 - blockedPct;

                return (
                  <div
                    key={ep.path}
                    onClick={() => onSelectEndpoint && onSelectEndpoint(isSelected ? '' : ep.path)}
                    className={`p-2 rounded-sm border transition-all cursor-pointer group ${
                      isSelected
                        ? 'bg-primary/5 border-primary/40 shadow-xs'
                        : 'bg-background/50 border-border/70 hover:border-primary/30 hover:bg-muted/40'
                    }`}
                    title="Click to filter rate limit rules table for this endpoint"
                  >
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={`text-[9px] font-mono px-1 py-0.2 rounded font-bold ${
                            ep.method === 'POST'
                              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                              : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                          }`}
                        >
                          {ep.method}
                        </span>
                        <span className="font-mono text-[11px] font-semibold text-foreground truncate">
                          {ep.path}
                        </span>
                        <span className="text-[10px] text-muted-foreground truncate hidden sm:inline">
                          ({ep.ruleName})
                        </span>
                      </div>

                      <div className="flex items-center gap-2 font-mono text-right shrink-0">
                        <span className="text-xs font-bold text-foreground">
                          {ep.hits.toLocaleString()}
                        </span>
                        <span className="text-[10px] text-muted-foreground w-9">
                          {ep.pctOfTotal}%
                        </span>
                      </div>
                    </div>

                    {/* Stacked Progress Bar (Blocked vs Throttled) */}
                    <div className="w-full bg-muted h-2 rounded-full overflow-hidden flex">
                      <div
                        className="bg-destructive h-full transition-all duration-300"
                        style={{ width: `${blockedPct}%` }}
                        title={`Blocked: ${ep.blockedCount.toLocaleString()} (${blockedPct}%)`}
                      />
                      <div
                        className="bg-emerald-500/80 h-full transition-all duration-300"
                        style={{ width: `${throttledPct}%` }}
                        title={`Throttled: ${ep.throttledCount.toLocaleString()} (${throttledPct}%)`}
                      />
                    </div>

                    {/* Micro sub-metrics */}
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1 font-mono">
                      <span>
                        <span className="text-destructive font-medium">{ep.blockedCount} blk</span>
                        {' / '}
                        <span className="text-emerald-500 font-medium">{ep.throttledCount} thr</span>
                      </span>
                      <span className="text-muted-foreground group-hover:text-primary transition-colors flex items-center gap-0.5">
                        {isSelected ? 'Active Filter' : 'Filter table'}
                        <Filter className="w-2.5 h-2.5 ml-0.5" />
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="pt-2 border-t border-border/70 flex items-center justify-between text-[11px] text-muted-foreground mt-3">
          <span>
            {sortedEndpoints.length > 0
              ? `Top ${sortedEndpoints.length} endpoints đang bị giới hạn`
              : 'Trạng thái: 0 endpoint bị nghẽn'}
          </span>
          {selectedEndpoint && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelectEndpoint && onSelectEndpoint('');
              }}
              className="text-[10px] text-primary hover:underline font-medium cursor-pointer"
            >
              Clear Filter ({selectedEndpoint})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default RateLimitsCharts;
