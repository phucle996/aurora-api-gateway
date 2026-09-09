import React from 'react';
import { Clock, Calendar } from 'lucide-react';
import type { BackupConfig } from '../../../../../lib/api';

interface BackupScheduleSectionProps {
  config: BackupConfig;
  onChange: (updated: BackupConfig) => void;
}

export function describeCron(cron: string): string {
  const trimmed = cron.trim();
  if (trimmed === '0 2 * * *') return 'At 02:00 AM UTC every day';
  if (trimmed === '0 */6 * * *') return 'Every 6 hours (00:00, 06:00, 12:00, 18:00 UTC)';
  if (trimmed === '0 0 * * *') return 'Every day at midnight (00:00 UTC)';
  if (trimmed === '0 2 * * 0') return 'At 02:00 AM UTC every Sunday';
  if (trimmed === '0 2 1 * *') return 'At 02:00 AM UTC on the 1st of every month';
  return `Cron Schedule: ${trimmed}`;
}

export function BackupScheduleSection({ config, onChange }: BackupScheduleSectionProps) {
  return (
    <div className="pt-2 border-t border-border space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" />
          <span className="text-xs font-semibold text-foreground">
            Automated Backup Scheduling (Cron Job)
          </span>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <span className="text-[11px] text-muted-foreground">Auto-Backup Scheduler</span>
          <input
            type="checkbox"
            checked={config.auto_backup_enabled}
            onChange={(e) => onChange({ ...config, auto_backup_enabled: e.target.checked })}
            className="h-4 w-4 rounded border-input text-primary focus:ring-ring cursor-pointer"
          />
        </label>
      </div>

      <div className="p-3.5 border border-border rounded-lg bg-background space-y-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="font-medium text-foreground text-xs flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-primary" />
              Backup Interval (Cron Expression)
            </label>
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-mono">
              {describeCron(config.cron_expression)}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              value={config.cron_expression}
              onChange={(e) => onChange({ ...config, cron_expression: e.target.value })}
              placeholder="0 2 * * *"
              className="w-48 bg-card border border-input rounded px-3 py-1.5 text-foreground font-mono text-xs focus:outline-none focus:border-primary"
            />

            <div className="flex items-center gap-1.5 overflow-x-auto text-[11px]">
              <span className="text-muted-foreground text-[10px]">Presets:</span>
              <button
                type="button"
                onClick={() => onChange({ ...config, cron_expression: '0 */6 * * *' })}
                className="px-2 py-0.8 rounded bg-muted hover:bg-muted/80 text-foreground border border-border cursor-pointer text-xs"
              >
                Every 6h
              </button>
              <button
                type="button"
                onClick={() => onChange({ ...config, cron_expression: '0 2 * * *' })}
                className="px-2 py-0.8 rounded bg-muted hover:bg-muted/80 text-foreground border border-border cursor-pointer text-xs"
              >
                Daily (02:00)
              </button>
              <button
                type="button"
                onClick={() => onChange({ ...config, cron_expression: '0 2 * * 0' })}
                className="px-2 py-0.8 rounded bg-muted hover:bg-muted/80 text-foreground border border-border cursor-pointer text-xs"
              >
                Weekly (Sun)
              </button>
              <button
                type="button"
                onClick={() => onChange({ ...config, cron_expression: '0 2 1 * *' })}
                className="px-2 py-0.8 rounded bg-muted hover:bg-muted/80 text-foreground border border-border cursor-pointer text-xs"
              >
                Monthly (1st)
              </button>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Standard 5-field cron syntax: <code>minute hour day-of-month month day-of-week</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
