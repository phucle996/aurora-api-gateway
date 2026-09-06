import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Server,
  AlertCircle,
  ArrowRight,
  Activity,
  Sliders,
  RefreshCw,
  Copy,
  Check,
  X,
  Cpu,
  HardDrive,
  Radio,
} from 'lucide-react';
import type { NodeItem } from './NodesTable';
import { nodesApi, type NodeSyncLog } from '../../../lib/api';
import type { NodeHeartbeat, NodeMetricPoint } from '../../../lib/api/nodes';

interface NodeDetailProps {
  node: NodeItem;
  latestHeartbeatEvent?: NodeHeartbeat;
  latestSyncEvent?: NodeSyncLog | null;
  onClose?: () => void;
}

function formatNodeUptime(startedAt?: number, status?: string, fallbackUptime?: string): string {
  if (status === 'Not Ready' || status === 'Offline') {
    return 'Offline';
  }
  if (!startedAt || startedAt <= 0) return 'Unknown';
  const createdMs = startedAt * 1000;
  const diffSec = Math.max(0, Math.floor((Date.now() - createdMs) / 1000));
  const days = Math.floor(diffSec / 86400);
  const hours = Math.floor((diffSec % 86400) / 3600);
  const minutes = Math.floor((diffSec % 3600) / 60);
  const seconds = diffSec % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function NodeDetail({
  node,
  latestHeartbeatEvent,
  latestSyncEvent,
  onClose,
}: NodeDetailProps) {
  const [activeTab, setActiveTab] = useState<'Overview' | 'Metrics' | 'Config' | 'Sync'>('Overview');
  const [metrics, setMetrics] = useState<NodeMetricPoint[]>([]);
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [syncLogs, setSyncLogs] = useState<NodeSyncLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const lastAckTime = node.lastHeartbeatTimestamp ? `${Math.max(0, Math.floor((now - node.lastHeartbeatTimestamp) / 1000))}s trước` : 'Chưa nhận';
  const uptimeDisplay = formatNodeUptime(node.runtimeStartedAt, node.status, node.uptime);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);

  useEffect(() => {
    const event = latestHeartbeatEvent;
    if (!event || event.node_id !== node.id || !event.metrics_available) return;
    const point: NodeMetricPoint = {
      timestamp: event.timestamp, timeLabel: new Date(event.timestamp * 1000).toLocaleTimeString(),
      rps: event.rps, activeConnections: event.active_conns, cpuUsage: event.cpu_usage,
      memoryUsage: event.memory_usage, metricsScope: event.metrics_scope
    };
    setMetrics(prev => [...prev.filter(p => p.timestamp !== point.timestamp && p.timestamp >= Date.now() / 1000 - 3600), point].sort((a, b) => a.timestamp - b.timestamp));
  }, [latestHeartbeatEvent, node.id]);

  useEffect(() => {
    if (activeTab !== 'Metrics') return;
    let cancelled = false;
    const fetchHistory = async () => {
      setIsLoadingMetrics(true);
      try {
        const data = await nodesApi.getMetrics(node.id);
        if (cancelled) return;
        setMetrics(prev => {
          const merged = new Map(data.map(p => [p.timestamp, p]));
          for (const p of prev) merged.set(p.timestamp, p);
          return [...merged.values()].filter(p => p.timestamp >= Date.now() / 1000 - 3600 && p.timestamp <= Date.now() / 1000).sort((a, b) => a.timestamp - b.timestamp);
        });
        setMetricsError(null);
      } catch (err) { if (!cancelled) setMetricsError(err instanceof Error ? err.message : 'Không tải được lịch sử metrics'); }
      finally { if (!cancelled) setIsLoadingMetrics(false); }
    };
    void fetchHistory();
    const timer = setInterval(fetchHistory, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [activeTab, node.id]);

  useEffect(() => {
    if (!latestSyncEvent || latestSyncEvent.node_id !== node.id) return;
    setSyncLogs(prev => [latestSyncEvent, ...prev.filter(p => p.id !== latestSyncEvent.id)].sort((a, b) => b.id - a.id).slice(0, 30));
  }, [latestSyncEvent, node.id]);

  useEffect(() => {
    if (activeTab !== 'Sync') return;
    let cancelled = false;
    setIsLoadingLogs(true);
    nodesApi.getSyncHistory(node.id).then(data => {
      if (!cancelled) { setSyncLogs(prev => [...new Map([...data, ...prev].map(p => [p.id, p])).values()].sort((a, b) => b.id - a.id).slice(0, 30)); setLogsError(null); }
    }).catch(err => { if (!cancelled) setLogsError(err.message); }).finally(() => { if (!cancelled) setIsLoadingLogs(false); });
    return () => { cancelled = true; };
  }, [activeTab, node.id]);

  const [nodeConfig, setNodeConfig] = useState<string | null>(null);
  const [configPath, setConfigPath] = useState('/etc/nginx/nginx.conf');
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [copiedConfig, setCopiedConfig] = useState(false);
  const configRequest = useRef(0);
  const fetchNodeConfig = useCallback(async () => {
    const request = ++configRequest.current;
    setIsLoadingConfig(true); setConfigError(null);
    try {
      const res = await nodesApi.getConfig(node.id);
      if (request !== configRequest.current) return;
      if (!res.config) throw new Error('Node trả về cấu hình rỗng');
      setNodeConfig(res.config); setConfigPath(res.path);
    } catch (err) { if (request === configRequest.current) setConfigError(err instanceof Error ? err.message : 'Không tải được cấu hình'); }
    finally { if (request === configRequest.current) setIsLoadingConfig(false); }
  }, [node.id]);
  useEffect(() => {
    if (activeTab === 'Config') void fetchNodeConfig();
    return () => { ++configRequest.current; };
  }, [activeTab, fetchNodeConfig]);
  const visibleMetrics = metrics.filter(p => p.timestamp >= now / 1000 - 3600 && p.metricsScope === node.metricsScope);
  const current = node.status === 'Ready' && node.metricsAvailable;

  const handleCopyConfig = async () => {
    if (!nodeConfig) return;
    try {
      await navigator.clipboard.writeText(nodeConfig);
      setCopiedConfig(true);
      setTimeout(() => setCopiedConfig(false), 2000);
    } catch (err) {
      console.error('Failed to copy config:', err);
    }
  };

  return (
    <div className="w-full lg:w-[420px] bg-card border border-border flex flex-col shrink-0">
      {/* Detail Header */}
      <div className="p-4 border-b border-border flex items-center justify-between font-sans">
        <div className="flex items-center gap-2.5">
          <Server className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
          <span className="text-sm font-sans font-bold text-slate-900 dark:text-white">
            {node.name}
          </span>
          {node.status === 'Ready' ? (
            <span className="inline-flex items-center px-2 py-0.5 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-500/50 text-emerald-700 dark:text-emerald-400 text-[10px] font-sans font-bold rounded-xs">
              Ready
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-500/50 text-rose-700 dark:text-rose-400 text-[10px] font-sans font-bold rounded-xs">
              Not Ready
            </span>
          )}
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="Đóng bảng chi tiết"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="relative flex border-b border-border bg-muted/40 text-xs font-sans select-none">
        {(['Overview', 'Metrics', 'Config', 'Sync'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-center transition-colors duration-200 cursor-pointer ${activeTab === tab
              ? 'text-primary font-semibold bg-card'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
          >
            {tab}
          </button>
        ))}

        {/* Animated Sliding Bottom Underline */}
        <div
          className="absolute bottom-0 h-[2px] w-1/4 bg-primary transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] pointer-events-none"
          style={{
            transform: `translateX(${activeTab === 'Overview'
              ? '0%'
              : activeTab === 'Metrics'
                ? '100%'
                : activeTab === 'Config'
                  ? '200%'
                  : '300%'
              })`,
          }}
        />
      </div>

      <style>{`
        @keyframes nodeDetailTabFade {
          from {
            opacity: 0;
            transform: translateY(3px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-tab-fade {
          animation: nodeDetailTabFade 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
      `}</style>

      {/* Tab Body */}
      <div key={activeTab} className="animate-tab-fade p-4 space-y-5 overflow-y-auto max-h-[calc(100vh-250px)]">
        {activeTab === 'Overview' && (
          <>
            {/* Meta Key-Value List */}
            <div className="space-y-2 text-xs font-mono">
              <div className="flex justify-between py-1 border-b border-border/60">
                <span className="text-slate-500 dark:text-slate-400">Name</span>
                <span className="text-slate-900 dark:text-slate-200 font-semibold">{node.name}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-border/60">
                <span className="text-slate-500 dark:text-slate-400">IP</span>
                <span className="text-slate-800 dark:text-slate-200">{node.ip}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-border/60">
                <span className="text-slate-500 dark:text-slate-400">Status</span>
                <span
                  className={
                    node.status === 'Ready'
                      ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                      : 'text-rose-600 dark:text-rose-400 font-semibold'
                  }
                >
                  {node.status}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-border/60">
                <span className="text-slate-500 dark:text-slate-400">Version</span>
                <span className="text-slate-800 dark:text-slate-200">{node.version || 'Unknown'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-border/60">
                <span className="text-slate-500 dark:text-slate-400">Ruleset Revision</span>
                <span className="text-primary font-semibold">{node.ruleset}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-border/60">
                <span className="text-slate-500 dark:text-slate-400">Uptime</span>
                <span className="text-slate-800 dark:text-slate-200 font-mono">{uptimeDisplay}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-border/60">
                <span className="text-slate-500 dark:text-slate-400">Last Heartbeat</span>
                <span className="text-slate-800 dark:text-slate-300">{node.lastHeartbeat}</span>
              </div>
            </div>

            {/* Realtime Connections & Traffic */}
            <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-xs">
              <div className="p-2.5 bg-muted/40 border border-border">
                <div className="text-[10px] text-slate-500">Active Connections</div>
                <div className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                  {current ? node.activeConnections : '—'}
                </div>
              </div>
              <div className="p-2.5 bg-muted/40 border border-border">
                <div className="text-[10px] text-slate-500">Requests per Second</div>
                <div className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                  {current ? node.requestsPerSecond : '—'}
                </div>
              </div>
            </div>

            {/* Policy Sync Banner */}
            <div className="p-3 bg-muted/40 border border-border flex items-center justify-between font-mono text-xs">
              <span className="text-slate-500 dark:text-slate-400">Policy Sync</span>
              <div className="text-right">
                <span
                  className={`inline-flex items-center px-2 py-0.5 border text-[10px] ${node.sync === 'Drift'
                    ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-500/40 text-amber-700 dark:text-amber-400'
                    : node.sync === 'Syncing'
                      ? 'bg-cyan-50 dark:bg-cyan-950/50 border-cyan-300 dark:border-cyan-500/40 text-cyan-700 dark:text-cyan-400'
                      : 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-400'
                    }`}
                >
                  {node.policySync}
                </span>
                <div className="text-[10px] text-slate-500 mt-1">
                  Last applied observation: {node.lastSyncTime || 'Unknown'}
                </div>
              </div>
            </div>

            {/* Recent Status Section */}
            <div className="p-3 bg-muted/40 border border-border space-y-2.5 font-mono text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800 dark:text-slate-200">Recent Status</span>
              </div>

              <div className="space-y-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                    <span className={`w-1.5 h-1.5 ${node.status === 'Ready' ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-rose-500 dark:bg-rose-400'}`} />
                    <span>{node.name} liveness</span>
                  </div>
                  <span className="text-slate-500 dark:text-slate-400">{node.status} ({node.lastHeartbeat})</span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                    <span className="w-1.5 h-1.5 bg-primary" />
                    <span>Active ruleset</span>
                  </div>
                  <span className="text-slate-500 dark:text-slate-400">{node.ruleset} ({node.sync})</span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                    <span className="w-1.5 h-1.5 bg-slate-400 dark:bg-slate-500" />
                    <span>Registration time</span>
                  </div>
                  <span className="text-slate-500">{node.runtimeStartedAt || 'Registered'}</span>
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === 'Metrics' && (
          <div className="space-y-4 font-mono text-xs">
            {isLoadingMetrics && metrics.length === 0 ? (
              <div className="p-8 bg-muted/40 border border-border flex items-center justify-center gap-2 text-slate-500 dark:text-slate-400">
                <RefreshCw className="w-4 h-4 animate-spin text-primary" />
                <span>Đang tải số liệu telemetry...</span>
              </div>
            ) : metricsError ? (
              <div className="p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-500/40 space-y-2 text-xs font-mono">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-bold">
                  <AlertCircle className="w-4 h-4" />
                  <span>Telemetry Không Khả Dụng (503)</span>
                </div>
                <p className="text-slate-700 dark:text-slate-300 text-[11px] leading-relaxed">
                  {metricsError}
                </p>
                <div className="pt-2">
                  <Link
                    to="/settings"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-card hover:bg-muted border border-border text-foreground text-[11px] font-mono transition-colors cursor-pointer"
                  >
                    <span>Cấu hình tại Cài đặt -&gt; Tích hợp</span>
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-[10px] text-slate-500">Last 1 hour · {visibleMetrics.length} actual samples{visibleMetrics.length > 0 ? ` · available since ${new Date(visibleMetrics[0].timestamp * 1000).toLocaleTimeString()}` : ''}. Gaps indicate missing data.</p>
                {/* 1. CPU Usage */}
                <TaskmgrChart
                  title="CPU"
                  subtitle={`${node.metricsScope || "Unknown"} · % CPU allocation`}
                  currentDisplay={current ? `${node.cpuUsage.toFixed(2)}%` : "Unavailable"}
                  data={visibleMetrics.map((m) => ({
                    timestamp: m.timestamp,
                    label: new Date(m.timestamp * 1000).toLocaleTimeString(),
                    value: Number(m.cpuUsage || 0),
                  }))}
                  unit="%"
                  colorHex="var(--chart-1)"
                  colorClass="text-primary"
                  gridId={`grid-cpu-${node.id}`}
                  fixedMax={100}
                  decimals={1}
                />

                {/* 2. Memory / RAM Usage */}
                <TaskmgrChart
                  title="Memory"
                  subtitle={`${node.metricsScope || "Unknown"} · % memory limit`}
                  currentDisplay={current ? `${node.memoryUsage.toFixed(2)}%` : "Unavailable"}
                  data={visibleMetrics.map((m) => ({
                    timestamp: m.timestamp,
                    label: new Date(m.timestamp * 1000).toLocaleTimeString(),
                    value: Number(m.memoryUsage || 0),
                  }))}
                  unit="%"
                  colorHex="var(--chart-4)"
                  colorClass="text-primary"
                  gridId={`grid-mem-${node.id}`}
                  decimals={1}
                />

                {/* 3. Throughput (RPS) */}
                <TaskmgrChart
                  title="Throughput (RPS)"
                  subtitle="Requests / Second"
                  currentDisplay={current ? `${node.requestsPerSecond} req/s` : "Unavailable"}
                  data={visibleMetrics.map((m) => ({
                    timestamp: m.timestamp,
                    label: new Date(m.timestamp * 1000).toLocaleTimeString(),
                    value: Number(m.rps || 0),
                  }))}
                  unit="req/s"
                  colorHex="var(--chart-2)"
                  colorClass="text-primary"
                  gridId={`grid-rps-${node.id}`}
                  decimals={1}
                />

                {/* 4. Active Connections */}
                <TaskmgrChart
                  title="Connections"
                  subtitle="Active TCP Sockets"
                  currentDisplay={current ? `${node.activeConnections} active` : "Unavailable"}
                  data={visibleMetrics.map((m) => ({
                    timestamp: m.timestamp,
                    label: new Date(m.timestamp * 1000).toLocaleTimeString(),
                    value: Number(m.activeConnections || 0),
                  }))}
                  unit="conns"
                  colorHex="var(--chart-3)"
                  colorClass="text-primary"
                  gridId={`grid-conns-${node.id}`}
                  decimals={0}
                />
              </div>
            )}
          </div>
        )}

        {activeTab === 'Config' && (
          <div className="space-y-3 font-mono text-xs">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-800 dark:text-slate-200">NGINX Adapter Config</span>
                <span className="px-1.5 py-0.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-[10px]">
                  Redacted snapshot
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={fetchNodeConfig}
                  disabled={isLoadingConfig}
                  className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
                  title="Tải lại file cấu hình từ container"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingConfig ? 'animate-spin text-primary' : ''}`} />
                </button>
                {nodeConfig && (
                  <button
                    type="button"
                    onClick={handleCopyConfig}
                    className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    title={copiedConfig ? 'Đã sao chép!' : 'Sao chép cấu hình'}
                  >
                    {copiedConfig ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
              </div>
            </div>

            <div className="text-[10px] text-muted-foreground px-0.5">
              <span>File: <code className="text-foreground">{configPath}</code></span>
            </div>

            {isLoadingConfig ? (
              <div className="p-8 bg-muted/40 border border-border flex items-center justify-center gap-2 text-muted-foreground">
                <RefreshCw className="w-4 h-4 animate-spin text-primary" />
                <span>Đang kéo file cấu hình trực tiếp từ container node...</span>
              </div>
            ) : configError ? (
              <div className="p-4 bg-rose-50 dark:bg-rose-950/20 border border-rose-300 dark:border-rose-500/40 space-y-2 text-xs font-mono">
                <div className="flex items-center gap-2 text-rose-700 dark:text-rose-400 font-bold">
                  <AlertCircle className="w-4 h-4" />
                  <span>Không thể kết nối tới Container Node</span>
                </div>
                <p className="text-slate-700 dark:text-slate-300 text-[11px] leading-relaxed break-all">
                  {configError}
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={fetchNodeConfig}
                    className="px-3 py-1.5 bg-card hover:bg-muted border border-border text-foreground text-[11px] font-mono cursor-pointer"
                  >
                    Thử lại
                  </button>
                </div>
              </div>
            ) : (
              <pre className="p-3 bg-muted/20 border border-border text-[11px] text-foreground font-mono overflow-x-auto leading-relaxed max-h-96">
                {nodeConfig}
              </pre>
            )}
          </div>
        )}

        {activeTab === 'Sync' && (
          <div className="space-y-4 font-mono text-xs">
            {/* Heartbeat ACK Status Card (In-place Merging - Không tạo thêm dòng) */}
            <div className="p-3 bg-muted/40 border border-border space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`relative flex h-2 w-2 ${node.status !== "Ready" ? "grayscale opacity-40" : ""}`}>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400 text-xs">Heartbeat Liveness</span>
                </div>
                <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-mono px-1.5 py-0.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-500/30">
                  {node.status === 'Ready' ? 'Recent' : 'Stale'}
                </span>
              </div>

              <div className="text-[11px] text-slate-600 dark:text-slate-400 space-y-1.5 pt-1.5 border-t border-border">
                <div className="flex justify-between">
                  <span className="text-slate-500">Trạng thái:</span>
                  <span className="text-emerald-600 dark:text-emerald-300 font-semibold">{node.status === 'Ready' ? 'Heartbeat received' : 'Unknown — stale heartbeat'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Heartbeat lần cuối:</span>
                  <span className="text-slate-800 dark:text-slate-200">{lastAckTime}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Địa chỉ Node IP:</span>
                  <span className="text-slate-800 dark:text-slate-300 font-mono">{node.ip}</span>
                </div>
              </div>
            </div>

            {/* Real Sync & Release History (Lịch sử đồng bộ thật từ CSDL) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                <span className="font-semibold">Sync History</span>
              </div>

              {logsError ? <div role="alert" className="text-rose-500">{logsError}</div> : isLoadingLogs ? (
                <div className="py-6 text-center text-slate-500 flex items-center justify-center gap-2 text-[11px]">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-primary" />
                  <span>Đang tải lịch sử sync...</span>
                </div>
              ) : syncLogs.length === 0 ? (
                <div className="p-4 bg-muted/40 border border-border text-center text-muted-foreground text-[11px] space-y-1">
                  <div>Chưa có sự kiện chuyển đổi release nào.</div>
                  <div className="text-[10px] text-muted-foreground/80">Không có bằng chứng đồng bộ đã được ghi nhận.</div>
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {syncLogs.map((log) => (
                    <div
                      key={log.id}
                      className="p-2.5 bg-muted/40 border border-border flex justify-between items-start gap-2 text-[11px]"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${log.event_type === 'release_applied'
                              ? 'bg-cyan-500 dark:bg-cyan-400'
                              : log.event_type === 'reload_completed'
                                ? 'bg-emerald-500 dark:bg-emerald-400'
                                : 'bg-amber-500 dark:bg-amber-400'
                              }`}
                          />
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            {log.event_type === 'release_applied'
                              ? `Release Applied ${log.release_id ? `#${log.release_id}` : ''}`
                              : log.event_type === 'reload_completed'
                                ? 'Reload Completed'
                                : 'Drift Detected'}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-600 dark:text-slate-400">{log.message}</div>
                      </div>
                      <span className="text-[10px] text-slate-500 whitespace-nowrap shrink-0">
                        {log.created_at}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface TaskmgrChartProps {
  title: string;
  subtitle: string;
  currentDisplay: string;
  data: { timestamp: number; label: string; value: number }[];
  unit: string;
  colorHex: string;
  colorClass: string;
  gridId: string;
  fixedMax?: number;
  decimals?: number;
}

function TaskmgrChart({
  title,
  subtitle,
  currentDisplay,
  data,
  unit,
  colorHex,
  colorClass,
  gridId,
  fixedMax,
  decimals = 1,
}: TaskmgrChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const end = Date.now() / 1000;
  const start = end - 3600;
  const chartData = data.filter(d => Number.isFinite(d.value) && d.timestamp >= start && d.timestamp <= end).sort((a, b) => a.timestamp - b.timestamp);
  const chartMax = fixedMax ?? Math.max(1, ...chartData.map(d => d.value * 1.15));
  const svgWidth = 360, svgHeight = 72, padX = 6, padY = 6;
  const effW = svgWidth - padX * 2, effH = svgHeight - padY * 2;
  const points = chartData.map(d => ({
    ...d, x: padX + (d.timestamp - start) / 3600 * effW,
    y: svgHeight - padY - Math.min(effH, Math.max(0, d.value / chartMax * effH))
  }));
  // Missing intervals remain gaps. One actual sample is a dot, never a fake line.
  const lineD = points.map((p, i) => `${i === 0 || p.timestamp - points[i - 1].timestamp > 90 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const activePt = hoverIndex !== null ? points[hoverIndex] : null;
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!points.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * svgWidth;
    let nearest = 0;
    points.forEach((p, i) => { if (Math.abs(p.x - x) < Math.abs(points[nearest].x - x)) nearest = i; });
    setHoverIndex(nearest);
  };

  const gradientId = `grad-${gridId}`;

  return (
    <div className="p-2.5 bg-card border border-border rounded font-mono text-xs select-none transition-all">
      {/* Header: Title & Subtitle ben trai, Gia tri hien tai ben phai */}
      <div className="flex items-baseline justify-between mb-1.5 px-0.5">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-foreground text-xs tracking-wide">{title}</span>
          <span className="text-[10px] text-muted-foreground font-sans">{subtitle}</span>
        </div>
        <div className="text-right">
          {activePt ? (
            <span className="text-foreground font-bold bg-muted px-1.5 py-0.5 rounded border border-border text-[11px]">
              {activePt.value.toFixed(decimals)} {unit}
              <span className="text-muted-foreground font-normal ml-1">({activePt.label})</span>
            </span>
          ) : (
            <span className={`text-xs font-bold ${colorClass}`}>
              {currentDisplay}
            </span>
          )}
        </div>
      </div>

      {/* Task Manager Grid Box */}
      <div className="relative border border-border rounded-sm bg-muted/20 overflow-hidden">
        {/* Scale labels in top-right / bottom-right */}
        <div className="absolute right-1.5 top-0.5 text-[9px] text-muted-foreground pointer-events-none font-mono opacity-70">
          {chartMax >= 100 ? Math.round(chartMax) : chartMax.toFixed(decimals > 0 ? 1 : 0)}{unit}
        </div>
        <div className="absolute right-1.5 bottom-0.5 text-[9px] text-muted-foreground pointer-events-none font-mono opacity-70">
          0{unit}
        </div>

        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-auto cursor-crosshair block"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIndex(null)}
        >
          <defs>
            {/* Windows Task Manager Grid Pattern */}
            <pattern id={gridId} width="24" height="15" patternUnits="userSpaceOnUse">
              <path
                d="M 24 0 L 0 0 0 15"
                fill="none"
                stroke="var(--border)"
                strokeWidth="0.75"
              />
            </pattern>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colorHex} stopOpacity="0.25" />
              <stop offset="100%" stopColor={colorHex} stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Grid Background */}
          <rect width="100%" height="100%" fill={`url(#${gridId})`} />

          {/* Baseline */}
          <line
            x1={padX}
            y1={svgHeight - padY}
            x2={svgWidth - padX}
            y2={svgHeight - padY}
            stroke="var(--border)"
            strokeWidth="1"
          />

          {/* Area under curve */}
          {points.length === 0 && <text x="180" y="38" textAnchor="middle" fill="currentColor" className="text-muted-foreground" fontSize="11">No samples in the last hour</text>}
          {points.map(p => <circle key={p.timestamp} cx={p.x} cy={p.y} r="1.5" fill={colorHex} />)}

          {/* Stroke Line */}
          <path
            d={lineD}
            fill="none"
            stroke={colorHex}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Hover Crosshair & Point */}
          {activePt && (
            <>
              <line
                x1={activePt.x}
                y1={padY}
                x2={activePt.x}
                y2={svgHeight - padY}
                stroke="var(--muted-foreground)"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
              <circle
                cx={activePt.x}
                cy={activePt.y}
                r="3.5"
                fill={colorHex}
                stroke="var(--card)"
                strokeWidth="2"
              />
            </>
          )}
        </svg>
      </div>

      {/* Footer / Time Axis */}
      <div className="flex justify-between text-[9px] text-slate-500 pt-1 px-0.5 font-mono">
        <span>{new Date(start * 1000).toLocaleTimeString()}</span>
        <span className="text-slate-600">Last 1 hour</span>
        <span>{new Date(end * 1000).toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
