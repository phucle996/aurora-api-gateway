import React, { useState } from 'react';
import {
  Activity,
  Flame,
  VolumeX,
  Clock,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Plus,
  Settings,
  X,
  Loader2,
} from 'lucide-react';
import {
  alertsApi,
  type AlertmanagerOverview,
  type PrometheusRuleItem,
  type AlertmanagerSilenceItem,
  type AlertmanagerSettings,
} from '../../../../../lib/api';

export interface AlertmanagerIntegrationSectionProps {
  overview: AlertmanagerOverview | null;
  rules: PrometheusRuleItem[];
  silences: AlertmanagerSilenceItem[];
  loading: boolean;
  onRefresh: () => void;
  onConfigUpdated: () => void;
}

export function AlertmanagerIntegrationSection({
  overview,
  rules,
  silences,
  loading,
  onRefresh,
  onConfigUpdated,
}: AlertmanagerIntegrationSectionProps) {
  // Modal states
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [configForm, setConfigForm] = useState<AlertmanagerSettings>({
    enabled: true,
    alertmanager_url: overview?.alertmanager_url || 'http://127.0.0.1:9093',
    prometheus_url: overview?.prometheus_url || 'http://127.0.0.1:9090',
  });
  const [savingConfig, setSavingConfig] = useState(false);

  // Silence Modal state
  const [silenceModalOpen, setSilenceModalOpen] = useState(false);
  const [targetAlertName, setTargetAlertName] = useState('');
  const [silenceDurationHours, setSilenceDurationHours] = useState(2);
  const [silenceComment, setSilenceComment] = useState('Bảo trì định kỳ');
  const [creatingSilence, setCreatingSilence] = useState(false);

  // Expiring silence state
  const [expiringId, setExpiringId] = useState<string | null>(null);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSavingConfig(true);
      await alertsApi.updateConfig(configForm);
      setConfigModalOpen(false);
      onConfigUpdated();
    } catch (err) {
      alert('Cập nhật cấu hình thất bại: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSavingConfig(false);
    }
  };

  const handleCreateSilence = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setCreatingSilence(true);
      const endsAt = new Date(Date.now() + silenceDurationHours * 3600 * 1000).toISOString();
      await alertsApi.createSilence({
        ends_at: endsAt,
        created_by: 'aurora-admin',
        comment: silenceComment,
        matchers: [
          {
            name: 'alertname',
            value: targetAlertName,
            isRegex: false,
            isEqual: true,
          },
        ],
      });
      setSilenceModalOpen(false);
      onRefresh();
    } catch (err) {
      alert('Tạo silence thất bại: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setCreatingSilence(false);
    }
  };

  const handleExpireSilence = async (id: string) => {
    try {
      setExpiringId(id);
      await alertsApi.expireSilence(id);
      onRefresh();
    } catch (err) {
      alert('Xóa silence thất bại: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setExpiringId(null);
    }
  };

  const openSilenceModal = (alertName: string) => {
    setTargetAlertName(alertName);
    setSilenceComment(`Tắt chuông tạm thời cho ${alertName}`);
    setSilenceModalOpen(true);
  };

  const firingAlertsCount = rules.filter((r) => r.state === 'firing').length;

  return (
    <div className="pt-4 border-t border-border space-y-4">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <span className="text-xs font-semibold text-foreground">
            Prometheus & Alertmanager Alert Engine
          </span>
          <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium border border-primary/20">
            Dedicated Engine
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setConfigForm({
                enabled: overview?.alertmanager_connected ?? true,
                alertmanager_url: overview?.alertmanager_url || 'http://127.0.0.1:9093',
                prometheus_url: overview?.prometheus_url || 'http://127.0.0.1:9090',
              });
              setConfigModalOpen(true);
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-border rounded hover:bg-muted/50 transition cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5 text-muted-foreground" />
            <span>Connection Settings</span>
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-border rounded hover:bg-muted/50 transition cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Cluster Health & Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {/* Prometheus Status */}
        <div className="p-3 bg-background border border-border rounded-md flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[11px] text-muted-foreground block">Prometheus (Rules)</span>
            <div className="flex items-center gap-1.5">
              {overview?.prometheus_connected ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    Connected ({overview.prometheus_latency_ms}ms)
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                  <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">Disconnected</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Alertmanager Status */}
        <div className="p-3 bg-background border border-border rounded-md flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[11px] text-muted-foreground block">Alertmanager (Dispatch)</span>
            <div className="flex items-center gap-1.5">
              {overview?.alertmanager_connected ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    Connected ({overview.alertmanager_latency_ms}ms)
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                  <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">Disconnected</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Firing Alerts Count */}
        <div className="p-3 bg-background border border-border rounded-md flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[11px] text-muted-foreground block">Active Firing Alerts</span>
            <div className="flex items-center gap-1.5">
              <Flame className={`w-3.5 h-3.5 ${firingAlertsCount > 0 ? 'text-rose-500' : 'text-muted-foreground'}`} />
              <span className={`text-xs font-semibold ${firingAlertsCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-foreground'}`}>
                {firingAlertsCount} rule(s) firing
              </span>
            </div>
          </div>
        </div>

        {/* Active Silences Count */}
        <div className="p-3 bg-background border border-border rounded-md flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[11px] text-muted-foreground block">Active Silences (Muted)</span>
            <div className="flex items-center gap-1.5">
              <VolumeX className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-xs font-semibold text-foreground">
                {silences.filter((s) => s.status === 'active').length} muted
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Live Rules Table */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-foreground">Live Evaluated Rules (Prometheus)</span>
          <span className="text-[11px] text-muted-foreground">{rules.length} total metric rules</span>
        </div>

        {rules.length === 0 ? (
          <div className="p-4 border border-dashed border-border rounded-md text-center text-xs text-muted-foreground">
            Chưa có quy tắc nào từ Prometheus hoặc máy chủ chưa kết nối được với endpoint <code>{overview?.prometheus_url}</code>.
          </div>
        ) : (
          <div className="divide-y divide-border border border-border rounded-lg bg-background overflow-hidden">
            {rules.map((rule) => {
              const isFiring = rule.state === 'firing';
              const isPending = rule.state === 'pending';

              return (
                <div key={rule.name} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-muted/20 transition-colors">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isFiring ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/30 animate-pulse">
                          <Flame className="w-3 h-3" /> FIRING
                        </span>
                      ) : isPending ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                          <Clock className="w-3 h-3" /> PENDING
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                          <CheckCircle2 className="w-3 h-3" /> INACTIVE
                        </span>
                      )}
                      <span className="font-semibold text-xs text-foreground font-mono">{rule.name}</span>
                      <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.2 rounded">
                        for: {rule.duration}
                      </span>
                      <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                        [{rule.severity}]
                      </span>
                    </div>

                    <p className="text-[11px] text-muted-foreground">
                      {rule.annotations.summary || rule.annotations.description || rule.query}
                    </p>

                    <div className="text-[10px] font-mono text-muted-foreground/80 truncate max-w-xl bg-muted/40 px-1.5 py-0.5 rounded">
                      expr: {rule.query}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => openSilenceModal(rule.name)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-border rounded hover:bg-muted/50 text-foreground transition cursor-pointer"
                    >
                      <VolumeX className="w-3 h-3 text-muted-foreground" />
                      <span>Silence / Tắt chuông</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Active Silences Section */}
      {silences.length > 0 && (
        <div className="space-y-2 pt-2">
          <span className="text-xs font-semibold text-foreground">Active Silences (Khoảng lặng trên Alertmanager)</span>
          <div className="divide-y divide-border border border-border rounded-lg bg-background overflow-hidden">
            {silences.map((sil) => (
              <div key={sil.id} className="p-3 flex items-center justify-between gap-3 hover:bg-muted/20">
                <div className="space-y-0.5 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded">
                      {sil.status.toUpperCase()}
                    </span>
                    <span className="font-mono text-xs text-foreground">
                      {sil.matchers.map((m) => `${m.name}=${m.value}`).join(', ')}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Lý do: {sil.comment} (tạo bởi: {sil.created_by})
                  </p>
                  <p className="text-[10px] text-muted-foreground font-mono">
                    Hết hạn vào: {new Date(sil.ends_at).toLocaleString()}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={expiringId === sil.id}
                  onClick={() => handleExpireSilence(sil.id)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-400 rounded hover:bg-rose-50 dark:hover:bg-rose-950/20 transition cursor-pointer"
                >
                  {expiringId === sil.id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <span>Hủy tắt chuông</span>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Connection Config Modal */}
      {configModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-lg max-w-md w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <span className="text-sm font-semibold text-foreground">Cấu hình kết nối Prometheus & Alertmanager</span>
              <button
                type="button"
                onClick={() => setConfigModalOpen(false)}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveConfig} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Prometheus Server URL</label>
                <input
                  type="text"
                  required
                  value={configForm.prometheus_url}
                  onChange={(e) => setConfigForm({ ...configForm, prometheus_url: e.target.value })}
                  placeholder="http://127.0.0.1:9090"
                  className="w-full px-3 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                />
                <span className="text-[10px] text-muted-foreground block">
                  Cung cấp API <code>/api/v1/rules</code> để đọc trạng thái cảnh báo thời gian thực.
                </span>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Alertmanager Server URL</label>
                <input
                  type="text"
                  required
                  value={configForm.alertmanager_url}
                  onChange={(e) => setConfigForm({ ...configForm, alertmanager_url: e.target.value })}
                  placeholder="http://127.0.0.1:9093"
                  className="w-full px-3 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                />
                <span className="text-[10px] text-muted-foreground block">
                  Quản lý việc gửi tin, khoảng lặng silences và deduplication.
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setConfigModalOpen(false)}
                  className="px-3 py-1.5 text-xs border border-border rounded hover:bg-muted/50 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={savingConfig}
                  className="px-3 py-1.5 text-xs bg-primary text-primary-foreground font-medium rounded hover:opacity-90 cursor-pointer flex items-center gap-1"
                >
                  {savingConfig && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Lưu cấu hình</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Silence Modal */}
      {silenceModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-lg max-w-md w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <span className="text-sm font-semibold text-foreground">
                Tạo khoảng lặng (Silence) cho {targetAlertName}
              </span>
              <button
                type="button"
                onClick={() => setSilenceModalOpen(false)}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSilence} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Thời gian tắt chuông</label>
                <select
                  value={silenceDurationHours}
                  onChange={(e) => setSilenceDurationHours(Number(e.target.value))}
                  className="w-full px-3 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                >
                  <option value={1}>1 giờ</option>
                  <option value={2}>2 giờ</option>
                  <option value={4}>4 giờ</option>
                  <option value={8}>8 giờ</option>
                  <option value={24}>24 giờ (1 ngày)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Lý do tắt chuông</label>
                <input
                  type="text"
                  required
                  value={silenceComment}
                  onChange={(e) => setSilenceComment(e.target.value)}
                  placeholder="Ví dụ: Đang triển khai bảo trì cụm Gateway..."
                  className="w-full px-3 py-1.5 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSilenceModalOpen(false)}
                  className="px-3 py-1.5 text-xs border border-border rounded hover:bg-muted/50 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={creatingSilence}
                  className="px-3 py-1.5 text-xs bg-primary text-primary-foreground font-medium rounded hover:opacity-90 cursor-pointer flex items-center gap-1"
                >
                  {creatingSilence && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Xác nhận Tắt chuông</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
