import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { AnalyticsSeries } from '../../../lib/api/analytics';
import { TrendingUp, Activity, ArrowDown, ArrowUp, BarChart2 } from 'lucide-react';

interface TimeSeriesCanvasProps {
  series: AnalyticsSeries[];
  isLoading: boolean;
  error?: string | null;
}

const SERIES_COLORS = [
  '#10b981', // Emerald
  '#06b6d4', // Cyan
  '#8b5cf6', // Violet
  '#f59e0b', // Amber
  '#f43f5e', // Rose
  '#3b82f6', // Blue
  '#14b8a6', // Teal
  '#ec4899', // Pink
];

export function TimeSeriesCanvas({ series, isLoading, error }: TimeSeriesCanvasProps) {
  const [hiddenSeries, setHiddenSeries] = useState<Record<string, boolean>>({});

  const toggleSeries = (key: string) => {
    setHiddenSeries((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // 1. Chuẩn hóa tên series và gán màu
  const seriesMeta = useMemo(() => {
    return series.map((s, idx) => {
      let label = s.query_id ? `[${s.query_id}] ` : '';
      if (s.labels && Object.keys(s.labels).length > 0) {
        const labelParts = Object.entries(s.labels).map(([k, v]) => `${k}=${v}`);
        label += labelParts.join(', ');
      } else {
        label += s.metric_key;
      }
      const dataKey = `s_${idx}`;
      const color = SERIES_COLORS[idx % SERIES_COLORS.length];
      return {
        dataKey,
        label,
        color,
        metricKey: s.metric_key,
        series: s,
      };
    });
  }, [series]);

  // 2. Chuyển đổi dữ liệu thời gian cho Recharts
  const chartData = useMemo(() => {
    if (!series || series.length === 0) return [];

    // Tập hợp toàn bộ timestamps
    const timeMap: Record<number, Record<string, number>> = {};

    series.forEach((s, sIdx) => {
      const dataKey = `s_${sIdx}`;
      for (let i = 0; i < s.timestamps.length; i++) {
        const ts = s.timestamps[i];
        const val = s.values[i];
        if (!timeMap[ts]) {
          timeMap[ts] = {};
        }
        timeMap[ts][dataKey] = Number(val.toFixed(2));
      }
    });

    const sortedTimestamps = Object.keys(timeMap)
      .map(Number)
      .sort((a, b) => a - b);

    return sortedTimestamps.map((ts) => {
      const date = new Date(ts * 1000);
      const timeLabel = date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      return {
        timestamp: ts,
        timeLabel,
        ...timeMap[ts],
      };
    });
  }, [series]);

  // 3. Tính toán thống kê tổng quan (Current, Max, Min, Avg)
  const stats = useMemo(() => {
    let allValues: number[] = [];
    let latestVal = 0;

    series.forEach((s) => {
      if (s.values.length > 0) {
        allValues = allValues.concat(s.values);
        latestVal = s.values[s.values.length - 1];
      }
    });

    if (allValues.length === 0) {
      return { current: 0, max: 0, min: 0, avg: 0 };
    }

    const max = Math.max(...allValues);
    const min = Math.min(...allValues);
    const sum = allValues.reduce((a, b) => a + b, 0);
    const avg = sum / allValues.length;

    return {
      current: Number(latestVal.toFixed(2)),
      max: Number(max.toFixed(2)),
      min: Number(min.toFixed(2)),
      avg: Number(avg.toFixed(2)),
    };
  }, [series]);

  return (
    <div className="bg-card border border-border p-4 shadow-xs">
      {/* 4 Cards Thống kê Tóm tắt */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="p-3 bg-muted/20 border border-border">
          <div className="flex items-center justify-between text-muted-foreground text-xs mb-1">
            <span>Hiện tại (Current)</span>
            <Activity className="w-3.5 h-3.5 text-primary" />
          </div>
          <div className="text-lg font-bold font-mono text-foreground">{stats.current}</div>
        </div>

        <div className="p-3 bg-muted/20 border border-border">
          <div className="flex items-center justify-between text-muted-foreground text-xs mb-1">
            <span>Đỉnh (Peak / Max)</span>
            <ArrowUp className="w-3.5 h-3.5 text-rose-500" />
          </div>
          <div className="text-lg font-bold font-mono text-rose-500">{stats.max}</div>
        </div>

        <div className="p-3 bg-muted/20 border border-border">
          <div className="flex items-center justify-between text-muted-foreground text-xs mb-1">
            <span>Đáy (Min)</span>
            <ArrowDown className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="text-lg font-bold font-mono text-emerald-500">{stats.min}</div>
        </div>

        <div className="p-3 bg-muted/20 border border-border">
          <div className="flex items-center justify-between text-muted-foreground text-xs mb-1">
            <span>Trung bình (Avg)</span>
            <TrendingUp className="w-3.5 h-3.5 text-cyan-500" />
          </div>
          <div className="text-lg font-bold font-mono text-cyan-500">{stats.avg}</div>
        </div>
      </div>

      {/* Chart Canvas Area */}
      <div className="h-[360px] w-full relative">
        {error ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 bg-red-50/10 border border-red-500/20">
            <BarChart2 className="w-10 h-10 text-red-400 mb-2 opacity-60" />
            <div className="text-sm font-semibold text-red-500 mb-1">Truy vấn không thành công</div>
            <p className="text-xs text-muted-foreground max-w-md">{error}</p>
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground border border-dashed border-border/60">
            <BarChart2 className="w-10 h-10 mb-2 opacity-30 animate-pulse" />
            <div className="text-xs font-semibold mb-1">
              {isLoading ? 'Đang truy vấn Prometheus...' : 'Không có dữ liệu trong khoảng thời gian đã chọn'}
            </div>
            <p className="text-[11px] text-muted-foreground max-w-sm">
              Hãy kiểm tra nguồn Prometheus, điều chỉnh Time Range hoặc chọn một mẫu phân tích khác.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 15, left: -15, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" opacity={0.3} />
              <XAxis
                dataKey="timeLabel"
                stroke="#71717a"
                fontSize={11}
                tickLine={false}
                axisLine={{ stroke: '#3f3f46' }}
              />
              <YAxis
                stroke="#71717a"
                fontSize={11}
                tickLine={false}
                axisLine={{ stroke: '#3f3f46' }}
                domain={['auto', 'auto']}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  return (
                    <div className="bg-popover border border-border p-2.5 shadow-md text-xs font-mono">
                      <div className="text-muted-foreground mb-1.5 pb-1 border-b border-border font-sans font-semibold">
                        Thời gian: {label}
                      </div>
                      <div className="space-y-1">
                        {payload.map((item, pIdx) => {
                          const meta = seriesMeta.find((m) => m.dataKey === item.dataKey);
                          return (
                            <div key={pIdx} className="flex items-center justify-between gap-4">
                              <div className="flex items-center gap-1.5 truncate max-w-[240px]">
                                <span
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{ backgroundColor: item.color }}
                                />
                                <span className="truncate text-foreground font-sans">
                                  {meta?.label || item.name}
                                </span>
                              </div>
                              <span className="font-bold text-foreground">{item.value}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                }}
              />
              {seriesMeta.map((meta) => {
                if (hiddenSeries[meta.dataKey]) return null;
                return (
                  <Line
                    key={meta.dataKey}
                    type="monotone"
                    dataKey={meta.dataKey}
                    name={meta.label}
                    stroke={meta.color}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0, fill: meta.color }}
                    isAnimationActive={false}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Series Legend & Toggle Badges */}
      {seriesMeta.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-3 mt-3 border-t border-border">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mr-1">
            Chuỗi dữ liệu ({seriesMeta.length}):
          </span>
          {seriesMeta.map((meta) => {
            const isHidden = hiddenSeries[meta.dataKey];
            return (
              <button
                key={meta.dataKey}
                onClick={() => toggleSeries(meta.dataKey)}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs border transition-all cursor-pointer ${
                  isHidden
                    ? 'opacity-40 line-through bg-muted/20 border-border text-muted-foreground'
                    : 'bg-card border-border hover:bg-muted/30 text-foreground font-medium'
                }`}
                title="Bấm để ẩn / hiện đường này"
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: meta.color }}
                />
                <span className="truncate max-w-[200px]">{meta.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
