import React, { useState, useEffect } from 'react';
import { Bell, AlertCircle, CheckCircle2, X, Loader2 } from 'lucide-react';
import {
  alertsApi,
  type AlertmanagerOverview,
  type PrometheusRuleItem,
  type AlertmanagerSilenceItem,
} from '../../../../lib/api';
import { AlertmanagerIntegrationSection } from './sections/AlertmanagerIntegrationSection';

export function NotificationsTab() {
  const [loading, setLoading] = useState(true);
  const [errorBanner, setErrorBanner] = useState('');
  const [successBanner, setSuccessBanner] = useState('');

  // Alertmanager & Prometheus states
  const [amOverview, setAmOverview] = useState<AlertmanagerOverview | null>(null);
  const [amRules, setAmRules] = useState<PrometheusRuleItem[]>([]);
  const [amSilences, setAmSilences] = useState<AlertmanagerSilenceItem[]>([]);
  const [amLoading, setAmLoading] = useState(false);

  const loadAlertmanagerData = async () => {
    try {
      setAmLoading(true);
      const [ov, rRes, sRes] = await Promise.all([
        alertsApi.getOverview().catch(() => null),
        alertsApi.getLiveRules().catch(() => ({ rules: [], total: 0 })),
        alertsApi.getSilences().catch(() => ({ silences: [], total: 0 })),
      ]);
      setAmOverview(ov);
      setAmRules(rRes.rules || []);
      setAmSilences(sRes.silences || []);
      setErrorBanner('');
    } catch (err: any) {
      setErrorBanner(err?.message || 'Không thể tải dữ liệu từ Alertmanager & Prometheus');
    } finally {
      setAmLoading(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAlertmanagerData();
  }, []);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center gap-2 text-muted-foreground text-xs bg-card border border-border font-sans">
        <Loader2 className="w-4 h-4 animate-spin text-primary" />
        <span>Đang kết nối tới Alertmanager & Prometheus...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full font-sans">
      <div className="p-5 bg-card border border-border text-xs space-y-5 shadow-xs">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">
              Alertmanager & Prometheus Observability Engine
            </span>
          </div>
          <span className="text-[11px] font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">
            {amRules.length} metric rule(s) active
          </span>
        </div>

        {/* Banners */}
        {errorBanner && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-xs rounded flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorBanner('')}
              className="text-destructive/80 hover:text-destructive cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {successBanner && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs rounded flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setSuccessBanner('')}
              className="hover:opacity-80 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Alertmanager & Prometheus Integration Engine */}
        <AlertmanagerIntegrationSection
          overview={amOverview}
          rules={amRules}
          silences={amSilences}
          loading={amLoading}
          onRefresh={loadAlertmanagerData}
          onConfigUpdated={() => {
            setSuccessBanner('Đã cập nhật cấu hình kết nối Alertmanager');
            setTimeout(() => setSuccessBanner(''), 3000);
            loadAlertmanagerData();
          }}
        />
      </div>
    </div>
  );
}
