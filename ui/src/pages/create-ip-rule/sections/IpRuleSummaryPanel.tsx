import React from 'react';

interface IpRuleSummaryProps {
  name: string;
  action: string;
  sourceType: string;
  countries: string[];
  ipValue: string;
  cidrValue: string;
  asnValue: string;
  groupValue: string;
  target: string;
  path: string;
  method: string;
  timeWindow: string;
  logEvent: boolean;
  addReputation: boolean;
  enableAlert: boolean;
}

export function IpRuleSummaryPanel(props: IpRuleSummaryProps) {
  const getSourceTypeLabel = () => {
    switch (props.sourceType) {
      case 'country':
        return 'Country / Region';
      case 'ip':
        return 'IP Address';
      case 'cidr':
        return 'CIDR / Network';
      case 'asn':
        return 'ASN';
      case 'group':
        return 'IP Group';
      default:
        return props.sourceType;
    }
  };

  const getActionBadge = () => {
    switch (props.action) {
      case 'block':
        return <span className="text-rose-400 font-medium">🚫 Block</span>;
      case 'allow':
        return <span className="text-emerald-400 font-medium">✔ Allow</span>;
      case 'challenge':
        return <span className="text-amber-400 font-medium">🛡 Challenge</span>;
      default:
        return <span className="text-blue-400 font-medium">📝 Monitor</span>;
    }
  };

  const scopeString = `${props.target === '*' ? 'All Sites' : props.target} · ${
    props.path ? props.path : 'All Paths'
  } · ${props.method === '*' ? 'All Methods' : props.method}`;

  const timeWindowString =
    props.timeWindow === 'always'
      ? 'Always'
      : props.timeWindow === 'business_hours'
      ? 'Business Hours'
      : props.timeWindow === 'weekend'
      ? 'Weekends'
      : 'Custom Window';

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

        {/* Source Type */}
        <div className="flex items-center justify-between py-2">
          <span className="text-slate-400">Source Type</span>
          <span className="text-slate-200">{getSourceTypeLabel()}</span>
        </div>

        {/* Dynamic Source Value (Countries / IP / CIDR / etc.) */}
        <div className="flex items-center justify-between py-2">
          <span className="text-slate-400">
            {props.sourceType === 'country'
              ? 'Countries'
              : props.sourceType === 'ip'
              ? 'Target IP'
              : props.sourceType === 'cidr'
              ? 'CIDR Block'
              : props.sourceType === 'asn'
              ? 'ASN'
              : 'IP Group'}
          </span>
          <div className="flex flex-wrap items-center justify-end gap-1">
            {props.sourceType === 'country' && (
              props.countries.length > 0 ? (
                props.countries.map((c) => (
                  <span
                    key={c}
                    className="px-1.5 py-0.2 bg-rose-950/60 border border-rose-800/60 text-rose-300 text-[10px] font-mono"
                  >
                    {c}
                  </span>
                ))
              ) : (
                <span className="text-slate-500">None selected</span>
              )
            )}
            {props.sourceType === 'ip' && (
              <span className="text-slate-200">{props.ipValue || '—'}</span>
            )}
            {props.sourceType === 'cidr' && (
              <span className="text-slate-200">{props.cidrValue || '—'}</span>
            )}
            {props.sourceType === 'asn' && (
              <span className="text-slate-200">{props.asnValue || '—'}</span>
            )}
            {props.sourceType === 'group' && (
              <span className="text-slate-200">{props.groupValue || '—'}</span>
            )}
          </div>
        </div>

        {/* Scope */}
        <div className="flex items-center justify-between py-2">
          <span className="text-slate-400">Scope</span>
          <span className="text-slate-200 text-right truncate max-w-[200px]" title={scopeString}>
            {scopeString}
          </span>
        </div>

        {/* Time Window */}
        <div className="flex items-center justify-between py-2">
          <span className="text-slate-400">Time Window</span>
          <span className="text-slate-200">{timeWindowString}</span>
        </div>

        {/* Log Event */}
        <div className="flex items-center justify-between py-2">
          <span className="text-slate-400">Log Event</span>
          <span className={props.logEvent ? 'text-emerald-400 font-medium' : 'text-slate-500'}>
            {props.logEvent ? '✔ Enabled' : '— Disabled'}
          </span>
        </div>

        {/* Add to Reputation */}
        <div className="flex items-center justify-between py-2">
          <span className="text-slate-400">Add to Reputation</span>
          <span className={props.addReputation ? 'text-emerald-400 font-medium' : 'text-slate-500'}>
            {props.addReputation ? '✔ Enabled' : '— Disabled'}
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
