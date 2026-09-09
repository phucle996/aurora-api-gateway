import React from 'react';
import { Activity } from 'lucide-react';

export interface TelemetryModeSectionProps {
  mode: 'standalone' | 'prometheus' | 'disabled';
  onChangeMode: (mode: 'standalone' | 'prometheus' | 'disabled') => void;
}

export function TelemetryModeSection({ mode, onChangeMode }: TelemetryModeSectionProps) {
  return (
    <div className="bg-card border border-border p-5 shadow-xs h-full flex flex-col justify-between">
      <div>
        <div className="flex items-center gap-2 text-foreground font-semibold text-sm mb-1">
          <Activity className="w-4 h-4 text-primary" />
          <span>Metrics & Telemetry Provider</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Cấu hình nguồn thu thập telemetry (CPU, RAM, RPS, Connections).
        </p>

        <div className="mt-5 space-y-2.5 text-xs">
          {/* Option 1: Standalone */}
          <label
            onClick={() => onChangeMode('standalone')}
            className={`block p-3.5 border transition-colors cursor-pointer ${
              mode === 'standalone'
                ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-500'
                : 'bg-muted/30 border-border hover:border-primary/40'
            }`}
          >
            <div className="flex items-start gap-3">
              <input
                type="radio"
                name="metrics_mode"
                checked={mode === 'standalone'}
                onChange={() => onChangeMode('standalone')}
                className="mt-0.5 text-emerald-600 focus:ring-0 cursor-pointer"
              />
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-foreground">Chế độ 1: Standalone / Ring Buffer</span>
                  <span className="px-1.5 py-0.2 bg-emerald-100 dark:bg-emerald-900/60 border border-emerald-400 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-400 text-[10px]">
                    Lab / Dev
                  </span>
                </div>
                <p className="text-muted-foreground text-[11px] leading-relaxed">
                  Lưu RAM 60 phút gần nhất, tự cấp tự túc không cần server ngoài.
                </p>
              </div>
            </div>
          </label>

          {/* Option 2: Prometheus */}
          <label
            onClick={() => onChangeMode('prometheus')}
            className={`block p-3.5 border transition-colors cursor-pointer ${
              mode === 'prometheus'
                ? 'bg-cyan-50 dark:bg-cyan-950/20 border-cyan-500'
                : 'bg-muted/30 border-border hover:border-primary/40'
            }`}
          >
            <div className="flex items-start gap-3">
              <input
                type="radio"
                name="metrics_mode"
                checked={mode === 'prometheus'}
                onChange={() => onChangeMode('prometheus')}
                className="mt-0.5 text-cyan-600 focus:ring-0 cursor-pointer"
              />
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-foreground">Chế độ 2: Prometheus / VictoriaMetrics</span>
                  <span className="px-1.5 py-0.2 bg-cyan-100 dark:bg-cyan-900/60 border border-cyan-400 dark:border-cyan-500/40 text-cyan-700 dark:text-cyan-400 text-[10px]">
                    Production
                  </span>
                </div>
                <p className="text-muted-foreground text-[11px] leading-relaxed">
                  Tích hợp máy chủ Prometheus tập trung để lưu trữ dài hạn.
                </p>
              </div>
            </div>
          </label>

          {/* Option 3: Disabled */}
          <label
            onClick={() => onChangeMode('disabled')}
            className={`block p-3.5 border transition-colors cursor-pointer ${
              mode === 'disabled'
                ? 'bg-rose-50 dark:bg-rose-950/20 border-rose-500'
                : 'bg-muted/30 border-border hover:border-primary/40'
            }`}
          >
            <div className="flex items-start gap-3">
              <input
                type="radio"
                name="metrics_mode"
                checked={mode === 'disabled'}
                onChange={() => onChangeMode('disabled')}
                className="mt-0.5 text-rose-600 focus:ring-0 cursor-pointer"
              />
              <div className="space-y-1">
                <div className="font-bold text-foreground">Chế độ 3: Tắt thu thập (Disabled)</div>
                <p className="text-muted-foreground text-[11px] leading-relaxed">
                  Vô hiệu hoá toàn bộ thu thập telemetry và biểu đồ giám sát.
                </p>
              </div>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}
