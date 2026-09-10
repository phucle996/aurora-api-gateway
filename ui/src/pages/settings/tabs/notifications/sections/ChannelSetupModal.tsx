import React, { useState } from 'react';
import {
  X,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
} from 'lucide-react';
import { notificationsApi, type NotificationChannelItem } from '../../../../../lib/api';
import { getChannelIcon } from './notificationHelpers';

export interface ChannelSetupModalProps {
  channel: NotificationChannelItem;
  onClose: () => void;
  onSaved: (channelId: string, newConfigStr: string) => void;
  onTestCompleted: (channelId: string, success: boolean, message: string) => void;
}

export function ChannelSetupModal({
  channel,
  onClose,
  onSaved,
  onTestCompleted,
}: ChannelSetupModalProps) {
  const [setupConfig, setSetupConfig] = useState<Record<string, any>>(() => {
    try {
      return JSON.parse(channel.config_json || '{}');
    } catch {
      return {};
    }
  });
  const [savingConfig, setSavingConfig] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [modalError, setModalError] = useState('');
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    latency_ms?: number;
  } | null>(null);

  const handleSaveSetup = async () => {
    setSavingConfig(true);
    setModalError('');
    try {
      const configStr = JSON.stringify(setupConfig);
      await notificationsApi.updateChannel(channel.id, channel.enabled, configStr);
      onSaved(channel.id, configStr);
      onClose();
    } catch (err: any) {
      setModalError(err?.message || 'Không thể lưu cấu hình kênh thông báo');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleTestChannel = async () => {
    setTesting(true);
    setTestResult(null);
    setModalError('');

    try {
      // Save current config before testing
      const configStr = JSON.stringify(setupConfig);
      await notificationsApi.updateChannel(channel.id, channel.enabled, configStr);
      onSaved(channel.id, configStr);

      const res = await notificationsApi.testChannel(channel.id);
      setTestResult(res);
      onTestCompleted(channel.id, res.success, res.message);
    } catch (err: any) {
      const msg = err?.message || 'Kiểm thử gửi thông báo thất bại';
      setTestResult({
        success: false,
        message: msg,
      });
      onTestCompleted(channel.id, false, msg);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        {/* Modal Header */}
        <div className="flex items-start justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2.5">
            {getChannelIcon(channel.id)}
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Configure {channel.name}
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {channel.description}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Error */}
        {modalError && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-xs rounded flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{modalError}</span>
          </div>
        )}

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
          {channel.id === 'email' && (
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
                    value={setupConfig.port || ''}
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
          {channel.id === 'slack' && (
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
                    value={setupConfig.channel || ''}
                    onChange={(e) => setSetupConfig({ ...setupConfig, channel: e.target.value })}
                    placeholder="#waf-alerts"
                    className="w-full bg-background border border-input rounded px-3 py-1.5 text-foreground font-mono focus:outline-none focus:border-primary"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-medium text-foreground">Bot Display Name</label>
                  <input
                    type="text"
                    value={setupConfig.username || ''}
                    onChange={(e) => setSetupConfig({ ...setupConfig, username: e.target.value })}
                    placeholder="Aurora API Gateway Bot"
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
          {channel.id === 'telegram' && (
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
          {channel.id === 'discord' && (
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
                    value={setupConfig.bot_name || ''}
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
          {channel.id === 'webhook' && (
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
          {channel.id === 'pagerduty' && (
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
            disabled={testing}
            onClick={handleTestChannel}
            className="px-3 py-1.5 rounded bg-muted hover:bg-muted/80 text-foreground border border-border text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {testing ? (
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
              onClick={onClose}
              className="px-3 py-1.5 rounded bg-transparent hover:bg-muted text-muted-foreground hover:text-foreground text-xs font-medium transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={savingConfig}
              onClick={handleSaveSetup}
              className="px-3.5 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
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
  );
}
