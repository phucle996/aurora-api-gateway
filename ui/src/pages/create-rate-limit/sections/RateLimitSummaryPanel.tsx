import React from 'react';
import { RateLimitCondition } from './RateLimitConditionsSection';

interface RateLimitSummaryProps {
  name: string;
  actionExceeded: string;
  rateLimit: number;
  rateUnit: string;
  burst: number;
  conditions: RateLimitCondition[];
  policy: string;
  logEvents: boolean;
  enableAlert: boolean;
}

export function RateLimitSummaryPanel(props: RateLimitSummaryProps) {
  const getActionBadge = () => {
    switch (props.actionExceeded) {
      case 'block_429':
        return <span className="text-destructive font-semibold">🚫 Block (429)</span>;
      case 'challenge':
        return <span className="text-amber-500 dark:text-amber-400 font-semibold">🛡 Challenge</span>;
      case 'drop':
        return <span className="text-destructive font-semibold">⛔ Drop TCP</span>;
      default:
        return <span className="text-primary font-semibold">📝 Log Only</span>;
    }
  };

  const firstCondition = props.conditions[0];
  const scopeString = firstCondition
    ? `${firstCondition.field} ${firstCondition.operator.toLowerCase()} ${firstCondition.value}`
    : 'Global (All Paths)';

  return (
    <div className="bg-card border border-border p-4 space-y-3 font-sans text-xs">
      <div className="text-sm font-semibold text-foreground">Summary</div>

      <div className="divide-y divide-border text-xs">
        {/* Name */}
        <div className="flex items-center justify-between py-2">
          <span className="text-muted-foreground">Name</span>
          <span className="text-foreground font-semibold">{props.name || '—'}</span>
        </div>

        {/* Action */}
        <div className="flex items-center justify-between py-2">
          <span className="text-muted-foreground">Action</span>
          {getActionBadge()}
        </div>

        {/* Rate Limit */}
        <div className="flex items-center justify-between py-2">
          <span className="text-muted-foreground">Rate Limit</span>
          <span className="text-foreground">
            {props.rateLimit} requests / {props.rateUnit}
          </span>
        </div>

        {/* Burst */}
        <div className="flex items-center justify-between py-2">
          <span className="text-muted-foreground">Burst</span>
          <span className="text-foreground">{props.burst || '0'}</span>
        </div>

        {/* Scope */}
        <div className="flex items-center justify-between py-2">
          <span className="text-muted-foreground">Scope</span>
          <span className="text-foreground truncate max-w-[200px]" title={scopeString}>
            {scopeString}
          </span>
        </div>

        {/* Policy */}
        <div className="flex items-center justify-between py-2">
          <span className="text-muted-foreground">Policy</span>
          <span className="text-foreground">{props.policy}</span>
        </div>

        {/* Log Event */}
        <div className="flex items-center justify-between py-2">
          <span className="text-muted-foreground">Log Event</span>
          <span className={props.logEvents ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-muted-foreground'}>
            {props.logEvents ? '✔ Enabled' : '— Disabled'}
          </span>
        </div>

        {/* Alert */}
        <div className="flex items-center justify-between py-2">
          <span className="text-muted-foreground">Alert</span>
          <span className={props.enableAlert ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-muted-foreground'}>
            {props.enableAlert ? '✔ Enabled' : '— Disabled'}
          </span>
        </div>
      </div>
    </div>
  );
}
