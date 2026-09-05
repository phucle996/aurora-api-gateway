import React from 'react';

interface RateLimitBehaviorProps {
  rateLimit: number;
  rateUnit: string;
  burst: number;
}

export function RateLimitBehaviorPanel({
  rateLimit,
  rateUnit,
  burst,
}: RateLimitBehaviorProps) {
  // Generate sample traffic bars
  const totalBars = 32;
  const greenBarsCount = Math.min(Math.floor(totalBars * 0.4), 14);

  return (
    <div className="bg-[#0B1320] border border-[#152030] p-4 space-y-3 font-mono text-xs">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-white">Expected Behavior</div>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1 text-slate-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            Allowed
          </span>
          <span className="flex items-center gap-1 text-slate-300">
            <span className="w-2 h-2 rounded-full bg-rose-500" />
            Blocked
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center pt-1">
        {/* Timeline Bar Chart */}
        <div className="sm:col-span-8 space-y-1.5 bg-[#060A10] border border-[#152030] p-3">
          <div className="h-12 flex items-end justify-between gap-1">
            {Array.from({ length: totalBars }).map((_, idx) => {
              const isGreen = idx < greenBarsCount;
              // Varied heights for realistic traffic visual
              const heightPct = isGreen
                ? 40 + ((idx * 17) % 55)
                : 50 + ((idx * 23) % 45);

              return (
                <div
                  key={idx}
                  style={{ height: `${heightPct}%` }}
                  className={`flex-1 min-w-[2px] transition-all ${
                    isGreen
                      ? 'bg-emerald-500 hover:bg-emerald-400'
                      : 'bg-rose-500 hover:bg-rose-400'
                  }`}
                  title={isGreen ? 'Allowed request' : 'Rate limit exceeded (HTTP 429)'}
                />
              );
            })}
          </div>

          <div className="flex justify-between text-[10px] text-slate-500 pt-1 border-t border-[#152030]">
            <span>0s</span>
            <span>10s</span>
            <span>20s</span>
            <span>30s</span>
            <span>40s</span>
            <span>50s</span>
            <span>60s</span>
          </div>
        </div>

        {/* KPI Mini Stat Boxes */}
        <div className="sm:col-span-4 grid grid-cols-2 gap-2 text-center">
          <div className="bg-[#080E18] border border-[#152030] p-2 flex flex-col justify-center">
            <div className="text-lg font-bold text-white font-sans">{rateLimit}</div>
            <div className="text-[10px] text-slate-400 font-mono">req/{rateUnit.replace('1 ', '')}</div>
            <div className="text-[9px] text-cyan-400 font-semibold uppercase tracking-wider mt-0.5">
              Limit
            </div>
          </div>

          <div className="bg-[#080E18] border border-[#152030] p-2 flex flex-col justify-center">
            <div className="text-lg font-bold text-white font-sans">{burst}</div>
            <div className="text-[10px] text-slate-400 font-mono">requests</div>
            <div className="text-[9px] text-amber-400 font-semibold uppercase tracking-wider mt-0.5">
              Burst
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
