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
        return <span className="text-rose-400 font-semibold">🚫 Block (429)</span>;
      case 'challenge':
        return <span className="text-amber-400 font-semibold">🛡 Challenge</span>;
      case 'drop':
        return <span className="text-rose-500 font-semibold">⛔ Drop TCP</span>;
      default:
        return <span className="text-blue-400 font-semibold">📝 Log Only</span>;
    }
  };

  const firstCondition = props.conditions[0];
  const scopeString = firstCondition
    ? `${firstCondition.field} ${firstCondition.operator.toLowerCase()} ${firstCondition.value}`
    : 'Global (All Paths)';

  return (
    <div className="bg-[#0B1320] border border-[#152030] p-4 space-y-3 font-mono text-xs">
      <div className="text-sm font-semibold text-white">Summary</div>

      <div className="divide-y divide-[#152030] text-xs">
        {/* Name */}
        <div className="flex items-center justify-between py-2">
          <span className="text-slate-400">Name</span>
          <span className="text-slate-200 font-semibold">{props.name || '—'}</span>
        </div>

        {/* Action */}
        <div className="flex items-center justify-between py-2">
          <span className="text-slate-400">Action</span>
          {getActionBadge()}
        </div>

        {/* Rate Limit */}
        <div className="flex items-center justify-between py-2">
          <span className="text-slate-400">Rate Limit</span>
          <span className="text-slate-200">
            {props.rateLimit} requests / {props.rateUnit}
          </span>
        </div>

        {/* Burst */}
        <div className="flex items-center justify-between py-2">
          <span className="text-slate-400">Burst</span>
          <span className="text-slate-200">{props.burst || '0'}</span>
        </div>

        {/* Scope */}
        <div className="flex items-center justify-between py-2">
          <span className="text-slate-400">Scope</span>
          <span className="text-slate-200 truncate max-w-[200px]" title={scopeString}>
            {scopeString}
          </span>
        </div>

        {/* Policy */}
        <div className="flex items-center justify-between py-2">
          <span className="text-slate-400">Policy</span>
          <span className="text-slate-200">{props.policy}</span>
        </div>

        {/* Log Event */}
        <div className="flex items-center justify-between py-2">
          <span className="text-slate-400">Log Event</span>
          <span className={props.logEvents ? 'text-emerald-400 font-medium' : 'text-slate-500'}>
            {props.logEvents ? '✔ Enabled' : '— Disabled'}
          </span>
        </div>

        {/* Alert */}
        <div className="flex items-center justify-between py-2">
          <span className="text-slate-400">Alert</span>
          <span className={props.enableAlert ? 'text-emerald-400 font-medium' : 'text-slate-500'}>
            {props.enableAlert ? '✔ Enabled' : '— Disabled'}
          </span>
        </div>
      </div>
    </div>
  );
}
