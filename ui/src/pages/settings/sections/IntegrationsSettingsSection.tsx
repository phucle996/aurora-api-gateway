import React, { useState, useEffect } from 'react';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  Server,
  Database,
  Radio,
  RefreshCw,
  Zap,
} from 'lucide-react';
import { integrationsApi } from '../../../lib/api';

export function IntegrationsSettingsSection() {
  const [mode, setMode] = useState<'standalone' | 'prometheus' | 'disabled'>('standalone');
  const [prometheusUrl, setPrometheusUrl] = useState('http://127.0.0.1:9090');
  const [prometheusJob, setPrometheusJob] = useState('aurora-waf-nodes');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [testStatus, setTestStatus] = useState<{
    tested: boolean;
    loading: boolean;
    success?: boolean;
    message?: string;
    latency?: number;
  }>({ tested: false, loading: false });

  useEffect(() => {
    async function loadConfig() {
      setIsLoading(true);
      try {
        const data = await integrationsApi.getMetricsConfig();
        if (data) {
          setMode(data.mode || 'standalone');
          setPrometheusUrl(data.prometheus_url || 'http://127.0.0.1:9090');
          setPrometheusJob(data.prometheus_job || 'aurora-waf-nodes');
        }
      } catch (err) {
        console.error('Failed to load metrics integration config:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadConfig();
  }, []);

  const handleTestConnection = async () => {
    setTestStatus({ tested: false, loading: true });
    try {
      const res = await integrationsApi.testPrometheus(prometheusUrl);
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

  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      await integrationsApi.updateMetricsConfig({
        mode,
        prometheus_url: prometheusUrl,
        prometheus_job: prometheusJob,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error('Lỗi lưu cấu hình:', err);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 bg-[#0B1320] border border-[#152030] font-mono text-xs text-slate-400 flex items-center justify-center gap-2">
        <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
        <span>Đang tải cấu hình tích hợp...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Title & Description */}
      <div className="bg-[#0B1320] border border-[#152030] p-5">
        <div className="flex items-center gap-2 text-white font-semibold text-sm mb-1">
          <Activity className="w-4 h-4 text-emerald-400" />
          <span>Metrics & Telemetry Provider</span>
        </div>
        <p className="text-xs text-slate-400 font-mono leading-relaxed">
          Linh hoạt chuyển đổi nguồn thu thập số liệu giám sát (CPU, RAM, RPS, Connections) giữa môi trường Lab thử nghiệm và Production quy mô lớn.
        </p>

        {/* 3 Radio Options */}
        <div className="mt-5 space-y-3 font-mono text-xs">
          {/* Option 1: Standalone (Lab / Dev) */}
          <label
            onClick={() => setMode('standalone')}
            className={`block p-4 border transition-colors cursor-pointer ${
              mode === 'standalone'
                ? 'bg-emerald-950/20 border-emerald-500/60'
                : 'bg-[#080E18] border-[#1C293D] hover:border-slate-600'
            }`}
          >
            <div className="flex items-start gap-3">
              <input
                type="radio"
                name="metrics_mode"
                checked={mode === 'standalone'}
                onChange={() => setMode('standalone')}
                className="mt-0.5 text-emerald-500 focus:ring-0 cursor-pointer"
              />
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white">Chế độ 1: Standalone / In-Memory Ring Buffer</span>
                  <span className="px-1.5 py-0.2 bg-emerald-900/60 border border-emerald-500/40 text-emerald-400 text-[10px]">
                    Lab / Dev / Thử nghiệm
                  </span>
                </div>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Tự cấp tự túc hoàn toàn, không phụ thuộc vào hạ tầng bên ngoài. Control Plane tự quản lý bộ nhớ đệm (Ring Buffer) trong RAM để vẽ biểu đồ Timeline 60 phút gần nhất, không gây tải cho SQLite.
                </p>
              </div>
            </div>
          </label>

          {/* Option 2: External Prometheus (Production) */}
          <label
            onClick={() => setMode('prometheus')}
            className={`block p-4 border transition-colors cursor-pointer ${
              mode === 'prometheus'
                ? 'bg-cyan-950/20 border-cyan-500/60'
                : 'bg-[#080E18] border-[#1C293D] hover:border-slate-600'
            }`}
          >
            <div className="flex items-start gap-3">
              <input
                type="radio"
                name="metrics_mode"
                checked={mode === 'prometheus'}
                onChange={() => setMode('prometheus')}
                className="mt-0.5 text-cyan-500 focus:ring-0 cursor-pointer"
              />
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white">Chế độ 2: External Prometheus / VictoriaMetrics</span>
                  <span className="px-1.5 py-0.2 bg-cyan-900/60 border border-cyan-500/40 text-cyan-400 text-[10px]">
                    Production Enterprise
                  </span>
                </div>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Tích hợp trực tiếp với cụm máy chủ Prometheus có sẵn của doanh nghiệp. Hỗ trợ truy vấn lịch sử dài hạn, độ phân giải cao và lưu trữ tập trung.
                </p>
              </div>
            </div>
          </label>

          {/* Option 3: Disabled */}
          <label
            onClick={() => setMode('disabled')}
            className={`block p-4 border transition-colors cursor-pointer ${
              mode === 'disabled'
                ? 'bg-rose-950/20 border-rose-500/60'
                : 'bg-[#080E18] border-[#1C293D] hover:border-slate-600'
            }`}
          >
            <div className="flex items-start gap-3">
              <input
                type="radio"
                name="metrics_mode"
                checked={mode === 'disabled'}
                onChange={() => setMode('disabled')}
                className="mt-0.5 text-rose-500 focus:ring-0 cursor-pointer"
              />
              <div className="space-y-1">
                <div className="font-bold text-white">Chế độ 3: Tắt thu thập Metrics (Disabled)</div>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Tắt hoàn toàn việc thu thập và hiển thị biểu đồ telemetry. Các trang gọi metrics sẽ hiển thị thông báo Service Unavailable.
                </p>
              </div>
            </div>
          </label>
        </div>

        {/* Prometheus Config Fields (Hiện khi chọn Prometheus) */}
        {mode === 'prometheus' && (
          <div className="mt-5 p-4 bg-[#080E18] border border-cyan-500/30 space-y-4 font-mono text-xs">
            <div className="text-cyan-400 font-semibold flex items-center gap-2">
              <Database className="w-3.5 h-3.5" />
              <span>Cấu hình kết nối Prometheus Server</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-400 mb-1 text-[11px]">Prometheus URL *</label>
                <input
                  type="text"
                  value={prometheusUrl}
                  onChange={(e) => setPrometheusUrl(e.target.value)}
                  placeholder="http://127.0.0.1:9090"
                  className="w-full bg-[#04070D] border border-[#1C293D] px-3 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono text-xs"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 text-[11px]">Scraping Job Name</label>
                <input
                  type="text"
                  value={prometheusJob}
                  onChange={(e) => setPrometheusJob(e.target.value)}
                  placeholder="aurora-waf-nodes"
                  className="w-full bg-[#04070D] border border-[#1C293D] px-3 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono text-xs"
                />
              </div>
            </div>

            {/* Test Connection Button & Status */}
            <div className="pt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testStatus.loading}
                className="px-3 py-1.5 bg-[#152030] hover:bg-[#1C293D] border border-cyan-500/40 text-cyan-300 font-mono text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {testStatus.loading ? (
                  <>
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    <span>Đang kiểm tra kết nối...</span>
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
                  className={`text-xs px-2.5 py-1 border flex items-center gap-1.5 ${
                    testStatus.success
                      ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-400'
                      : 'bg-rose-950/40 border-rose-500/50 text-rose-400'
                  }`}
                >
                  {testStatus.success ? (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span>{testStatus.message}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Save Button & Feedback */}
        <div className="mt-6 pt-4 border-t border-[#152030] flex items-center justify-between">
          <div className="text-xs font-mono">
            {saveSuccess && (
              <span className="text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 inline" />
                <span>Đã lưu cấu hình thành công!</span>
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold font-mono text-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            {isSaving ? 'Đang lưu...' : 'Lưu cấu hình'}
          </button>
        </div>
      </div>
    </div>
  );
}
