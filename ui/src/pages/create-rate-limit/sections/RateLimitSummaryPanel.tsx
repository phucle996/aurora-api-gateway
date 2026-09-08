import React from 'react';
import type {
  DimensionType,
  PathScopeConfig,
  HeaderMatchConfig,
} from './RateLimitConfigSection';

interface RateLimitSummaryProps {
  name: string;
  actionExceeded: string;
  rateLimit: number;
  rateUnit: string;
  burst: number;
  enabledDimensions: DimensionType[];
  dimensionOrder: DimensionType[];
  pathConfig: PathScopeConfig;
  headerConfig: HeaderMatchConfig;
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

  const dimensionLabels: Record<DimensionType, string> = {
    ip: 'Client IP',
    header: 'Header Match',
    path: 'Path Scope',
  };

  const orderString = props.dimensionOrder.map((d) => dimensionLabels[d]).join(' ➔ ');

  return (
    <div className="bg-card border border-border p-4 space-y-3 font-sans text-xs shadow-xs rounded-sm">
      <div className="text-sm font-semibold text-foreground">Summary</div>

      <div className="divide-y divide-border text-xs">
        {/* Name */}
        <div className="flex items-center justify-between py-2">
          <span className="text-muted-foreground">Name</span>
          <span className="text-foreground font-semibold font-mono">{props.name || '—'}</span>
        </div>

        {/* Action */}
        <div className="flex items-center justify-between py-2">
          <span className="text-muted-foreground">Action</span>
          {getActionBadge()}
        </div>

        {/* Rate Limit */}
        <div className="flex items-center justify-between py-2">
          <span className="text-muted-foreground">Rate Limit</span>
          <span className="text-foreground font-mono">
            {props.rateLimit} req / {props.rateUnit}
          </span>
        </div>

        {/* Burst */}
        <div className="flex items-center justify-between py-2">
          <span className="text-muted-foreground">Burst</span>
          <span className="text-foreground font-mono">{props.burst || '0'}</span>
        </div>

        {/* Evaluation Order */}
        <div className="flex items-center justify-between py-2">
          <span className="text-muted-foreground">Evaluation Order</span>
          <span className="text-foreground font-mono text-[11px] truncate max-w-[200px]" title={orderString}>
            {orderString || 'Default'}
          </span>
        </div>

        {/* Target Path */}
        {props.enabledDimensions.includes('path') && (
          <div className="flex items-center justify-between py-2">
            <span className="text-muted-foreground">Path Scope</span>
            <span className="text-primary font-mono text-[11px] truncate max-w-[180px]">
              {props.pathConfig.path || '/'}
            </span>
          </div>
        )}

        {/* Header Match */}
        {props.enabledDimensions.includes('header') && (
          <div className="flex items-center justify-between py-2">
            <span className="text-muted-foreground">Header Match</span>
            <span className="text-foreground font-mono text-[11px] truncate max-w-[180px]">
              {props.headerConfig.headerName || 'Header'}: {props.headerConfig.operator}
            </span>
          </div>
        )}

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

