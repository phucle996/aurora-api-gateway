import React from 'react';
import type { NotificationChannelItem } from '../../../../../lib/api';
import { getChannelIcon } from './notificationHelpers';

export interface NotificationChannelsSectionProps {
  channels: NotificationChannelItem[];
  togglingId: string | null;
  onToggleChannel: (channel: NotificationChannelItem) => void;
  onOpenSetup: (channel: NotificationChannelItem) => void;
}

export function NotificationChannelsSection({
  channels,
  togglingId,
  onToggleChannel,
  onOpenSetup,
}: NotificationChannelsSectionProps) {
  return (
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
                  onChange={() => onToggleChannel(channel)}
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
                  onClick={() => onOpenSetup(channel)}
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
  );
}
