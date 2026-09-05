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
  const [mode, setMode] = useState<'standalone' | 'prometheus' | 'disabled'>('disabled');
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
    <div className={`space-y-6 ${mode === 'prometheus' ? 'max-w-5xl' : 'max-w-2xl'} transition-all duration-200`}>
      {/* Title & Description */}
      <div className="bg-[#0B1320] border border-[#152030] p-5">
        <div className="flex items-center gap-2 text-white font-semibold text-sm mb-1">
          <Activity className="w-4 h-4 text-emerald-400" />
          <span>Metrics & Telemetry Provider</span>
        </div>
        <p className="text-xs text-slate-400 font-mono leading-relaxed">
          Cấu hình nguồn thu thập telemetry (CPU, RAM, RPS, Connections).
        </p>

        {/* Main Content Area: 2 columns when mode === 'prometheus', else 1 column */}
        <div className={`mt-5 ${mode === 'prometheus' ? 'grid grid-cols-1 lg:grid-cols-12 gap-5 items-start' : 'space-y-2.5'}`}>
          {/* Left Column: 3 Radio Options */}
          <div className={`${mode === 'prometheus' ? 'lg:col-span-6' : ''} space-y-2.5 font-mono text-xs`}>
            {/* Option 1: Standalone */}
            <label
              onClick={() => setMode('standalone')}
              className={`block p-3.5 border transition-colors cursor-pointer ${
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
                    <span className="font-bold text-white">Chế độ 1: Standalone / Ring Buffer</span>
                    <span className="px-1.5 py-0.2 bg-emerald-900/60 border border-emerald-500/40 text-emerald-400 text-[10px]">
                      Lab / Dev
                    </span>
                  </div>
                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    Lưu RAM 60 phút gần nhất, tự cấp tự túc không cần server ngoài.
                  </p>
                </div>
              </div>
            </label>

            {/* Option 2: Prometheus */}
            <label
              onClick={() => setMode('prometheus')}
              className={`block p-3.5 border transition-colors cursor-pointer ${
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
                    <span className="font-bold text-white">Chế độ 2: Prometheus / VictoriaMetrics</span>
                    <span className="px-1.5 py-0.2 bg-cyan-900/60 border border-cyan-500/40 text-cyan-400 text-[10px]">
                      Production
                    </span>
                  </div>
                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    Tích hợp máy chủ Prometheus tập trung để lưu trữ dài hạn.
                  </p>
                </div>
              </div>
            </label>

            {/* Option 3: Disabled */}
            <label
              onClick={() => setMode('disabled')}
              className={`block p-3.5 border transition-colors cursor-pointer ${
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
                  <div className="font-bold text-white">Chế độ 3: Tắt thu thập (Disabled)</div>
                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    Vô hiệu hoá toàn bộ thu thập telemetry và biểu đồ giám sát.
                  </p>
                </div>
              </div>
            </label>
          </div>

          {/* Right Column: Prometheus Config (Chỉ hiện khi chọn Chế độ 2) */}
          {mode === 'prometheus' && (
            <div className="lg:col-span-6 p-4 bg-[#080E18] border border-cyan-500/40 space-y-3.5 font-mono text-xs">
              <div className="text-cyan-400 font-semibold flex items-center gap-2 border-b border-[#1C293D] pb-2">
                <Database className="w-3.5 h-3.5" />
                <span>Cấu hình kết nối Prometheus Server</span>
              </div>

              <div className="space-y-3">
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
              <div className="pt-1 space-y-2.5">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testStatus.loading}
                  className="px-3 py-1.5 bg-[#152030] hover:bg-[#1C293D] border border-cyan-500/40 text-cyan-300 font-mono text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
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
                    className={`text-xs p-2.5 border flex items-start gap-2 ${
                      testStatus.success
                        ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-400'
                        : 'bg-rose-950/40 border-rose-500/50 text-rose-400'
                    }`}
                  >
                    {testStatus.success ? (
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    )}
                    <span className="text-[11px] leading-relaxed break-all">{testStatus.message}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

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
