import React from 'react';
import { Globe, ShieldAlert, Gauge, Cpu, Sliders } from 'lucide-react';
import { AnalyticsQueryItem } from '../../../lib/api/analytics';

export type PresetType = 'traffic' | 'waf' | 'rate_limit' | 'system' | 'custom';

interface PresetItem {
  id: PresetType;
  label: string;
  icon: React.ReactNode;
  queries: AnalyticsQueryItem[];
}

export const PRESET_DEFINITIONS: PresetItem[] = [
  {
    id: 'traffic',
    label: 'All Traffic & RPS',
    icon: <Globe className="w-3.5 h-3.5 shrink-0" />,
    queries: [
      {
        id: 'A',
        metric_key: 'traffic.requests_rate',
        aggregation: 'sum',
        group_by: ['node_id'],
      },
      {
        id: 'B',
        metric_key: 'traffic.connections_active',
        aggregation: 'sum',
        group_by: ['node_id'],
      },
    ],
  },
  {
    id: 'waf',
    label: 'WAF Attacks & Rules',
    icon: <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-amber-500" />,
    queries: [
      {
        id: 'A',
        metric_key: 'waf.blocks_rate',
        aggregation: 'sum',
        group_by: ['action'],
      },
      {
        id: 'B',
        metric_key: 'waf.rules_triggered',
        aggregation: 'sum',
        group_by: ['rule_id'],
      },
    ],
  },
  {
    id: 'rate_limit',
    label: 'Rate Limiting',
    icon: <Gauge className="w-3.5 h-3.5 shrink-0 text-cyan-500" />,
    queries: [
      {
        id: 'A',
        metric_key: 'rate_limit.rejected',
        aggregation: 'sum',
        group_by: ['zone'],
      },
      {
        id: 'B',
        metric_key: 'rate_limit.delayed',
        aggregation: 'sum',
        group_by: ['zone'],
      },
    ],
  },
  {
    id: 'system',
    label: 'Cluster Nodes Health',
    icon: <Cpu className="w-3.5 h-3.5 shrink-0 text-emerald-500" />,
    queries: [
      {
        id: 'A',
        metric_key: 'system.cpu_percent',
        aggregation: 'avg',
        group_by: ['node_id'],
      },
      {
        id: 'B',
        metric_key: 'system.memory_percent',
        aggregation: 'avg',
        group_by: ['node_id'],
      },
    ],
  },
  {
    id: 'custom',
    label: 'Custom Explorer',
    icon: <Sliders className="w-3.5 h-3.5 shrink-0 text-violet-500" />,
    queries: [],
  },
];

interface PresetSelectorProps {
  activePreset: PresetType;
  onSelectPreset: (preset: PresetType) => void;
}

export function PresetSelector({ activePreset, onSelectPreset }: PresetSelectorProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border py-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mr-1">
        Mẫu phân tích:
      </span>
      {PRESET_DEFINITIONS.map((preset) => {
        const isActive = activePreset === preset.id;
        return (
          <button
            key={preset.id}
            onClick={() => onSelectPreset(preset.id)}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium border transition-all ${
              isActive
                ? 'bg-primary/10 border-primary text-primary font-semibold shadow-2xs'
                : 'bg-card border-border text-muted-foreground hover:text-foreground hover:bg-muted/40'
            }`}
          >
            {preset.icon}
            <span>{preset.label}</span>
          </button>
        );
      })}
    </div>
  );
}
