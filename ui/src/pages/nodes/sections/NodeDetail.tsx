import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Server,
  MoreHorizontal,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  ArrowRight,
  Activity,
  Sliders,
  RefreshCw,
  Shield,
} from 'lucide-react';
import type { NodeItem } from './NodesTable';
import { nodesApi } from '../../../lib/api';

interface NodeDetailProps {
  node: NodeItem;
}

export function NodeDetail({ node }: NodeDetailProps) {
  const [activeTab, setActiveTab] = useState<'Overview' | 'Metrics' | 'Config' | 'Sync'>('Overview');
  const [copiedMtlsCmd, setCopiedMtlsCmd] = useState(false);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);

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

  const mtlsVerifyCommand = `curl -s --cacert /etc/aurora-waf/certs/ca.crt \\\n  --cert /etc/aurora-waf/certs/node.crt \\\n  --key /etc/aurora-waf/certs/node.key \\\n  https://control-plane.internal:8080/api/v1/rule-releases/active`;

  const handleCopyCommand = () => {
    navigator.clipboard.writeText(mtlsVerifyCommand);
    setCopiedMtlsCmd(true);
    setTimeout(() => setCopiedMtlsCmd(false), 2000);
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

        <button
          type="button"
          className="p-1 hover:bg-[#152030] text-slate-400 hover:text-white transition-colors cursor-pointer"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
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
                <span className="text-slate-400">Role</span>
                <span className="text-slate-200">{node.role}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#152030]/60">
                <span className="text-slate-400">Region</span>
                <span className="text-slate-200">{node.regionFull}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#152030]/60">
                <span className="text-slate-400">Join Method</span>
                <span className="text-slate-200">{node.joinMethod}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#152030]/60">
                <span className="text-slate-400">Certificate</span>
                <span className="text-emerald-400">{node.certificate}</span>
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
                <span className="text-slate-200">{node.uptime}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#152030]/60">
                <span className="text-slate-400">Last Heartbeat</span>
                <span className="text-slate-300">{node.lastHeartbeat}</span>
              </div>
            </div>

            {/* Performance Gauges / Meters */}
            <div className="space-y-3 pt-2">
              <div>
                <div className="flex justify-between text-xs font-mono mb-1">
                  <span className="text-slate-400">CPU Usage</span>
                  <span className="text-slate-200 font-semibold">{node.cpuUsage}%</span>
                </div>
                <div className="h-1.5 w-full bg-[#152030] overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-300"
                    style={{ width: `${node.cpuUsage}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs font-mono mb-1">
                  <span className="text-slate-400">Memory Usage</span>
                  <span className="text-slate-200 font-semibold">{node.memoryUsage}%</span>
                </div>
                <div className="h-1.5 w-full bg-[#152030] overflow-hidden">
                  <div
                    className="h-full bg-cyan-500 transition-all duration-300"
                    style={{ width: `${node.memoryUsage}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-xs">
                <div className="p-2.5 bg-[#080E18] border border-[#152030]">
                  <div className="text-[10px] text-slate-500">Active Connections</div>
                  <div className="text-sm font-bold text-white mt-0.5">
                    {node.activeConnections}
                  </div>
                </div>
                <div className="p-2.5 bg-[#080E18] border border-[#152030]">
                  <div className="text-[10px] text-slate-500">Requests per Second</div>
                  <div className="text-sm font-bold text-white mt-0.5">
                    {node.requestsPerSecond}
                  </div>
                </div>
              </div>
            </div>

            {/* Policy Sync Banner */}
            <div className="p-3 bg-[#080E18] border border-[#152030] flex items-center justify-between font-mono text-xs">
              <span className="text-slate-400">Policy Sync</span>
              <div className="text-right">
                <span className="inline-flex items-center px-2 py-0.5 bg-emerald-950/50 border border-emerald-500/40 text-emerald-400 text-[10px]">
                  {node.policySync}
                </span>
                <div className="text-[10px] text-slate-500 mt-1">
                  Last: {node.lastSyncTime}
                </div>
              </div>
            </div>

            {/* mTLS Node Authentication Box */}
            <div className="p-3.5 bg-[#080E18] border border-[#152030] space-y-3 font-mono">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                <Shield className="w-3.5 h-3.5" />
                <span>Node Authentication (mTLS Enrolled)</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed font-sans">
                NGINX nodes authenticate with the Control Plane using mutual TLS (mTLS). Certificates in <code className="text-emerald-300">/etc/aurora-waf/certs</code> verify node identity without requiring tokens.
              </p>

              <div className="space-y-2 text-[11px] text-slate-300">
                <div className="flex items-start gap-2">
                  <span className="w-4 h-4 bg-[#152030] text-emerald-400 flex items-center justify-center text-[10px] shrink-0">
                    1
                  </span>
                  <span>Provision certificate bundle (<code className="text-slate-200">ca.crt</code>, <code className="text-slate-200">node.crt</code>, <code className="text-slate-200">node.key</code>)</span>
                </div>

                <div className="flex items-start gap-2">
                  <span className="w-4 h-4 bg-[#152030] text-emerald-400 flex items-center justify-center text-[10px] shrink-0">
                    2
                  </span>
                  <span>Verify mTLS handshake & active policy pull:</span>
                </div>

                {/* Code Block */}
                <div className="relative p-2.5 bg-[#04070D] border border-[#1C293D] text-[10px] text-emerald-300 font-mono overflow-x-auto">
                  <pre className="whitespace-pre-wrap">{mtlsVerifyCommand}</pre>
                  <button
                    type="button"
                    onClick={handleCopyCommand}
                    className="absolute top-2 right-2 p-1 bg-[#152030] hover:bg-[#1C293D] text-slate-300 hover:text-white transition-colors cursor-pointer"
                    title="Copy verify command"
                  >
                    {copiedMtlsCmd ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>

                <div className="flex items-start gap-2">
                  <span className="w-4 h-4 bg-[#152030] text-emerald-400 flex items-center justify-center text-[10px] shrink-0">
                    3
                  </span>
                  <span>Node daemon boots via <code className="text-slate-200">systemctl start aurora-waf-nginx</code></span>
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
                  <span className="text-slate-500">{node.created_at || 'mTLS Enrolled'}</span>
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
              <>
                <div className="p-3 bg-[#080E18] border border-[#152030]">
                  <div className="text-slate-400 mb-2 font-semibold flex items-center justify-between">
                    <span>RPS Timeline (Real-time Live)</span>
                    <Activity className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                  {metrics.length === 0 ? (
                    <div className="py-8 text-center text-slate-500 font-mono text-[11px] space-y-1">
                      <div>Chưa nhận được gói tin telemetry nào từ node này.</div>
                      <div className="text-slate-600 text-[10px]">
                        Đang chờ NGINX Data Plane đẩy protobuf heartbeat định kỳ qua module tích hợp...
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="h-28 flex items-end gap-1 pt-2">
                        {metrics.map((pt: any, i: number) => {
                          const maxRPS = Math.max(50, ...metrics.map((m: any) => m.rps || 0));
                          const heightPercent = Math.min(100, Math.max(8, ((pt.rps || 0) / maxRPS) * 100));
                          return (
                            <div
                              key={i}
                              className="flex-1 bg-emerald-500/70 hover:bg-emerald-400 transition-colors cursor-pointer"
                              style={{ height: `${heightPercent}%` }}
                              title={`Thời điểm: ${pt.timeLabel}\nRPS: ${Math.round(pt.rps)} req/s\nCPU: ${pt.cpuUsage?.toFixed(1)}%\nRAM: ${pt.memoryUsage?.toFixed(1)}%`}
                            />
                          );
                        })}
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-500 mt-2">
                        <span>{metrics[0]?.timeLabel || '-10m'}</span>
                        <span>{metrics[Math.floor(metrics.length / 2)]?.timeLabel || '-5m'}</span>
                        <span>{metrics[metrics.length - 1]?.timeLabel || 'Now'}</span>
                      </div>
                    </>
                  )}
                </div>

                <div className="p-3 bg-[#080E18] border border-[#152030]">
                  <div className="text-slate-400 mb-2 font-semibold">Tài nguyên tức thời</div>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">CPU Usage:</span>
                      <span className="text-emerald-400">{(node.cpuUsage ?? 0).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Memory Usage:</span>
                      <span className="text-cyan-400">{(node.memoryUsage ?? 0).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Active Connections:</span>
                      <span className="text-slate-200">{node.activeConnections || '0'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Requests per Second:</span>
                      <span className="text-slate-200">{node.requestsPerSecond || '0'} req/s</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'Config' && (
          <div className="space-y-3 font-mono text-xs">
            <div className="flex items-center justify-between text-slate-400">
              <span className="font-semibold">NGINX Adapter Config</span>
              <Sliders className="w-3.5 h-3.5 text-slate-400" />
            </div>
            <pre className="p-3 bg-[#04070D] border border-[#1C293D] text-[11px] text-slate-300 font-mono overflow-x-auto leading-relaxed">
{`http {
    aurora_waf on;
    aurora_waf_controller https://waf-control.example.com;
    aurora_waf_node_id "${node.id}";
    aurora_waf_ruleset_cache /etc/aurora/rules.bin;
    aurora_waf_sync_interval 5s;
    aurora_waf_action_on_fail pass;
}`}
            </pre>
          </div>
        )}

        {activeTab === 'Sync' && (
          <div className="space-y-3 font-mono text-xs">
            <div className="flex items-center justify-between text-slate-400">
              <span className="font-semibold">Sync History & Logs</span>
              <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="space-y-2 text-[11px]">
              <div className="p-2.5 bg-[#080E18] border border-[#152030] flex justify-between items-center">
                <div>
                  <div className="text-emerald-400 font-semibold">rev-128 applied</div>
                  <div className="text-[10px] text-slate-500">All 32 policies compiled</div>
                </div>
                <span className="text-slate-500">08:41:02 UTC</span>
              </div>
              <div className="p-2.5 bg-[#080E18] border border-[#152030] flex justify-between items-center">
                <div>
                  <div className="text-slate-300 font-semibold">Heartbeat ACK</div>
                  <div className="text-[10px] text-slate-500">Latency: 1.2ms</div>
                </div>
                <span className="text-slate-500">08:40:55 UTC</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
