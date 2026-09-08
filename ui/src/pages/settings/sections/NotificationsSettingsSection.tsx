import React, { useState, useEffect } from 'react';
import {
  Bell,
  Mail,
  Send,
  MessageSquare,
  Bot,
  Globe,
  Radio,
  Check,
  CheckCircle2,
  AlertCircle,
  X,
  Loader2,
  Eye,
  EyeOff,
  ShieldAlert,
  Sliders,
  ExternalLink,
} from 'lucide-react';
import {
  notificationsApi,
  NotificationChannelItem,
  NotificationRuleItem,
  NotificationChannelId,
} from '../../../lib/api';

export function NotificationsSettingsSection() {
  const [loading, setLoading] = useState(true);
  const [channels, setChannels] = useState<NotificationChannelItem[]>([]);
  const [rules, setRules] = useState<NotificationRuleItem[]>([]);
  const [errorBanner, setErrorBanner] = useState('');
  const [successBanner, setSuccessBanner] = useState('');

  // Toggling state
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [togglingRuleId, setTogglingRuleId] = useState<string | null>(null);

  // Setup Modal state
  const [activeSetupChannel, setActiveSetupChannel] = useState<NotificationChannelItem | null>(null);
  const [setupConfig, setSetupConfig] = useState<Record<string, any>>({});
  const [savingConfig, setSavingConfig] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Test notification state
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; latency_ms?: number } | null>(null);

  // Fetch overview from backend
  const loadOverview = async () => {
    try {
      setLoading(true);
      setErrorBanner('');
      const data = await notificationsApi.getOverview();
      setChannels(data.channels || []);
      setRules(data.rules || []);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Không thể tải cấu hình thông báo từ máy chủ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  // Toggle Channel Active State
  const handleToggleChannel = async (channel: NotificationChannelItem) => {
    const nextEnabled = !channel.enabled;

    // Optimistic UI update
    setChannels((prev) =>
      prev.map((c) => (c.id === channel.id ? { ...c, enabled: nextEnabled } : c))
    );
    setTogglingId(channel.id);
    setErrorBanner('');

    try {
      await notificationsApi.updateChannel(channel.id, nextEnabled, channel.config_json);
      setSuccessBanner(`Đã ${nextEnabled ? 'bật' : 'tắt'} kênh thông báo ${channel.name}`);
      setTimeout(() => setSuccessBanner(''), 3000);
    } catch (err: any) {
      // Rollback on error
      setChannels((prev) =>
        prev.map((c) => (c.id === channel.id ? { ...c, enabled: channel.enabled } : c))
      );
      setErrorBanner(err?.message || 'Cập nhật trạng thái kênh thất bại');
    } finally {
      setTogglingId(null);
    }
  };

  // Toggle Alert Rule
  const handleToggleRule = async (rule: NotificationRuleItem) => {
    const nextEnabled = !rule.enabled;

    setRules((prev) =>
      prev.map((r) => (r.id === rule.id ? { ...r, enabled: nextEnabled } : r))
    );
    setTogglingRuleId(rule.id);
    setErrorBanner('');

    try {
      await notificationsApi.updateRule(rule.id, nextEnabled);
      setSuccessBanner(`Đã ${nextEnabled ? 'kích hoạt' : 'tạm dừng'} quy tắc "${rule.name}"`);
      setTimeout(() => setSuccessBanner(''), 3000);
    } catch (err: any) {
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, enabled: rule.enabled } : r))
      );
      setErrorBanner(err?.message || 'Cập nhật quy tắc cảnh báo thất bại');
    } finally {
      setTogglingRuleId(null);
    }
  };

  // Open Channel Setup Modal
  const handleOpenSetup = (channel: NotificationChannelItem) => {
    let parsed: Record<string, any> = {};
    try {
      parsed = JSON.parse(channel.config_json || '{}');
    } catch {
      parsed = {};
    }
    setSetupConfig(parsed);
    setActiveSetupChannel(channel);
    setTestResult(null);
    setShowPassword(false);
  };

  // Save Channel Setup Config
  const handleSaveSetup = async () => {
    if (!activeSetupChannel) return;
    setSavingConfig(true);
    setErrorBanner('');

    try {
      const configStr = JSON.stringify(setupConfig);
      await notificationsApi.updateChannel(activeSetupChannel.id, activeSetupChannel.enabled, configStr);

      setChannels((prev) =>
        prev.map((c) =>
          c.id === activeSetupChannel.id
            ? { ...c, config_json: configStr }
            : c
        )
      );

      setSuccessBanner(`Đã lưu cấu hình cho ${activeSetupChannel.name}`);
      setTimeout(() => setSuccessBanner(''), 3000);
      setActiveSetupChannel(null);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Không thể lưu cấu hình kênh thông báo');
    } finally {
      setSavingConfig(false);
    }
  };

  // Send Test Notification
  const handleTestChannel = async (channelId: string) => {
    setTestingId(channelId);
    setTestResult(null);

    try {
      // First save current config if modal is open
      if (activeSetupChannel && activeSetupChannel.id === channelId) {
        const configStr = JSON.stringify(setupConfig);
        await notificationsApi.updateChannel(channelId, activeSetupChannel.enabled, configStr);
      }

      const res = await notificationsApi.testChannel(channelId);
      setTestResult(res);

      // Update channel test status in local state
      setChannels((prev) =>
        prev.map((c) =>
          c.id === channelId
            ? {
                ...c,
                last_test_status: res.success ? 'success' : 'failed',
                last_test_message: res.message,
                last_tested_at: new Date().toISOString(),
              }
            : c
        )
      );
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err?.message || 'Kiểm thử gửi thông báo thất bại',
      });
    } finally {
      setTestingId(null);
    }
  };

  const getChannelIcon = (id: NotificationChannelId) => {
    switch (id) {
      case 'email':
        return <Mail className="w-4 h-4 text-emerald-500" />;
      case 'slack':
        return <MessageSquare className="w-4 h-4 text-amber-500" />;
      case 'telegram':
        return <Send className="w-4 h-4 text-sky-500" />;
      case 'discord':
        return <Bot className="w-4 h-4 text-indigo-500" />;
      case 'webhook':
        return <Globe className="w-4 h-4 text-cyan-500" />;
      case 'pagerduty':
        return <Radio className="w-4 h-4 text-rose-500" />;
      default:
        return <Bell className="w-4 h-4 text-primary" />;
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical':
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/20">
            CRITICAL
          </span>
        );
      case 'high':
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            HIGH
          </span>
        );
      case 'medium':
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20">
            MEDIUM
          </span>
        );
      default:
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-muted text-muted-foreground border border-border">
            LOW
          </span>
        );
    }
  };

  const activeChannelsCount = channels.filter((c) => c.enabled).length;

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center gap-2 text-muted-foreground text-xs bg-card border border-border">
        <Loader2 className="w-4 h-4 animate-spin text-primary" />
        <span>Đang tải cấu hình kênh thông báo...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Notifications Management Box */}
      <div className="p-4 bg-card border border-border text-xs space-y-5 shadow-xs">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">
              Notifications & Multi-Channel Alert Routing
            </span>
          </div>
          <span className="text-[11px] font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">
            {activeChannelsCount} notification channel(s) active
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

        {/* 1. Multi-Channel Grid */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">
              Configured Alert Dispatch Channels
            </span>
            <span className="text-[11px] text-muted-foreground">
              Multiple channels can receive security notifications simultaneously
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {channels.map((channel) => (
              <div
                key={channel.id}
                className={`p-3.5 border rounded-lg transition-all flex flex-col justify-between space-y-3 ${
                  channel.enabled
                    ? 'border-primary/40 bg-primary/5 shadow-xs'
                    : 'border-border bg-background'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <label className="flex items-start gap-2.5 cursor-pointer flex-1">
                    <input
                      type="checkbox"
                      checked={channel.enabled}
                      disabled={togglingId === channel.id}
                      onChange={() => handleToggleChannel(channel)}
                      className="mt-0.5 h-4 w-4 rounded border-input text-primary focus:ring-ring cursor-pointer"
                    />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {getChannelIcon(channel.id)}
                        <span className="font-semibold text-foreground text-xs">
                          {channel.name}
                        </span>
                        <span
                          className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
                            channel.enabled
                              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                              : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {channel.enabled ? 'Active' : 'Disabled'}
                        </span>
                        {channel.last_test_status === 'success' && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            Verified
                          </span>
                        )}
                        {channel.last_test_status === 'failed' && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                            Test Failed
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        {channel.description}
                      </p>
                    </div>
                  </label>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleOpenSetup(channel)}
                      className="px-2.5 py-1 rounded bg-muted hover:bg-muted/80 text-foreground border border-border text-[11px] font-medium transition-colors cursor-pointer"
                    >
                      Setup
                    </button>
                  </div>
                </div>

                {channel.last_tested_at && (
                  <div className="pt-2 border-t border-border/50 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span className="truncate max-w-[280px]">
                      {channel.last_test_message || 'No test diagnostic recorded'}
                    </span>
                    <span className="shrink-0 font-mono">
                      {new Date(channel.last_tested_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 2. Alert Event Subscriptions */}
        <div className="pt-3 border-t border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-primary" />
              <span className="text-xs font-semibold text-foreground">
                Alert Event Subscriptions & Trigger Rules
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground">
              Select which incident severity triggers notification dispatch
            </span>
          </div>

          <div className="divide-y divide-border border border-border rounded-lg bg-background overflow-hidden">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="p-3 flex items-center justify-between gap-4 hover:bg-muted/20 transition-colors"
              >
                <div className="space-y-0.5 flex-1">
                  <div className="flex items-center gap-2">
                    {getSeverityBadge(rule.severity)}
                    <span className="font-semibold text-xs text-foreground">
                      {rule.name}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {rule.description}
                  </p>
                </div>

                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    disabled={togglingRuleId === rule.id}
                    onChange={() => handleToggleRule(rule)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary border border-border"></div>
                </label>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* SETUP MODAL */}
      {activeSetupChannel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2.5">
                {getChannelIcon(activeSetupChannel.id)}
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    Configure {activeSetupChannel.name}
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {activeSetupChannel.description}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveSetupChannel(null)}
                className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Test Result Message inside Modal */}
            {testResult && (
              <div
                className={`p-3 text-xs rounded border flex items-start gap-2 ${
                  testResult.success
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                    : 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400'
                }`}
              >
                {testResult.success ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <div className="space-y-0.5">
                  <div className="font-semibold">
                    {testResult.success ? 'Kiểm thử thành công' : 'Kiểm thử thất bại'}
                    {testResult.latency_ms !== undefined && (
                      <span className="ml-2 font-normal font-mono opacity-80">
                        ({testResult.latency_ms}ms)
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] opacity-90">{testResult.message}</p>
                </div>
              </div>
            )}

            {/* Modal Body - Channel Specific Fields */}
            <div className="space-y-3.5 text-xs">
              {/* EMAIL (SMTP) */}
              {activeSetupChannel.id === 'email' && (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2 space-y-1">
                      <label className="font-medium text-foreground">SMTP Server Host</label>
                      <input
                        type="text"
                        value={setupConfig.host || ''}
                        onChange={(e) => setSetupConfig({ ...setupConfig, host: e.target.value })}
                        placeholder="smtp.example.com"
                        className="w-full bg-background border border-input rounded px-3 py-1.5 text-foreground font-mono focus:outline-none focus:border-primary"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-medium text-foreground">Port</label>
                      <input
                        type="text"
                        value={setupConfig.port || '587'}
                        onChange={(e) => setSetupConfig({ ...setupConfig, port: e.target.value })}
                        placeholder="587"
                        className="w-full bg-background border border-input rounded px-3 py-1.5 text-foreground font-mono focus:outline-none focus:border-primary"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="font-medium text-foreground">Encryption Protocol</label>
                    <select
                      value={setupConfig.encryption || 'STARTTLS'}
                      onChange={(e) => setSetupConfig({ ...setupConfig, encryption: e.target.value })}
                      className="w-full bg-background border border-input rounded px-3 py-1.5 text-foreground focus:outline-none focus:border-primary cursor-pointer"
                    >
                      <option value="STARTTLS">STARTTLS (Port 587 - Recommended)</option>
                      <option value="SSL/TLS">SSL / TLS (Port 465)</option>
                      <option value="None">None (Plaintext / Internal Relay)</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="font-medium text-foreground">SMTP Username</label>
                      <input
                        type="text"
                        value={setupConfig.username || ''}
                        onChange={(e) => setSetupConfig({ ...setupConfig, username: e.target.value })}
                        placeholder="postmaster@domain.com"
                        className="w-full bg-background border border-input rounded px-3 py-1.5 text-foreground font-mono focus:outline-none focus:border-primary"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-medium text-foreground">SMTP Password</label>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={setupConfig.password || ''}
                          onChange={(e) => setSetupConfig({ ...setupConfig, password: e.target.value })}
                          placeholder="••••••••••••"
                          className="w-full bg-background border border-input rounded px-3 py-1.5 text-foreground font-mono focus:outline-none focus:border-primary pr-9"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-2.5 top-2 text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                          {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="font-medium text-foreground">Sender "From" Address</label>
                    <input
                      type="email"
                      value={setupConfig.from_address || ''}
                      onChange={(e) => setSetupConfig({ ...setupConfig, from_address: e.target.value })}
                      placeholder="waf-alerts@company.com"
                      className="w-full bg-background border border-input rounded px-3 py-1.5 text-foreground font-mono focus:outline-none focus:border-primary"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-medium text-foreground">Recipient Addresses (Alert Destination)</label>
                    <input
                      type="text"
                      value={setupConfig.to_addresses || ''}
                      onChange={(e) => setSetupConfig({ ...setupConfig, to_addresses: e.target.value })}
                      placeholder="secops@company.com, admin@company.com"
                      className="w-full bg-background border border-input rounded px-3 py-1.5 text-foreground font-mono focus:outline-none focus:border-primary"
                    />
                    <p className="text-[10px] text-muted-foreground">Separate multiple recipients with commas.</p>
                  </div>
                </>
              )}

              {/* SLACK */}
              {activeSetupChannel.id === 'slack' && (
                <>
                  <div className="space-y-1">
                    <label className="font-medium text-foreground">Incoming Webhook URL</label>
                    <input
                      type="text"
                      value={setupConfig.webhook_url || ''}
                      onChange={(e) => setSetupConfig({ ...setupConfig, webhook_url: e.target.value })}
                      placeholder="https://hooks.slack.com/services/T.../B.../..."
                      className="w-full bg-background border border-input rounded px-3 py-1.5 text-foreground font-mono text-[11px] focus:outline-none focus:border-primary"
                    />
                    <p className="text-[10px] text-muted-foreground">Generated from Slack App Incoming Webhooks directory.</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="font-medium text-foreground">Target Channel Override</label>
                      <input
                        type="text"
                        value={setupConfig.channel || '#waf-alerts'}
                        onChange={(e) => setSetupConfig({ ...setupConfig, channel: e.target.value })}
                        placeholder="#waf-alerts"
                        className="w-full bg-background border border-input rounded px-3 py-1.5 text-foreground font-mono focus:outline-none focus:border-primary"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-medium text-foreground">Bot Display Name</label>
                      <input
                        type="text"
                        value={setupConfig.username || 'Aurora WAF Bot'}
                        onChange={(e) => setSetupConfig({ ...setupConfig, username: e.target.value })}
                        placeholder="Aurora WAF Bot"
                        className="w-full bg-background border border-input rounded px-3 py-1.5 text-foreground focus:outline-none focus:border-primary"
                      />
                    </div>
                  </div>

                  <div className="p-3 bg-muted/40 border border-border rounded flex items-center justify-between">
                    <div>
                      <span className="font-medium text-foreground block">Mention @channel on Critical Alerts</span>
                      <span className="text-[10px] text-muted-foreground">Pings active workspace members when critical SQLi/RCE bursts occur.</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={setupConfig.mention_critical ?? true}
                      onChange={(e) => setSetupConfig({ ...setupConfig, mention_critical: e.target.checked })}
                      className="h-4 w-4 rounded border-input text-primary focus:ring-ring cursor-pointer"
                    />
                  </div>
                </>
              )}

              {/* TELEGRAM */}
              {activeSetupChannel.id === 'telegram' && (
                <>
                  <div className="space-y-1">
                    <label className="font-medium text-foreground">Telegram Bot Token</label>
                    <input
                      type="text"
                      value={setupConfig.bot_token || ''}
                      onChange={(e) => setSetupConfig({ ...setupConfig, bot_token: e.target.value })}
                      placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                      className="w-full bg-background border border-input rounded px-3 py-1.5 text-foreground font-mono text-[11px] focus:outline-none focus:border-primary"
                    />
                    <p className="text-[10px] text-muted-foreground">Obtained via @BotFather on Telegram.</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="font-medium text-foreground">Chat ID / Channel ID</label>
                      <input
                        type="text"
                        value={setupConfig.chat_id || ''}
                        onChange={(e) => setSetupConfig({ ...setupConfig, chat_id: e.target.value })}
                        placeholder="-1001234567890"
                        className="w-full bg-background border border-input rounded px-3 py-1.5 text-foreground font-mono focus:outline-none focus:border-primary"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-medium text-foreground">Topic / Thread ID (Optional)</label>
                      <input
                        type="text"
                        value={setupConfig.thread_id || ''}
                        onChange={(e) => setSetupConfig({ ...setupConfig, thread_id: e.target.value })}
                        placeholder="Optional forum thread"
                        className="w-full bg-background border border-input rounded px-3 py-1.5 text-foreground font-mono focus:outline-none focus:border-primary"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="font-medium text-foreground">Message Parse Mode</label>
                    <select
                      value={setupConfig.parse_mode || 'HTML'}
                      onChange={(e) => setSetupConfig({ ...setupConfig, parse_mode: e.target.value })}
                      className="w-full bg-background border border-input rounded px-3 py-1.5 text-foreground focus:outline-none focus:border-primary cursor-pointer"
                    >
                      <option value="HTML">HTML Formatting</option>
                      <option value="MarkdownV2">MarkdownV2 Formatting</option>
                    </select>
                  </div>
                </>
              )}

              {/* DISCORD */}
              {activeSetupChannel.id === 'discord' && (
                <>
                  <div className="space-y-1">
                    <label className="font-medium text-foreground">Discord Webhook URL</label>
                    <input
                      type="text"
                      value={setupConfig.webhook_url || ''}
                      onChange={(e) => setSetupConfig({ ...setupConfig, webhook_url: e.target.value })}
                      placeholder="https://discord.com/api/webhooks/..."
                      className="w-full bg-background border border-input rounded px-3 py-1.5 text-foreground font-mono text-[11px] focus:outline-none focus:border-primary"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="font-medium text-foreground">Bot Display Name</label>
                      <input
                        type="text"
                        value={setupConfig.bot_name || 'Aurora Guardian'}
                        onChange={(e) => setSetupConfig({ ...setupConfig, bot_name: e.target.value })}
                        placeholder="Aurora Guardian"
                        className="w-full bg-background border border-input rounded px-3 py-1.5 text-foreground focus:outline-none focus:border-primary"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-medium text-foreground">Avatar Icon URL (Optional)</label>
                      <input
                        type="text"
                        value={setupConfig.avatar_url || ''}
                        onChange={(e) => setSetupConfig({ ...setupConfig, avatar_url: e.target.value })}
                        placeholder="https://..."
                        className="w-full bg-background border border-input rounded px-3 py-1.5 text-foreground font-mono text-[11px] focus:outline-none focus:border-primary"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* CUSTOM WEBHOOK */}
              {activeSetupChannel.id === 'webhook' && (
                <>
                  <div className="space-y-1">
                    <label className="font-medium text-foreground">Endpoint URL (SIEM / Ingestion)</label>
                    <input
                      type="text"
                      value={setupConfig.endpoint_url || ''}
                      onChange={(e) => setSetupConfig({ ...setupConfig, endpoint_url: e.target.value })}
                      placeholder="https://siem.corp/api/events/waf"
                      className="w-full bg-background border border-input rounded px-3 py-1.5 text-foreground font-mono text-[11px] focus:outline-none focus:border-primary"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="font-medium text-foreground">HTTP Method</label>
                      <select
                        value={setupConfig.method || 'POST'}
                        onChange={(e) => setSetupConfig({ ...setupConfig, method: e.target.value })}
                        className="w-full bg-background border border-input rounded px-3 py-1.5 text-foreground focus:outline-none focus:border-primary cursor-pointer"
                      >
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                      </select>
                    </div>
                    <div className="col-span-2 space-y-1">
                      <label className="font-medium text-foreground">HMAC Secret Token (Optional)</label>
                      <input
                        type="text"
                        value={setupConfig.secret_token || ''}
                        onChange={(e) => setSetupConfig({ ...setupConfig, secret_token: e.target.value })}
                        placeholder="Signs header X-Aurora-Signature"
                        className="w-full bg-background border border-input rounded px-3 py-1.5 text-foreground font-mono focus:outline-none focus:border-primary"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="font-medium text-foreground">Custom HTTP Headers (One per line)</label>
                    <textarea
                      rows={2}
                      value={setupConfig.headers || ''}
                      onChange={(e) => setSetupConfig({ ...setupConfig, headers: e.target.value })}
                      placeholder={"Authorization: Bearer sk-token\nX-Client-ID: aurora-waf"}
                      className="w-full bg-background border border-input rounded px-3 py-1.5 text-foreground font-mono text-[11px] focus:outline-none focus:border-primary"
                    />
                  </div>
                </>
              )}

              {/* PAGERDUTY */}
              {activeSetupChannel.id === 'pagerduty' && (
                <>
                  <div className="space-y-1">
                    <label className="font-medium text-foreground">Events API v2 Routing Key</label>
                    <input
                      type="text"
                      value={setupConfig.routing_key || ''}
                      onChange={(e) => setSetupConfig({ ...setupConfig, routing_key: e.target.value })}
                      placeholder="32-character PagerDuty service integration key"
                      className="w-full bg-background border border-input rounded px-3 py-1.5 text-foreground font-mono text-[11px] focus:outline-none focus:border-primary"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-medium text-foreground">Default Incident Severity</label>
                    <select
                      value={setupConfig.severity || 'critical'}
                      onChange={(e) => setSetupConfig({ ...setupConfig, severity: e.target.value })}
                      className="w-full bg-background border border-input rounded px-3 py-1.5 text-foreground focus:outline-none focus:border-primary cursor-pointer"
                    >
                      <option value="critical">Critical (Page immediately)</option>
                      <option value="error">Error (High urgency)</option>
                      <option value="warning">Warning (Low urgency)</option>
                    </select>
                  </div>

                  <div className="p-3 bg-muted/40 border border-border rounded flex items-center justify-between">
                    <div>
                      <span className="font-medium text-foreground block">Auto-Resolve PagerDuty Incidents</span>
                      <span className="text-[10px] text-muted-foreground">Automatically send resolve event when cluster health recovers.</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={setupConfig.auto_resolve ?? true}
                      onChange={(e) => setSetupConfig({ ...setupConfig, auto_resolve: e.target.checked })}
                      className="h-4 w-4 rounded border-input text-primary focus:ring-ring cursor-pointer"
                    />
                  </div>
                </>
              )}
            </div>

            {/* Modal Footer Actions */}
            <div className="pt-3 border-t border-border flex items-center justify-between gap-2">
              <button
                type="button"
                disabled={testingId === activeSetupChannel.id}
                onClick={() => handleTestChannel(activeSetupChannel.id)}
                className="px-3 py-1.5 rounded bg-muted hover:bg-muted/80 text-foreground border border-border text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                {testingId === activeSetupChannel.id ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                    <span>Testing Connection...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>Send Test Ping</span>
                  </>
                )}
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveSetupChannel(null)}
                  className="px-3 py-1.5 rounded bg-transparent hover:bg-muted text-muted-foreground hover:text-foreground text-xs font-medium transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={savingConfig}
                  onClick={handleSaveSetup}
                  className="px-3.5 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  {savingConfig ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Save Configuration</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
