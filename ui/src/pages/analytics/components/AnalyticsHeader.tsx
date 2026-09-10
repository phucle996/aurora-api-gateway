import React from 'react';
import { RefreshCw, Clock, Radio, Activity } from 'lucide-react';
import { TelemetrySourceInfo } from '../../../lib/api/analytics';

export type TimeRangePreset = '15m' | '1h' | '6h' | '24h' | '7d';

interface AnalyticsHeaderProps {
  sources: TelemetrySourceInfo[];
  selectedSourceId: string;
  onSelectSource: (sourceId: string) => void;
  timeRange: TimeRangePreset;
  onSelectTimeRange: (range: TimeRangePreset) => void;
  autoRefreshInterval: number; // in seconds, 0 = off
  onChangeAutoRefresh: (interval: number) => void;
  onManualRefresh: () => void;
  isLoading: boolean;
}

export function AnalyticsHeader({
  sources,
  selectedSourceId,
  onSelectSource,
  timeRange,
  onSelectTimeRange,
  autoRefreshInterval,
  onChangeAutoRefresh,
  onManualRefresh,
  isLoading,
}: AnalyticsHeaderProps) {
  const selectedSource = sources.find((s) => s.id === selectedSourceId) || sources[0];

  const ranges: { id: TimeRangePreset; label: string }[] = [
    { id: '15m', label: '15m' },
    { id: '1h', label: '1h' },
    { id: '6h', label: '6h' },
    { id: '24h', label: '24h' },
    { id: '7d', label: '7d' },
  ];

  const refreshOptions = [
    { value: 0, label: 'Tắt' },
    { value: 10, label: '10 giây' },
    { value: 30, label: '30 giây' },
    { value: 60, label: '1 phút' },
  ];

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4 pt-1">
      {/* Title & Data Source Selector */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 border border-primary/20 text-primary">
          <Activity className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-foreground">Analytics Explorer</h1>
            <span className="text-[10px] uppercase font-mono px-2 py-0.5 bg-primary/10 border border-primary/20 text-primary">
              Grafana Inline
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Phân tích số liệu vi mô đa chiều, thời gian thực cho hạ tầng WAF
          </p>
        </div>

        {/* Source Picker */}
        {sources.length > 0 && (
          <div className="ml-4 flex items-center gap-2 bg-muted/40 border border-border px-3 py-1.5 text-xs">
            <Radio className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-muted-foreground font-medium">Nguồn:</span>
            <select
              value={selectedSourceId}
              onChange={(e) => onSelectSource(e.target.value)}
              className="bg-transparent text-foreground font-semibold focus:outline-none cursor-pointer pr-2"
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id} className="bg-card text-foreground">
                  {s.name} ({s.status})
                </option>
              ))}
            </select>
            {/* Status dot */}
            <span
              className={`w-2 h-2 rounded-full inline-block ${
                selectedSource?.status === 'connected'
                  ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50 animate-pulse'
                  : selectedSource?.status === 'unreachable'
                  ? 'bg-red-500'
                  : 'bg-zinc-400'
              }`}
              title={`Trạng thái: ${selectedSource?.status || 'unknown'}`}
            />
          </div>
        )}
      </div>

      {/* Time Range & Auto Refresh Controls */}
      <div className="flex items-center gap-2.5">
        {/* Quick Range Buttons */}
        <div className="flex items-center border border-border bg-muted/30 p-0.5">
          {ranges.map((r) => (
            <button
              key={r.id}
              onClick={() => onSelectTimeRange(r.id)}
              className={`px-3 py-1 text-xs font-medium transition-all ${
                timeRange === r.id
                  ? 'bg-card text-foreground shadow-xs border border-border font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Auto Refresh Select */}
        <div className="flex items-center gap-1.5 bg-muted/30 border border-border px-2.5 py-1 text-xs text-muted-foreground">
          <Clock className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Tự làm mới:</span>
          <select
            value={autoRefreshInterval}
            onChange={(e) => onChangeAutoRefresh(Number(e.target.value))}
            className="bg-transparent text-foreground font-medium focus:outline-none cursor-pointer"
          >
            {refreshOptions.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-card text-foreground">
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Manual Refresh Button */}
        <button
          onClick={onManualRefresh}
          disabled={isLoading}
          className="flex items-center justify-center p-1.5 border border-border bg-card hover:bg-muted text-foreground transition-colors disabled:opacity-50"
          title="Tải lại ngay"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-primary' : ''}`} />
        </button>
      </div>
    </div>
  );
}
