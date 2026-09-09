import React from 'react';
import { Layers, CheckCircle2, Download } from 'lucide-react';

export interface ModuleStoreStatsProps {
  total: number;
  loaded: number;
  available: number;
}

export function ModuleStoreStats({ total, loaded, available }: ModuleStoreStatsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="bg-card border border-border p-3.5 rounded-sm shadow-xs flex items-center justify-between">
        <div>
          <div className="text-[11px] text-muted-foreground uppercase font-mono tracking-wider">
            Tổng Module trong Store
          </div>
          <div className="text-xl font-bold text-foreground font-mono mt-0.5">{total}</div>
        </div>
        <div className="w-9 h-9 rounded-xs bg-muted/60 border border-border flex items-center justify-center">
          <Layers className="w-4 h-4 text-primary" />
        </div>
      </div>

      <div className="bg-card border border-border p-3.5 rounded-sm shadow-xs flex items-center justify-between">
        <div>
          <div className="text-[11px] text-muted-foreground uppercase font-mono tracking-wider">
            Đang hoạt động (Active)
          </div>
          <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">
            {loaded}
          </div>
        </div>
        <div className="w-9 h-9 rounded-xs bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-500/30 flex items-center justify-center">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
        </div>
      </div>

      <div className="bg-card border border-border p-3.5 rounded-sm shadow-xs flex items-center justify-between">
        <div>
          <div className="text-[11px] text-muted-foreground uppercase font-mono tracking-wider">
            Khả dụng để cài đặt
          </div>
          <div className="text-xl font-bold text-blue-600 dark:text-blue-400 font-mono mt-0.5">
            {available}
          </div>
        </div>
        <div className="w-9 h-9 rounded-xs bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-500/30 flex items-center justify-center">
          <Download className="w-4 h-4 text-blue-500" />
        </div>
      </div>
    </div>
  );
}
