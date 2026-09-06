import React from 'react';

export function RateLimitsCharts() {
  // Mock data for 24 hours bars (normalized heights 0-100%)
  const hourlyData = [
    { time: '00:00', val: 320, pct: 16 },
    { time: '01:00', val: 410, pct: 20 },
    { time: '02:00', val: 280, pct: 14 },
    { time: '03:00', val: 520, pct: 26 },
    { time: '04:00', val: 680, pct: 34 },
    { time: '05:00', val: 490, pct: 24 },
    { time: '06:00', val: 890, pct: 45 },
    { time: '07:00', val: 1100, pct: 55 },
    { time: '08:00', val: 950, pct: 48 },
    { time: '09:00', val: 780, pct: 39 },
    { time: '10:00', val: 1250, pct: 62 },
    { time: '11:00', val: 1420, pct: 71 },
    { time: '12:00', val: 1850, pct: 92 },
    { time: '13:00', val: 1620, pct: 81 },
    { time: '14:00', val: 1180, pct: 59 },
    { time: '15:00', val: 1260, pct: 63 },
    { time: '16:00', val: 790, pct: 40 },
    { time: '17:00', val: 620, pct: 31 },
    { time: '18:00', val: 540, pct: 27 },
    { time: '19:00', val: 710, pct: 36 },
    { time: '20:00', val: 920, pct: 46 },
    { time: '21:00', val: 1050, pct: 52 },
    { time: '22:00', val: 1210, pct: 60 },
    { time: '23:00', val: 890, pct: 44 },
  ];

  const topEndpoints = [
    { path: '/api/login', hits: '8,421', pct: 84 },
    { path: '/api/register', hits: '5,210', pct: 52 },
    { path: '/api/upload', hits: '3,872', pct: 39 },
    { path: '/api/search', hits: '2,115', pct: 21 },
    { path: '/api/data', hits: '1,904', pct: 19 },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 font-sans">
      {/* Rate Limit Hits (Last 24 Hours) Bar Chart */}
      <div className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] p-4 space-y-4 shadow-sm dark:shadow-none">
        <h3 className="text-xs font-semibold text-slate-900 dark:text-white uppercase tracking-wider font-sans">
          Rate Limit Hits (Last 24 Hours)
        </h3>

        <div className="flex gap-3 h-44 pt-2">
          {/* Y Axis Labels */}
          <div className="flex flex-col justify-between text-[10px] text-slate-400 dark:text-slate-500 text-right w-9 select-none">
            <span>2,000</span>
            <span>1,500</span>
            <span>1,000</span>
            <span>500</span>
            <span>0</span>
          </div>

          {/* Chart Bars Area */}
          <div className="flex-1 flex flex-col justify-end">
            <div className="h-full flex items-end justify-between gap-1 border-b border-l border-slate-200 dark:border-[#1C293D] px-1 pb-0.5">
              {hourlyData.map((item, idx) => (
                <div
                  key={idx}
                  className="flex-1 bg-cyan-500/80 hover:bg-cyan-400 dark:bg-cyan-600/80 dark:hover:bg-cyan-400 transition-colors rounded-t-[1px]"
                  style={{ height: `${item.pct}%` }}
                  title={`${item.time}: ${item.val} hits`}
                />
              ))}
            </div>

            {/* X Axis Time Labels */}
            <div className="flex justify-between text-[10px] text-slate-400 dark:text-slate-500 pt-1.5 px-1 select-none">
              <span>00:00</span>
              <span>04:00</span>
              <span>08:00</span>
              <span>12:00</span>
              <span>16:00</span>
              <span>20:00</span>
            </div>
          </div>
        </div>
      </div>

      {/* Top Endpoints by Rate Limit Hits Progress Bars */}
      <div className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] p-4 space-y-4 shadow-sm dark:shadow-none">
        <h3 className="text-xs font-semibold text-slate-900 dark:text-white uppercase tracking-wider font-sans">
          Top Endpoints by Rate Limit Hits
        </h3>

        <div className="space-y-3.5 pt-2">
          {topEndpoints.map((ep) => (
            <div key={ep.path} className="flex items-center gap-3 text-xs">
              <span className="w-28 text-slate-700 dark:text-slate-300 truncate text-[11px] font-mono">
                {ep.path}
              </span>

              {/* Progress track */}
              <div className="flex-1 bg-slate-100 dark:bg-[#111A29] border border-slate-200 dark:border-[#1C293D] h-2 rounded-sm overflow-hidden">
                <div
                  className="bg-rose-500/90 h-full"
                  style={{ width: `${ep.pct}%` }}
                />
              </div>

              <span className="w-12 text-right text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                {ep.hits}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
