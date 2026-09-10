import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Server,
  Shield,
  Key,
  Lock,
  Zap,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Cpu,
  Clock,
  Radio,
  FileCode,
} from 'lucide-react';
import {
  analyticsApi,
  ConnectionConfig,
  RuntimeMetadata,
  TestConnectionResult,
} from '../../../lib/api/analytics';

export function ConnectionsTab() {
  const [extensionEnabled, setExtensionEnabled] = useState<boolean>(true);
  const [config, setConfig] = useState<ConnectionConfig>({
    mode: 'prometheus',
    prometheus_url: 'http://127.0.0.1:9090',
    prometheus_job: 'aurora-waf',
    auth_type: 'none',
    auth_token: '',
    auth_username: '',
    auth_password: '',
    custom_headers: {},
    tls_enabled: false,
    insecure_skip: false,
    ca_cert_pem: '',
    client_cert_pem: '',
    client_key_pem: '',
  });

  const [metadata, setMetadata] = useState<RuntimeMetadata | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [testStatus, setTestStatus] = useState<TestConnectionResult | null>(null);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Custom headers state helper
  const [headerKey, setHeaderKey] = useState<string>('X-Scope-OrgID');
  const [headerVal, setHeaderVal] = useState<string>('');

  useEffect(() => {
    setIsLoading(true);
    analyticsApi
      .getConnection()
      .then((res) => {
        setExtensionEnabled(res.extension_enabled);
        if (res.config) {
          setConfig((prev) => ({
            ...prev,
            ...res.config,
            auth_type: res.config.auth_type || 'none',
          }));
        }
        if (res.metadata) {
          setMetadata(res.metadata);
        }
      })
      .catch((err) => {
        console.error('Failed to load connection status', err);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestStatus(null);
    try {
      const res = await analyticsApi.testConnection(config);
      setTestStatus(res);
      if (res.metadata) {
        setMetadata(res.metadata);
      }
    } catch (err: any) {
      setTestStatus({
        success: false,
        message: err?.data?.error || err?.message || 'Không thể kết nối máy chủ Prometheus',
        latency_ms: 0,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveConfig = async () => {
    setIsSaving(true);
    setSaveMessage(null);
    try {
      await analyticsApi.updateConnection(config);
      setSaveMessage('Lưu cấu hình kết nối thành công!');
      setTimeout(() => setSaveMessage(null), 4000);
      handleTestConnection();
    } catch (err: any) {
      setSaveMessage('Lỗi: ' + (err?.data?.error || err?.message || 'Không thể lưu'));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 text-center text-xs text-muted-foreground animate-pulse">
        Đang tải thông tin kết nối và runtime telemetry...
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1200px]">
      {/* 1. Extension Status Banner */}
      {!extensionEnabled ? (
        <div className="p-4 bg-amber-50/10 border border-amber-500/30 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-amber-500">
                Extension Prometheus Metrics & Exporter chưa được kích hoạt
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Các Aurora Node hiện chưa mở endpoint scrape <code className="font-mono">:9145/metrics</code>.
                Hãy bật extension để node bắt đầu trích xuất số liệu NGINX và WAF.
              </p>
            </div>
          </div>
          <Link
            to="/extensions"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 border border-amber-500/40 text-amber-500 hover:bg-amber-500/20 text-xs font-semibold shrink-0 transition-colors"
          >
            <span>Kích hoạt Extension</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
      ) : (
        <div className="p-3 bg-emerald-50/10 border border-emerald-500/20 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-emerald-500">
            <CheckCircle2 className="w-4 h-4" />
            <span className="font-semibold">
              Extension 'prometheus' đang hoạt động trên cổng :9145 của các Node
            </span>
          </div>
          <Link to="/extensions" className="text-muted-foreground hover:text-foreground text-[11px] underline">
            Quản lý Extension
          </Link>
        </div>
      )}

      {/* 2. Runtime Metadata Panel (Hiển thị khi có metadata) */}
      {metadata && metadata.status === 'connected' && (
        <div className="bg-card border border-border p-4 shadow-xs">
          <div className="flex items-center justify-between border-b border-border pb-2 mb-3">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-emerald-500" />
              <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                Runtime Telemetry Metadata (Đang hoạt động)
              </span>
            </div>
            <span className="text-[11px] font-mono text-muted-foreground">
              Kiểm tra lần cuối:{' '}
              {new Date((metadata.last_checked_at || 0) * 1000).toLocaleTimeString()}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-muted/20 border border-border">
              <div className="flex items-center justify-between text-muted-foreground text-xs mb-1">
                <span>Hạ tầng / Engine</span>
                <Server className="w-3.5 h-3.5 text-primary" />
              </div>
              <div className="text-sm font-bold text-foreground">
                {metadata.engine} <span className="text-xs font-normal text-muted-foreground">({metadata.version})</span>
              </div>
            </div>

            <div className="p-3 bg-muted/20 border border-border">
              <div className="flex items-center justify-between text-muted-foreground text-xs mb-1">
                <span>Độ trễ Roundtrip</span>
                <Clock className="w-3.5 h-3.5 text-cyan-500" />
              </div>
              <div className="text-sm font-bold font-mono text-cyan-500">
                {metadata.latency_ms} ms
              </div>
            </div>

            <div className="p-3 bg-muted/20 border border-border">
              <div className="flex items-center justify-between text-muted-foreground text-xs mb-1">
                <span>Số Node Targets UP</span>
                <Cpu className="w-3.5 h-3.5 text-emerald-500" />
              </div>
              <div className="text-sm font-bold font-mono text-emerald-500">
                {metadata.active_targets} / {metadata.total_targets || metadata.active_targets} Active
              </div>
            </div>

            <div className="p-3 bg-muted/20 border border-border">
              <div className="flex items-center justify-between text-muted-foreground text-xs mb-1">
                <span>Trạng thái Scrape</span>
                <Radio className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
              </div>
              <div className="text-sm font-bold text-emerald-500 uppercase">ONLINE</div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Main Connection Configuration Form */}
      <div className="bg-card border border-border p-5 shadow-xs space-y-5">
        <div>
          <h2 className="text-sm font-bold text-foreground">Cấu hình Kết nối Hạ tầng Telemetry</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Thiết lập endpoint máy chủ Prometheus / VictoriaMetrics và các cơ chế bảo mật kết nối doanh nghiệp (TLS / mTLS / Token).
          </p>
        </div>

        {/* Mode Selector */}
        <div className="flex items-center gap-4 text-xs">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="conn_mode"
              checked={config.mode === 'prometheus'}
              onChange={() => setConfig({ ...config, mode: 'prometheus' })}
              className="text-primary focus:ring-0 cursor-pointer"
            />
            <span className="font-semibold text-foreground">Kích hoạt Prometheus / VictoriaMetrics</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="conn_mode"
              checked={config.mode === 'disabled'}
              onChange={() => setConfig({ ...config, mode: 'disabled' })}
              className="text-primary focus:ring-0 cursor-pointer"
            />
            <span className="text-muted-foreground">Tắt thu thập (Disabled)</span>
          </label>
        </div>

        {config.mode === 'prometheus' && (
          <div className="space-y-4 pt-2 border-t border-border">
            {/* Target URL & Job Name */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 space-y-1.5 text-xs">
                <label className="font-medium text-foreground">Prometheus / VictoriaMetrics Query URL</label>
                <input
                  type="text"
                  value={config.prometheus_url}
                  onChange={(e) => setConfig({ ...config, prometheus_url: e.target.value })}
                  placeholder="https://prometheus.internal:9090"
                  className="w-full bg-muted/20 border border-border px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:border-primary"
                />
              </div>
              <div className="space-y-1.5 text-xs">
                <label className="font-medium text-foreground">Prometheus Job Name</label>
                <input
                  type="text"
                  value={config.prometheus_job}
                  onChange={(e) => setConfig({ ...config, prometheus_job: e.target.value })}
                  placeholder="aurora-waf"
                  className="w-full bg-muted/20 border border-border px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            {/* Authentication Options */}
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <Key className="w-3.5 h-3.5 text-primary" />
                <span>Xác thực Truy cập (Authentication)</span>
              </div>

              <div className="flex flex-wrap gap-3 text-xs">
                {(['none', 'bearer', 'basic', 'headers'] as const).map((type) => (
                  <label key={type} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="auth_type"
                      checked={config.auth_type === type}
                      onChange={() => setConfig({ ...config, auth_type: type })}
                      className="text-primary focus:ring-0 cursor-pointer"
                    />
                    <span className="capitalize">{type === 'none' ? 'Không (None)' : type}</span>
                  </label>
                ))}
              </div>

              {config.auth_type === 'bearer' && (
                <div className="space-y-1 text-xs pt-1">
                  <label className="font-medium text-muted-foreground">Bearer Token</label>
                  <input
                    type="password"
                    value={config.auth_token || ''}
                    onChange={(e) => setConfig({ ...config, auth_token: e.target.value })}
                    placeholder="eyJhbGciOi..."
                    className="w-full bg-muted/20 border border-border px-3 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:border-primary"
                  />
                </div>
              )}

              {config.auth_type === 'basic' && (
                <div className="grid grid-cols-2 gap-3 text-xs pt-1">
                  <div className="space-y-1">
                    <label className="font-medium text-muted-foreground">Username</label>
                    <input
                      type="text"
                      value={config.auth_username || ''}
                      onChange={(e) => setConfig({ ...config, auth_username: e.target.value })}
                      placeholder="admin"
                      className="w-full bg-muted/20 border border-border px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-medium text-muted-foreground">Password</label>
                    <input
                      type="password"
                      value={config.auth_password || ''}
                      onChange={(e) => setConfig({ ...config, auth_password: e.target.value })}
                      placeholder="••••••••"
                      className="w-full bg-muted/20 border border-border px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>
              )}

              {config.auth_type === 'headers' && (
                <div className="space-y-2 text-xs pt-1">
                  <label className="font-medium text-muted-foreground">
                    Custom Headers (Thường dùng cho Grafana Mimir / Cortex Multi-tenancy)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={headerKey}
                      onChange={(e) => setHeaderKey(e.target.value)}
                      placeholder="Tên Header (vd: X-Scope-OrgID)"
                      className="flex-1 bg-muted/20 border border-border px-2.5 py-1.5 font-mono text-xs text-foreground focus:outline-none"
                    />
                    <input
                      type="text"
                      value={headerVal}
                      onChange={(e) => setHeaderVal(e.target.value)}
                      placeholder="Giá trị (vd: tenant-aurora)"
                      className="flex-1 bg-muted/20 border border-border px-2.5 py-1.5 font-mono text-xs text-foreground focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (headerKey && headerVal) {
                          setConfig({
                            ...config,
                            custom_headers: {
                              ...(config.custom_headers || {}),
                              [headerKey]: headerVal,
                            },
                          });
                          setHeaderVal('');
                        }
                      }}
                      className="px-3 py-1 bg-muted hover:bg-muted/70 text-foreground border border-border"
                    >
                      Thêm Header
                    </button>
                  </div>
                  {config.custom_headers && Object.keys(config.custom_headers).length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {Object.entries(config.custom_headers).map(([k, v]) => (
                        <span
                          key={k}
                          className="px-2 py-0.5 bg-muted border border-border text-[11px] font-mono flex items-center gap-1.5"
                        >
                          <span>
                            {k}: {v}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const updated = { ...(config.custom_headers || {}) };
                              delete updated[k];
                              setConfig({ ...config, custom_headers: updated });
                            }}
                            className="text-red-400 hover:text-red-500 font-bold ml-1"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* TLS & mTLS Enterprise Security Section */}
            <div className="space-y-3 pt-2 border-t border-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                  <Lock className="w-3.5 h-3.5 text-primary" />
                  <span>Bảo mật Doanh nghiệp: TLS & Mutual TLS (mTLS)</span>
                </div>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.tls_enabled || false}
                    onChange={(e) => setConfig({ ...config, tls_enabled: e.target.checked })}
                    className="text-primary rounded-xs cursor-pointer"
                  />
                  <span>Bật xác thực TLS</span>
                </label>
              </div>

              {config.tls_enabled && (
                <div className="space-y-3 p-3 bg-muted/20 border border-border text-xs">
                  <label className="flex items-center gap-2 cursor-pointer text-muted-foreground hover:text-foreground">
                    <input
                      type="checkbox"
                      checked={config.insecure_skip || false}
                      onChange={(e) => setConfig({ ...config, insecure_skip: e.target.checked })}
                      className="text-primary rounded-xs cursor-pointer"
                    />
                    <span>Bỏ qua kiểm tra chứng chỉ máy chủ (Insecure Skip Verify - Dùng cho Lab/Self-Signed)</span>
                  </label>

                  <div className="space-y-1">
                    <label className="font-medium text-foreground">Custom Root CA Certificate (PEM)</label>
                    <textarea
                      rows={3}
                      value={config.ca_cert_pem || ''}
                      onChange={(e) => setConfig({ ...config, ca_cert_pem: e.target.value })}
                      placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                      className="w-full bg-card border border-border p-2 font-mono text-[11px] text-foreground focus:outline-none focus:border-primary resize-y"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="font-medium text-foreground">Client Certificate (mTLS PEM)</label>
                      <textarea
                        rows={3}
                        value={config.client_cert_pem || ''}
                        onChange={(e) => setConfig({ ...config, client_cert_pem: e.target.value })}
                        placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                        className="w-full bg-card border border-border p-2 font-mono text-[11px] text-foreground focus:outline-none focus:border-primary resize-y"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-medium text-foreground">Client Private Key (mTLS PEM)</label>
                      <textarea
                        rows={3}
                        value={config.client_key_pem || ''}
                        onChange={(e) => setConfig({ ...config, client_key_pem: e.target.value })}
                        placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;...&#10;-----END RSA PRIVATE KEY-----"
                        className="w-full bg-card border border-border p-2 font-mono text-[11px] text-foreground focus:outline-none focus:border-primary resize-y"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Status Messages */}
        {testStatus && (
          <div
            className={`p-3 border text-xs flex items-center gap-2.5 ${
              testStatus.success
                ? 'bg-emerald-50/10 border-emerald-500/30 text-emerald-500'
                : 'bg-red-50/10 border-red-500/30 text-red-500'
            }`}
          >
            {testStatus.success ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <div>
              <div className="font-semibold">{testStatus.message}</div>
              {testStatus.latency_ms > 0 && (
                <div className="text-[11px] font-mono text-muted-foreground">
                  Độ trễ phản hồi: {testStatus.latency_ms} ms
                </div>
              )}
            </div>
          </div>
        )}

        {saveMessage && (
          <div className="p-3 bg-primary/10 border border-primary/30 text-primary text-xs font-semibold">
            {saveMessage}
          </div>
        )}

        {/* Form Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={isTesting}
            className="flex items-center gap-1.5 px-4 py-2 border border-border bg-card hover:bg-muted text-foreground text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin text-primary' : ''}`} />
            <span>{isTesting ? 'Đang kiểm tra...' : 'Kiểm tra Kết nối (Test Connection)'}</span>
          </button>

          <button
            type="button"
            onClick={handleSaveConfig}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-5 py-2 bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-bold transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
          >
            <span>{isSaving ? 'Đang lưu...' : 'Lưu Cấu Hình'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
