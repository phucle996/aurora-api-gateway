import React, { useState, useEffect } from 'react';
import { Bell, AlertCircle, CheckCircle2, X, Loader2 } from 'lucide-react';
import {
  notificationsApi,
  type NotificationChannelItem,
  type NotificationRuleItem,
} from '../../../../lib/api';
import { NotificationChannelsSection } from './sections/NotificationChannelsSection';
import { AlertRulesSection } from './sections/AlertRulesSection';
import { ChannelSetupModal } from './sections/ChannelSetupModal';

export function NotificationsTab() {
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

  const handleSaved = (channelId: string, newConfigStr: string) => {
    setChannels((prev) =>
      prev.map((c) => (c.id === channelId ? { ...c, config_json: newConfigStr } : c))
    );
    const targetChannel = channels.find((c) => c.id === channelId);
    setSuccessBanner(`Đã lưu cấu hình cho ${targetChannel?.name || channelId}`);
    setTimeout(() => setSuccessBanner(''), 3000);
  };

  const handleTestCompleted = (channelId: string, success: boolean, message: string) => {
    setChannels((prev) =>
      prev.map((c) =>
        c.id === channelId
          ? {
              ...c,
              last_test_status: success ? 'success' : 'failed',
              last_test_message: message,
              last_tested_at: new Date().toISOString(),
            }
          : c
      )
    );
  };

  const activeChannelsCount = channels.filter((c) => c.enabled).length;

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center gap-2 text-muted-foreground text-xs bg-card border border-border font-sans">
        <Loader2 className="w-4 h-4 animate-spin text-primary" />
        <span>Đang tải cấu hình kênh thông báo...</span>
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
        <NotificationChannelsSection
          channels={channels}
          togglingId={togglingId}
          onToggleChannel={handleToggleChannel}
          onOpenSetup={(channel) => setActiveSetupChannel(channel)}
        />

        {/* 2. Alert Event Subscriptions */}
        <AlertRulesSection
          rules={rules}
          togglingRuleId={togglingRuleId}
          onToggleRule={handleToggleRule}
        />
      </div>

      {/* SETUP MODAL */}
      {activeSetupChannel && (
        <ChannelSetupModal
          channel={activeSetupChannel}
          onClose={() => setActiveSetupChannel(null)}
          onSaved={handleSaved}
          onTestCompleted={handleTestCompleted}
        />
      )}
    </div>
  );
}
