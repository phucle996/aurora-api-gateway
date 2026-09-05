import React, { useState, useEffect, useCallback } from 'react';
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

interface NodeDetailProps {
  node: NodeItem;
  latestHeartbeatEvent?: any;
  latestSyncEvent?: any;
  onClose?: () => void;
}

function formatNodeUptime(createdAt?: string, status?: string, fallbackUptime?: string): string {
  if (status === 'Not Ready' || status === 'Offline') {
    return 'Offline';
  }
  if (!createdAt) {
    return fallbackUptime && fallbackUptime !== 'Active' ? fallbackUptime : 'Active';
  }

  const dateStr = createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T') + 'Z';
  const createdMs = new Date(dateStr).getTime();
  if (isNaN(createdMs)) {
    return fallbackUptime && fallbackUptime !== 'Active' ? fallbackUptime : 'Active';
  }

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
  const [metrics, setMetrics] = useState<any[]>([]);
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  // State cho Tab Sync
  const [syncLogs, setSyncLogs] = useState<NodeSyncLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [heartbeatAckCount, setHeartbeatAckCount] = useState(1);
  const [lastAckTimestamp, setLastAckTimestamp] = useState<number>(() => {
    return node.lastHeartbeatTimestamp || Date.now();
  });
  const [lastAckTime, setLastAckTime] = useState('0s trước');
  const [uptimeDisplay, setUptimeDisplay] = useState<string>(() =>
    formatNodeUptime(node.created_at, node.status, node.uptime)
  );

  // Cập nhật timestamp khi node thay đổi
  useEffect(() => {
    if (node.lastHeartbeatTimestamp) {
      setLastAckTimestamp(node.lastHeartbeatTimestamp);
    }
    setUptimeDisplay(formatNodeUptime(node.created_at, node.status, node.uptime));
  }, [node.id, node.lastHeartbeatTimestamp, node.created_at, node.status, node.uptime]);

  // Bộ đếm thời gian tương đối động cho ACK và Uptime (nhảy từng giây)
  useEffect(() => {
    const updateTime = () => {
      const diffSec = Math.max(0, Math.floor((Date.now() - lastAckTimestamp) / 1000));
      if (diffSec < 60) {
        setLastAckTime(`${diffSec}s trước`);
      } else if (diffSec < 3600) {
        setLastAckTime(`${Math.floor(diffSec / 60)}m trước`);
      } else {
        setLastAckTime(`${Math.floor(diffSec / 3600)}h trước`);
      }
      setUptimeDisplay(formatNodeUptime(node.created_at, node.status, node.uptime));
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, [lastAckTimestamp, node.created_at, node.status, node.uptime]);

  // Lắng nghe sự kiện heartbeat từ SSE để merge in-place vào Heartbeat ACK và metrics
  useEffect(() => {
    if (!latestHeartbeatEvent || latestHeartbeatEvent.node_id !== node.id) return;

    setHeartbeatAckCount((prev) => prev + 1);
    const ts = latestHeartbeatEvent.timestamp ? latestHeartbeatEvent.timestamp * 1000 : Date.now();
    setLastAckTimestamp(ts);

    // Nếu tab Metrics đang mở, cập nhật ngay điểm đo tức thời vào timeline
    if (activeTab === 'Metrics' && latestHeartbeatEvent.rps != null) {
      setMetrics((prev) => {
        const newPt = {
          timestamp: latestHeartbeatEvent.timestamp || Math.floor(Date.now() / 1000),
          timeLabel: 'Now',
          rps: latestHeartbeatEvent.rps,
          activeConnections: latestHeartbeatEvent.active_conns || 0,
          cpuUsage: latestHeartbeatEvent.cpu_usage != null ? latestHeartbeatEvent.cpu_usage : (node.cpuUsage || 0),
          memoryUsage: latestHeartbeatEvent.memory_usage != null ? latestHeartbeatEvent.memory_usage : (node.memoryUsage || 0),
        };
        const updated = [...prev, newPt];
        return updated.length > 30 ? updated.slice(updated.length - 30) : updated;
      });
    }
  }, [latestHeartbeatEvent, node.id, activeTab, node.cpuUsage, node.memoryUsage]);

  // Lắng nghe sự kiện sync thực tế từ SSE để append vào danh sách log
  useEffect(() => {
    if (!latestSyncEvent || latestSyncEvent.node_id !== node.id) return;
    setSyncLogs((prev) => {
      if (prev.some((item) => item.id === latestSyncEvent.id)) return prev;
      return [latestSyncEvent, ...prev].slice(0, 30);
    });
  }, [latestSyncEvent, node.id]);

  // Tải danh sách metrics lịch sử khi chuyển sang tab Metrics
  useEffect(() => {
    if (activeTab === 'Metrics' && node?.id) {
      setIsLoadingMetrics(true);
      setMetricsError(null);
      nodesApi
        .getMetrics(node.id)
        .then((data) => {
          if (Array.isArray(data)) {
            setMetrics(data);
          }
        })
        .catch((err: any) => {
          setMetricsError(
            err.message ||
              'Nguồn thu thập telemetry đang tắt hoặc không kết nối được tới máy chủ Prometheus.'
          );
        })
        .finally(() => {
          setIsLoadingMetrics(false);
        });
    }
  }, [activeTab, node?.id]);

  // Tải lịch sử sync thực tế khi chuyển sang tab Sync
  useEffect(() => {
    if (activeTab === 'Sync' && node?.id) {
      setIsLoadingLogs(true);
      nodesApi
        .getSyncHistory(node.id)
        .then((logs) => {
          if (Array.isArray(logs)) {
            setSyncLogs(logs);
          }
        })
        .catch((err) => {
          console.error('Failed to load node sync history:', err);
        })
        .finally(() => {
          setIsLoadingLogs(false);
        });
    }
  }, [activeTab, node?.id]);

  // State cho Tab Config (Live từ Container Node)
  const [nodeConfig, setNodeConfig] = useState<string | null>(null);
  const [configPath, setConfigPath] = useState<string>('/etc/nginx/nginx.conf');
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [copiedConfig, setCopiedConfig] = useState(false);

  const fetchNodeConfig = useCallback(() => {
    if (!node?.id) return;
    setIsLoadingConfig(true);
    setConfigError(null);
    nodesApi
      .getConfig(node.id)
      .then((res) => {
        if (res && res.config) {
          setNodeConfig(res.config);
          if (res.path) setConfigPath(res.path);
        } else {
          setConfigError('Dữ liệu cấu hình trả về rỗng từ node.');
        }
      })
      .catch((err: any) => {
        setConfigError(err.message || 'Không thể kéo file cấu hình từ container node.');
      })
      .finally(() => {
        setIsLoadingConfig(false);
      });
  }, [node?.id]);

  useEffect(() => {
    if (activeTab === 'Config') {
      fetchNodeConfig();
    }
  }, [activeTab, fetchNodeConfig]);

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
    <div className="w-full lg:w-[420px] bg-[#0B1320] border border-[#152030] flex flex-col shrink-0">
      {/* Detail Header */}
      <div className="p-4 border-b border-[#152030] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Server className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-mono font-bold text-white">
            {node.name}
          </span>
          {node.status === 'Ready' ? (
            <span className="inline-flex items-center px-2 py-0.5 bg-emerald-950/60 border border-emerald-500/50 text-emerald-400 text-[10px] font-mono">
              Ready
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 bg-rose-950/60 border border-rose-500/50 text-rose-400 text-[10px] font-mono">
              Not Ready
            </span>
          )}
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:bg-[#152030] text-slate-400 hover:text-white transition-colors cursor-pointer"
            title="Đóng bảng chi tiết"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#152030] bg-[#080E18] text-xs font-mono">
        {(['Overview', 'Metrics', 'Config', 'Sync'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-center transition-colors cursor-pointer ${
              activeTab === tab
                ? 'text-emerald-400 border-b-2 border-emerald-400 font-semibold bg-[#0B1320]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#0E1726]'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Body */}
      <div className="p-4 space-y-5 overflow-y-auto max-h-[calc(100vh-250px)]">
        {activeTab === 'Overview' && (
          <>
            {/* Meta Key-Value List */}
            <div className="space-y-2 text-xs font-mono">
              <div className="flex justify-between py-1 border-b border-[#152030]/60">
                <span className="text-slate-400">Name</span>
                <span className="text-slate-200 font-semibold">{node.name}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#152030]/60">
                <span className="text-slate-400">IP</span>
                <span className="text-slate-200">{node.ip}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#152030]/60">
                <span className="text-slate-400">Role</span>
                <span className="text-slate-200">{node.role}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#152030]/60">
                <span className="text-slate-400">Status</span>
                <span
                  className={
                    node.status === 'Ready'
                      ? 'text-emerald-400 font-semibold'
                      : 'text-rose-400 font-semibold'
                  }
                >
                  {node.status}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#152030]/60">
                <span className="text-slate-400">Version</span>
                <span className="text-slate-200">{node.version}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#152030]/60">
                <span className="text-slate-400">Ruleset Revision</span>
                <span className="text-cyan-400 font-semibold">{node.ruleset}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#152030]/60">
                <span className="text-slate-400">Uptime</span>
                <span className="text-slate-200 font-mono">{uptimeDisplay}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#152030]/60">
                <span className="text-slate-400">Last Heartbeat</span>
                <span className="text-slate-300">{node.lastHeartbeat}</span>
              </div>
            </div>

            {/* Realtime Connections & Traffic */}
            <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-xs">
              <div className="p-2.5 bg-[#080E18] border border-[#152030]">
                <div className="text-[10px] text-slate-500">Active Connections</div>
                <div className="text-sm font-bold text-white mt-0.5">
                  {node.activeConnections || '0'}
                </div>
              </div>
              <div className="p-2.5 bg-[#080E18] border border-[#152030]">
                <div className="text-[10px] text-slate-500">Requests per Second</div>
                <div className="text-sm font-bold text-white mt-0.5">
                  {node.requestsPerSecond || '0.0'}
                </div>
              </div>
            </div>

            {/* Policy Sync Banner */}
            <div className="p-3 bg-[#080E18] border border-[#152030] flex items-center justify-between font-mono text-xs">
              <span className="text-slate-400">Policy Sync</span>
              <div className="text-right">
                <span
                  className={`inline-flex items-center px-2 py-0.5 border text-[10px] ${
                    node.sync === 'Drift'
                      ? 'bg-amber-950/50 border-amber-500/40 text-amber-400'
                      : node.sync === 'Syncing'
                      ? 'bg-cyan-950/50 border-cyan-500/40 text-cyan-400'
                      : 'bg-emerald-950/50 border-emerald-500/40 text-emerald-400'
                  }`}
                >
                  {node.policySync}
                </span>
                <div className="text-[10px] text-slate-500 mt-1">
                  Last: {node.lastSyncTime}
                </div>
              </div>
            </div>

            {/* Recent Status Section */}
            <div className="p-3 bg-[#080E18] border border-[#152030] space-y-2.5 font-mono text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">Recent Status</span>
              </div>

              <div className="space-y-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-300">
                    <span className={`w-1.5 h-1.5 ${node.status === 'Ready' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                    <span>{node.name} liveness</span>
                  </div>
                  <span className="text-slate-400">{node.status} ({node.lastHeartbeat})</span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-300">
                    <span className="w-1.5 h-1.5 bg-cyan-400" />
                    <span>Active ruleset</span>
                  </div>
                  <span className="text-slate-400">{node.ruleset} ({node.sync})</span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-300">
                    <span className="w-1.5 h-1.5 bg-slate-500" />
                    <span>Registration time</span>
                  </div>
                  <span className="text-slate-500">{node.created_at || 'Registered'}</span>
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === 'Metrics' && (
          <div className="space-y-4 font-mono text-xs">
            {isLoadingMetrics ? (
              <div className="p-8 bg-[#080E18] border border-[#152030] flex items-center justify-center gap-2 text-slate-400">
                <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
                <span>Đang tải số liệu telemetry...</span>
              </div>
            ) : metricsError ? (
              <div className="p-4 bg-amber-950/20 border border-amber-500/40 space-y-2 text-xs font-mono">
                <div className="flex items-center gap-2 text-amber-400 font-bold">
                  <AlertCircle className="w-4 h-4" />
                  <span>Telemetry Không Khả Dụng (503)</span>
                </div>
                <p className="text-slate-300 text-[11px] leading-relaxed">
                  {metricsError}
                </p>
                <div className="pt-2">
                  <Link
                    to="/settings"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#152030] hover:bg-[#1C293D] border border-cyan-500/40 text-cyan-300 text-[11px] font-mono transition-colors cursor-pointer"
                  >
                    <span>Cấu hình tại Cài đặt -&gt; Tích hợp</span>
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {/* 1. CPU Usage */}
                <TaskmgrChart
                  title="CPU"
                  subtitle="% Utilization"
                  currentDisplay={`${(node.cpuUsage ?? 0).toFixed(1)}%`}
                  data={metrics.map((m: any) => ({
                    label: m.timeLabel || 'Now',
                    value: Number(m.cpuUsage || 0),
                  }))}
                  unit="%"
                  colorHex="#38bdf8"
                  colorClass="text-sky-400"
                  gridId={`grid-cpu-${node.id}`}
                  fixedMax={100}
                  decimals={1}
                />

                {/* 2. Memory / RAM Usage */}
                <TaskmgrChart
                  title="Memory"
                  subtitle="NGINX RAM Usage"
                  currentDisplay={`${(node.memoryUsage ?? 0).toFixed(1)} MB`}
                  data={metrics.map((m: any) => ({
                    label: m.timeLabel || 'Now',
                    value: Number(m.memoryUsage || 0),
                  }))}
                  unit="MB"
                  colorHex="#c084fc"
                  colorClass="text-purple-400"
                  gridId={`grid-mem-${node.id}`}
                  decimals={1}
                />

                {/* 3. Throughput (RPS) */}
                <TaskmgrChart
                  title="Throughput (RPS)"
                  subtitle="Requests / Second"
                  currentDisplay={`${Number(node.requestsPerSecond || 0).toFixed(1)} req/s`}
                  data={metrics.map((m: any) => ({
                    label: m.timeLabel || 'Now',
                    value: Number(m.rps || 0),
                  }))}
                  unit="req/s"
                  colorHex="#34d399"
                  colorClass="text-emerald-400"
                  gridId={`grid-rps-${node.id}`}
                  decimals={1}
                />

                {/* 4. Active Connections */}
                <TaskmgrChart
                  title="Connections"
                  subtitle="Active TCP Sockets"
                  currentDisplay={`${node.activeConnections || '0'} active`}
                  data={metrics.map((m: any) => ({
                    label: m.timeLabel || 'Now',
                    value: Number(m.activeConnections || 0),
                  }))}
                  unit="conns"
                  colorHex="#fbbf24"
                  colorClass="text-amber-400"
                  gridId={`grid-conns-${node.id}`}
                  decimals={0}
                />
              </div>
            )}
          </div>
        )}

        {activeTab === 'Config' && (
          <div className="space-y-3 font-mono text-xs">
            <div className="flex items-center justify-between text-slate-400">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-200">NGINX Adapter Config</span>
                <span className="px-1.5 py-0.5 bg-emerald-950/40 border border-emerald-500/30 text-emerald-400 text-[10px]">
                  Container Live
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={fetchNodeConfig}
                  disabled={isLoadingConfig}
                  className="p-1 hover:bg-[#152030] text-slate-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                  title="Tải lại file cấu hình từ container"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingConfig ? 'animate-spin text-emerald-400' : ''}`} />
                </button>
                {nodeConfig && (
                  <button
                    type="button"
                    onClick={handleCopyConfig}
                    className="p-1 hover:bg-[#152030] text-slate-400 hover:text-emerald-400 transition-colors cursor-pointer"
                    title={copiedConfig ? 'Đã sao chép!' : 'Sao chép cấu hình'}
                  >
                    {copiedConfig ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between text-[10px] text-slate-500 px-0.5">
              <span>File: <code className="text-slate-300">{configPath}</code></span>
              <span>Node: <code className="text-cyan-400">{node.id}</code></span>
            </div>

            {isLoadingConfig ? (
              <div className="p-8 bg-[#080E18] border border-[#152030] flex items-center justify-center gap-2 text-slate-400">
                <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
                <span>Đang kéo file cấu hình trực tiếp từ container node...</span>
              </div>
            ) : configError ? (
              <div className="p-4 bg-rose-950/20 border border-rose-500/40 space-y-2 text-xs font-mono">
                <div className="flex items-center gap-2 text-rose-400 font-bold">
                  <AlertCircle className="w-4 h-4" />
                  <span>Không thể kết nối tới Container Node</span>
                </div>
                <p className="text-slate-300 text-[11px] leading-relaxed break-all">
                  {configError}
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={fetchNodeConfig}
                    className="px-3 py-1.5 bg-[#152030] hover:bg-[#1C293D] border border-cyan-500/40 text-cyan-300 text-[11px] font-mono cursor-pointer"
                  >
                    Thử lại
                  </button>
                </div>
              </div>
            ) : (
              <pre className="p-3 bg-[#04070D] border border-[#1C293D] text-[11px] text-slate-300 font-mono overflow-x-auto leading-relaxed max-h-96">
                {nodeConfig}
              </pre>
            )}
          </div>
        )}

        {activeTab === 'Sync' && (
          <div className="space-y-4 font-mono text-xs">
            {/* Heartbeat ACK Status Card (In-place Merging - Không tạo thêm dòng) */}
            <div className="p-3 bg-[#080E18] border border-[#152030] space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span className="font-semibold text-emerald-400 text-xs">Heartbeat Liveness (ACK)</span>
                </div>
                <span className="text-[10px] text-emerald-400 font-mono px-1.5 py-0.5 bg-emerald-950/40 border border-emerald-500/30">
                  ACK #{heartbeatAckCount}
                </span>
              </div>

              <div className="text-[11px] text-slate-400 space-y-1.5 pt-1.5 border-t border-[#152030]/60">
                <div className="flex justify-between">
                  <span className="text-slate-500">Trạng thái:</span>
                  <span className="text-emerald-300 font-semibold">Active & Healthy</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">ACK lần cuối:</span>
                  <span className="text-slate-200">{lastAckTime}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Địa chỉ Node IP:</span>
                  <span className="text-slate-300 font-mono">{node.ip}</span>
                </div>
              </div>
            </div>

            {/* Real Sync & Release History (Lịch sử đồng bộ thật từ CSDL) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-slate-400">
                <span className="font-semibold">Sync History</span>
              </div>

              {isLoadingLogs ? (
                <div className="py-6 text-center text-slate-500 flex items-center justify-center gap-2 text-[11px]">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                  <span>Đang tải lịch sử sync...</span>
                </div>
              ) : syncLogs.length === 0 ? (
                <div className="p-4 bg-[#080E18] border border-[#152030] text-center text-slate-500 text-[11px] space-y-1">
                  <div>Chưa có sự kiện chuyển đổi release nào.</div>
                  <div className="text-[10px] text-slate-600">Node đang chạy đồng bộ với cấu hình ban đầu.</div>
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {syncLogs.map((log) => (
                    <div
                      key={log.id}
                      className="p-2.5 bg-[#080E18] border border-[#152030] flex justify-between items-start gap-2 text-[11px]"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              log.event_type === 'release_applied'
                                ? 'bg-cyan-400'
                                : log.event_type === 'reload_completed'
                                ? 'bg-emerald-400'
                                : 'bg-amber-400'
                            }`}
                          />
                          <span className="font-semibold text-slate-200">
                            {log.event_type === 'release_applied'
                              ? `Release Applied ${log.release_id ? `#${log.release_id}` : ''}`
                              : log.event_type === 'reload_completed'
                              ? 'Reload Completed'
                              : 'Drift Detected'}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400">{log.message}</div>
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
  data: { label: string; value: number }[];
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

  // Neu chi co 1 diem du lieu, tao diem truoc do de render duong chart
  const chartData =
    !data || data.length === 0
      ? [{ label: 'Now', value: 0 }]
      : data.length === 1
        ? [{ label: '-15s', value: data[0].value }, data[0]]
        : data;

  const values = chartData.map((d) => d.value);
  const maxVal = Math.max(...values);
  const chartMax = fixedMax != null ? fixedMax : Math.max(1, maxVal > 0 ? maxVal * 1.15 : 10);
  const chartMin = 0;

  const svgWidth = 360;
  const svgHeight = 72;
  const padX = 6;
  const padY = 6;
  const effW = svgWidth - padX * 2;
  const effH = svgHeight - padY * 2;

  const points = chartData.map((d, i) => {
    const x = padX + (chartData.length > 1 ? (i / (chartData.length - 1)) * effW : effW / 2);
    const norm = chartMax > chartMin ? (d.value - chartMin) / (chartMax - chartMin) : 0;
    const y = svgHeight - padY - Math.min(effH, Math.max(0, norm * effH));
    return { x, y, ...d };
  });

  const lineD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
  const areaD = `${lineD} L ${points[points.length - 1].x.toFixed(1)} ${(svgHeight - padY).toFixed(1)} L ${points[0].x.toFixed(1)} ${(svgHeight - padY).toFixed(1)} Z`;

  const activeIndex = hoverIndex !== null && hoverIndex < points.length ? hoverIndex : null;
  const activePt = activeIndex !== null ? points[activeIndex] : null;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, (relX - padX) / effW));
    const idx = Math.round(ratio * (chartData.length - 1));
    setHoverIndex(idx);
  };

  const gradientId = `grad-${gridId}`;

  return (
    <div className="p-2.5 bg-[#060A11] border border-[#141F30] rounded font-mono text-xs select-none transition-all">
      {/* Header: Title & Subtitle ben trai, Gia tri hien tai ben phai */}
      <div className="flex items-baseline justify-between mb-1.5 px-0.5">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-slate-200 text-xs tracking-wide">{title}</span>
          <span className="text-[10px] text-slate-500 font-sans">{subtitle}</span>
        </div>
        <div className="text-right">
          {activePt ? (
            <span className="text-white font-bold bg-[#142033] px-1.5 py-0.5 rounded border border-[#203450] text-[11px]">
              {activePt.value.toFixed(decimals)} {unit}
              <span className="text-slate-400 font-normal ml-1">({activePt.label})</span>
            </span>
          ) : (
            <span className={`text-xs font-bold ${colorClass}`}>
              {currentDisplay}
            </span>
          )}
        </div>
      </div>

      {/* Task Manager Grid Box */}
      <div className="relative border border-[#17253B] rounded-sm bg-[#04070C] overflow-hidden">
        {/* Scale labels in top-right / bottom-right */}
        <div className="absolute right-1.5 top-0.5 text-[9px] text-slate-500 pointer-events-none font-mono opacity-70">
          {chartMax >= 100 ? Math.round(chartMax) : chartMax.toFixed(decimals > 0 ? 1 : 0)}{unit}
        </div>
        <div className="absolute right-1.5 bottom-0.5 text-[9px] text-slate-600 pointer-events-none font-mono opacity-70">
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
                stroke="#131F33"
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
            stroke="#17253B"
            strokeWidth="1"
          />

          {/* Area under curve */}
          <path d={areaD} fill={`url(#${gradientId})`} />

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
                stroke="#64748B"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
              <circle
                cx={activePt.x}
                cy={activePt.y}
                r="3.5"
                fill={colorHex}
                stroke="#04070C"
                strokeWidth="2"
              />
            </>
          )}
        </svg>
      </div>

      {/* Footer / Time Axis */}
      <div className="flex justify-between text-[9px] text-slate-500 pt-1 px-0.5 font-mono">
        <span>{chartData[0]?.label || '-60s'}</span>
        <span className="text-slate-600">60 seconds</span>
        <span>{chartData[chartData.length - 1]?.label || '0 (Now)'}</span>
      </div>
    </div>
  );
}
