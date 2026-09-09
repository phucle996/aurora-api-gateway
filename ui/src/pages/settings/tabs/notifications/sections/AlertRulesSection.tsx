import React from 'react';
import { ShieldAlert } from 'lucide-react';
import type { NotificationRuleItem } from '../../../../../lib/api';
import { getSeverityBadge } from './notificationHelpers';

export interface AlertRulesSectionProps {
  rules: NotificationRuleItem[];
  togglingRuleId: string | null;
  onToggleRule: (rule: NotificationRuleItem) => void;
}

export function AlertRulesSection({
  rules,
  togglingRuleId,
  onToggleRule,
}: AlertRulesSectionProps) {
  return (
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
                onChange={() => onToggleRule(rule)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary border border-border"></div>
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
