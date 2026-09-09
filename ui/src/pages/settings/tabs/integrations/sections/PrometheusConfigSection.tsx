import React, { useState } from 'react';
import { Database, Zap, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { integrationsApi } from '../../../../../lib/api';

export interface PrometheusConfigSectionProps {
  url: string;
  job: string;
  onUrlChange: (url: string) => void;
  onJobChange: (job: string) => void;
}

export function PrometheusConfigSection({
  url,
  job,
  onUrlChange,
  onJobChange,
}: PrometheusConfigSectionProps) {
  const [testStatus, setTestStatus] = useState<{
    tested: boolean;
    loading: boolean;
    success?: boolean;
    message?: string;
    latency?: number;
  }>({ tested: false, loading: false });

  const handleTestConnection = async () => {
    setTestStatus({ tested: false, loading: true });
    try {
      const res = await integrationsApi.testPrometheus(url);
      setTestStatus({
        tested: true,
        loading: false,
        success: res.success,
        message: res.message,
        latency: res.latency_ms,
      });
    } catch (err: any) {
      setTestStatus({
        tested: true,
        loading: false,
        success: false,
        message: err.message || 'Không thể kết nối tới Prometheus URL.',
      });
    }
  };

  return (
    <div className="bg-card border border-border p-5 shadow-xs h-full flex flex-col justify-between">
      <div>
        <div className="flex items-center gap-2 text-foreground font-semibold text-sm mb-1">
          <Database className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
          <span>Cấu hình kết nối Prometheus Server</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Tích hợp máy chủ Prometheus tập trung hoặc VictoriaMetrics để lưu trữ dữ liệu lâu dài.
        </p>

        <div className="mt-5 space-y-4 text-xs">
          <div>
            <label className="block text-muted-foreground mb-1 text-[11px] font-medium">
              Prometheus URL *
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => onUrlChange(e.target.value)}
              placeholder=""
              className="w-full bg-background border border-input px-3 py-1.5 text-foreground focus:outline-none focus:border-cyan-500 font-mono text-xs"
            />
          </div>

          <div>
            <label className="block text-muted-foreground mb-1 text-[11px] font-medium">
              Scraping Job Name
            </label>
            <input
              type="text"
              value={job}
              onChange={(e) => onJobChange(e.target.value)}
              placeholder=""
              className="w-full bg-background border border-input px-3 py-1.5 text-foreground focus:outline-none focus:border-cyan-500 font-mono text-xs"
            />
          </div>

          {/* Test Connection Button & Status */}
          <div className="pt-1 space-y-2.5">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testStatus.loading || !url.trim()}
              className="px-3 py-1.5 bg-cyan-50 hover:bg-cyan-100 dark:bg-muted dark:hover:bg-muted/80 border border-cyan-400 dark:border-cyan-500/40 text-cyan-800 dark:text-cyan-300 text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
            >
              {testStatus.loading ? (
                <>
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  <span>Đang kiểm tra...</span>
                </>
              ) : (
                <>
                  <Zap className="w-3 h-3" />
                  <span>Test Connection</span>
                </>
              )}
            </button>

            {testStatus.tested && (
              <div
                className={`text-xs p-2.5 border flex items-start gap-2 ${testStatus.success
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-500/50 text-emerald-700 dark:text-emerald-400'
                  : 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-500/50 text-rose-700 dark:text-rose-400'
                  }`}
              >
                {testStatus.success ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                )}
                <div className="space-y-0.5">
                  <div className="text-[11px] leading-relaxed break-all font-mono">
                    {testStatus.message}
                  </div>
                  {testStatus.latency !== undefined && (
                    <div className="text-[10px] opacity-80">
                      Độ trễ: <span className="font-mono font-semibold">{testStatus.latency}ms</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
