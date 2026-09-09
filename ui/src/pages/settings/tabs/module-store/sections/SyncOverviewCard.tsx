import React, { useState } from 'react';
import { 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  Loader2, 
  ShieldCheck, 
  Layers, 
  ArrowRightLeft,
  Sparkles
} from 'lucide-react';
import { api } from '../../../../../lib/fetcher';
import type { ModuleSyncItem } from './types';

interface SyncOverviewCardProps {
  items: ModuleSyncItem[];
  loading: boolean;
  onRefresh: () => Promise<void>;
}

export function SyncOverviewCard({ items, loading, onRefresh }: SyncOverviewCardProps) {
  const [syncingModule, setSyncingModule] = useState<string | null>(null);
  const [togglingModule, setTogglingModule] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const hasOutOfSync = items.some((item) => item.sync_status === 'OutOfSync');
  const isProgressing = items.some((item) => item.sync_status === 'Progressing');

  const handleToggleDesired = async (name: string, currentDesired: boolean) => {
    setTogglingModule(name);
    setActionMsg(null);
    try {
      await api.put(`/api/v1/settings/modules/${name}/desired`, {
        enabled: !currentDesired,
      });
      setActionMsg({
        text: `Đã cập nhật trạng thái mong muốn của ${name.toUpperCase()} thành ${!currentDesired ? 'BẬT' : 'TẮT'} và kích hoạt fanout sync.`,
        type: 'success',
      });
      await onRefresh();
    } catch (err) {
      setActionMsg({
        text: err instanceof Error ? err.message : 'Không thể cập nhật cấu hình mong muốn',
        type: 'error',
      });
    } finally {
      setTogglingModule(null);
    }
  };

  const handleTriggerSync = async (name?: string) => {
    setSyncingModule(name || 'all');
    setActionMsg(null);
    try {
      const res = await api.post<{ queued_jobs: number; node_ids: string[] }>(
        '/api/v1/settings/modules/sync',
        { module: name || '' }
      );
      setActionMsg({
        text: `Đã fanout lệnh đồng bộ thành công: ${res.queued_jobs} tác vụ được xếp hàng chờ các NGINX node pull về.`,
        type: 'success',
      });
      await onRefresh();
    } catch (err) {
      setActionMsg({
        text: err instanceof Error ? err.message : 'Không thể kích hoạt lệnh đồng bộ fanout',
        type: 'error',
      });
    } finally {
      setSyncingModule(null);
    }
  };

  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-zinc-800 bg-gradient-to-b from-zinc-900/90 to-zinc-950/80 p-5 shadow-xl backdrop-blur-md">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-zinc-800/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 shadow-inner">
            <ArrowRightLeft className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-zinc-100">Sync Overview</h3>
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-zinc-400 uppercase">
                Fleet Generic
              </span>
            </div>
            <p className="text-xs text-zinc-400">
              Đối soát cấu hình mong muốn (Desired State) với hiện trạng thực tế (Actual State) của toàn bộ NGINX nodes.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Status Badge */}
          {isProgressing ? (
            <div className="flex items-center gap-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Progressing</span>
            </div>
          ) : hasOutOfSync ? (
            <div className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Drift / Out of Sync</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Synced (100%)</span>
            </div>
          )}

          {/* Sync All Button */}
          <button
            onClick={() => void handleTriggerSync()}
            disabled={loading || syncingModule !== null}
            className="flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-600/20 px-3 py-1.5 text-xs font-medium text-cyan-300 transition-all hover:bg-cyan-500/30 hover:shadow-lg hover:shadow-cyan-950/50 disabled:opacity-50"
            title="Fanout kiểm tra và đồng bộ lại toàn bộ node bị lệch trạng thái"
          >
            {syncingModule === 'all' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span>Sync Fleet</span>
          </button>
        </div>
      </div>

      {/* Action Notification Message */}
      {actionMsg && (
        <div
          className={`mt-3 flex items-center justify-between rounded-lg px-3.5 py-2 text-xs transition-all ${
            actionMsg.type === 'success'
              ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border border-rose-500/30 bg-rose-500/10 text-rose-300'
          }`}
        >
          <span>{actionMsg.text}</span>
          <button
            onClick={() => setActionMsg(null)}
            className="ml-3 font-semibold hover:opacity-75"
          >
            ✕
          </button>
        </div>
      )}

      {/* Grid of Modules */}
      <div className="mt-4 grid grid-cols-1 gap-3.5 md:grid-cols-2">
        {items.map((item) => {
          const isToggling = togglingModule === item.name;
          const isSyncing = syncingModule === item.name;

          return (
            <div
              key={item.name}
              className="flex flex-col justify-between rounded-lg border border-zinc-800/90 bg-zinc-900/50 p-4 transition-all hover:border-zinc-700/80"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded bg-zinc-800 text-zinc-300">
                    <Layers className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-zinc-200 capitalize">{item.name}</span>
                      {item.sync_status === 'Synced' ? (
                        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400 border border-emerald-500/20">
                          Synced
                        </span>
                      ) : item.sync_status === 'Progressing' ? (
                        <span className="flex items-center gap-1 rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400 border border-blue-500/20">
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          Progressing
                        </span>
                      ) : (
                        <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400 border border-amber-500/20">
                          Out of Sync
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      {item.name === 'brotli'
                        ? 'Thuật toán nén hiệu năng cao Google Brotli'
                        : item.name === 'gzip'
                        ? 'Nén nội dung chuẩn RFC 1952 tiêu chuẩn NGINX'
                        : 'Mô-đun NGINX mở rộng'}
                    </p>
                  </div>
                </div>

                {/* Desired Toggle */}
                <div className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-zinc-400 font-medium">Desired:</span>
                    <button
                      onClick={() => void handleToggleDesired(item.name, item.desired)}
                      disabled={isToggling || isSyncing}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
                        item.desired ? 'bg-cyan-600' : 'bg-zinc-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                          item.desired ? 'translate-x-4' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                  <span className="text-[10px] text-zinc-500">
                    {item.desired ? 'Mong muốn: BẬT' : 'Mong muốn: TẮT'}
                  </span>
                </div>
              </div>

              {/* Status Comparison Footer */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/60 pt-3 text-xs">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-zinc-500">Live Active:</span>
                    <span className="font-medium text-zinc-200">
                      {item.actual_loaded}/{item.total_nodes} nodes
                    </span>
                  </div>

                  {item.feature_ready ? (
                    <div className="flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      <span>Feature Ready</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-[11px] text-zinc-500">
                      <Sparkles className="h-3 w-3 text-zinc-600" />
                      <span>{item.desired ? 'Đang đợi node đồng bộ...' : 'Chưa kích hoạt'}</span>
                    </div>
                  )}
                </div>

                {/* Single Reconcile Button if out of sync */}
                {item.sync_status === 'OutOfSync' && (
                  <button
                    onClick={() => void handleTriggerSync(item.name)}
                    disabled={isSyncing}
                    className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[11px] font-medium text-amber-300 hover:bg-zinc-700 transition-colors disabled:opacity-50"
                  >
                    {isSyncing ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    <span>Reconcile</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
