import React, { useState, useEffect } from 'react';
import { RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { integrationsApi } from '../../../../lib/api';
import { TelemetryModeSection } from './sections/TelemetryModeSection';
import { PrometheusConfigSection } from './sections/PrometheusConfigSection';

export function IntegrationsTab() {
  const [mode, setMode] = useState<'standalone' | 'prometheus' | 'disabled'>('disabled');
  const [prometheusUrl, setPrometheusUrl] = useState('');
  const [prometheusJob, setPrometheusJob] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadConfig = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await integrationsApi.getMetricsConfig();
      if (data) {
        if (data.mode) {
          setMode(data.mode);
        }
        setPrometheusUrl(data.prometheus_url ?? '');
        setPrometheusJob(data.prometheus_job ?? '');
      }
    } catch (err: any) {
      console.error('Failed to load metrics integration config:', err);
      setLoadError(err?.message || 'Không thể tải cấu hình tích hợp metrics từ máy chủ.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    setSaveError(null);
    try {
      await integrationsApi.updateMetricsConfig({
        mode,
        prometheus_url: prometheusUrl,
        prometheus_job: prometheusJob,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      console.error('Lỗi lưu cấu hình:', err);
      setSaveError(err?.message || 'Lỗi lưu cấu hình tích hợp metrics');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 bg-card border border-border text-xs text-muted-foreground flex items-center justify-center gap-2 shadow-xs font-sans">
        <RefreshCw className="w-4 h-4 animate-spin text-primary" />
        <span>Đang tải cấu hình tích hợp...</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-6 bg-card border border-destructive/40 text-xs flex flex-col items-center justify-center gap-3 shadow-xs font-sans">
        <div className="flex items-center gap-2 text-destructive font-medium">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{loadError}</span>
        </div>
        <button
          type="button"
          onClick={loadConfig}
          className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 text-xs transition-colors cursor-pointer"
        >
          Thử lại
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full font-sans">
      <div className={`grid grid-cols-1 ${mode === 'prometheus' ? 'lg:grid-cols-12 gap-5 items-stretch' : 'gap-5'}`}>
        <div className={mode === 'prometheus' ? 'lg:col-span-6' : ''}>
          <TelemetryModeSection mode={mode} onChangeMode={setMode} />
        </div>
        {mode === 'prometheus' && (
          <div className="lg:col-span-6">
            <PrometheusConfigSection
              url={prometheusUrl}
              job={prometheusJob}
              onUrlChange={setPrometheusUrl}
              onJobChange={setPrometheusJob}
            />
          </div>
        )}
      </div>

      {/* Save Action Bar */}
      <div className="bg-card border border-border p-4 shadow-xs flex items-center justify-between">
        <div className="text-xs">
          {saveSuccess && (
            <span className="text-primary flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="w-4 h-4 inline text-emerald-500" />
              <span>Đã lưu cấu hình tích hợp thành công!</span>
            </span>
          )}
          {saveError && (
            <span className="text-destructive flex items-center gap-1.5 font-medium">
              <AlertTriangle className="w-4 h-4 inline" />
              <span>{saveError}</span>
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="px-5 py-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs transition-colors cursor-pointer disabled:opacity-50"
        >
          {isSaving ? 'Đang lưu...' : 'Lưu cấu hình'}
        </button>
      </div>
    </div>
  );
}
