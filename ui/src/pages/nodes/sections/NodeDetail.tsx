import React, { useState } from 'react';
import {
  Server,
  MoreHorizontal,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Info,
  ArrowRight,
  Activity,
  Sliders,
  RefreshCw,
} from 'lucide-react';
import type { NodeItem } from './NodesTable';

interface NodeDetailProps {
  node: NodeItem;
}

export function NodeDetail({ node }: NodeDetailProps) {
  const [activeTab, setActiveTab] = useState<'Overview' | 'Metrics' | 'Config' | 'Sync'>('Overview');
  const [copiedJoinCmd, setCopiedJoinCmd] = useState(false);

  const joinCommand = `aurora-waf join --controller https://waf-control.example.com \\\n  --token awf_${node.name}_bootstrap_token`;

  const handleCopyCommand = () => {
    navigator.clipboard.writeText(joinCommand);
    setCopiedJoinCmd(true);
    setTimeout(() => setCopiedJoinCmd(false), 2000);
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

            {/* Join Node (Automatic Registration) Box */}
            <div className="p-3.5 bg-[#080E18] border border-[#152030] space-y-3 font-mono">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-cyan-400">
                <Info className="w-3.5 h-3.5" />
                <span>Join Node (Automatic Registration)</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed font-sans">
                NGINX nodes join the cluster automatically using a secure bootstrap token. Generate a token and run the join command on the node. The node will appear here after registration.
              </p>

              <div className="space-y-2 text-[11px] text-slate-300">
                <div className="flex items-start gap-2">
                  <span className="w-4 h-4 bg-[#152030] text-cyan-400 flex items-center justify-center text-[10px] shrink-0">
                    1
                  </span>
                  <span>Generate a bootstrap token (valid for 24 hours)</span>
                </div>

                <div className="flex items-start gap-2">
                  <span className="w-4 h-4 bg-[#152030] text-cyan-400 flex items-center justify-center text-[10px] shrink-0">
                    2
                  </span>
                  <span>Run the join command on the NGINX node:</span>
                </div>

                {/* Code Block */}
                <div className="relative p-2.5 bg-[#04070D] border border-[#1C293D] text-[10px] text-emerald-300 font-mono overflow-x-auto">
                  <pre className="whitespace-pre-wrap">{joinCommand}</pre>
                  <button
                    type="button"
                    onClick={handleCopyCommand}
                    className="absolute top-2 right-2 p-1 bg-[#152030] hover:bg-[#1C293D] text-slate-300 hover:text-white transition-colors cursor-pointer"
                    title="Copy join command"
                  >
                    {copiedJoinCmd ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>

                <div className="flex items-start gap-2">
                  <span className="w-4 h-4 bg-[#152030] text-cyan-400 flex items-center justify-center text-[10px] shrink-0">
                    3
                  </span>
                  <span>Node appears automatically after registration</span>
                </div>
              </div>
            </div>

            {/* Recent Events Section */}
            <div className="p-3 bg-[#080E18] border border-[#152030] space-y-2.5 font-mono text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">Recent Events</span>
                <button
                  type="button"
                  className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer"
                >
                  <span>View all</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>

              <div className="space-y-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-300">
                    <span className="w-1.5 h-1.5 bg-emerald-400" />
                    <span>edge-06 registered</span>
                  </div>
                  <span className="text-slate-500">2026-09-05 08:36 UTC</span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-300">
                    <span className="w-1.5 h-1.5 bg-emerald-400" />
                    <span>Policy rev-128 published</span>
                  </div>
                  <span className="text-slate-500">2026-09-05 08:41 UTC</span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-300">
                    <span className="w-1.5 h-1.5 bg-rose-400" />
                    <span>edge-04 missed heartbeat</span>
                  </div>
                  <span className="text-slate-500">2026-09-05 08:39 UTC</span>
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === 'Metrics' && (
          <div className="space-y-4 font-mono text-xs">
            <div className="p-3 bg-[#080E18] border border-[#152030]">
              <div className="text-slate-400 mb-2 font-semibold flex items-center justify-between">
                <span>RPS Timeline (Last 1 hr)</span>
                <Activity className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div className="h-28 flex items-end gap-1 pt-2">
                {[45, 60, 52, 78, 65, 90, 85, 95, 70, 80, 75, 88, 92, 100, 85, 70, 65, 80, 95, 88].map(
                  (val, i) => (
                    <div
                      key={i}
                      className="flex-1 bg-emerald-500/70 hover:bg-emerald-400 transition-colors"
                      style={{ height: `${val}%` }}
                      title={`Time -${20 - i}m: ${val * 35} req/s`}
                    />
                  )
                )}
              </div>
              <div className="flex justify-between text-[10px] text-slate-500 mt-2">
                <span>-60m</span>
                <span>-30m</span>
                <span>Now</span>
              </div>
            </div>

            <div className="p-3 bg-[#080E18] border border-[#152030]">
              <div className="text-slate-400 mb-2 font-semibold">Memory & Cache Pressure</div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Shared Dict Size:</span>
                  <span className="text-slate-200">128 MB</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Dict Utilized:</span>
                  <span className="text-emerald-400">34.2 MB (26.7%)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Evictions / min:</span>
                  <span className="text-slate-200">0</span>
                </div>
              </div>
            </div>
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
