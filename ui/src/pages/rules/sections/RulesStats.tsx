export interface RulesStatsData {
  total: number; enabled: number; log: number; block: number;
  total_delta: number | null; enabled_delta: number | null; log_delta: number | null; block_delta: number | null;
  history_available: boolean; as_of: string; comparison_before: string;
}
export function RulesStats({ stats }: { stats: RulesStatsData | null }) {
  const cards = [
    { label: 'Total saved rules', count: stats?.total, delta: stats?.total_delta },
    { label: 'Enabled definitions', count: stats?.enabled, delta: stats?.enabled_delta },
    { label: 'Enabled log rules', count: stats?.log, delta: stats?.log_delta },
    { label: 'Enabled block rules', count: stats?.block, delta: stats?.block_delta },
  ];
  return <section aria-label="Global rule statistics" className="space-y-2">
    <p className="text-xs text-slate-400">All saved rules · independent of table filters · {stats ? `Read at ${stats.as_of} · comparison: end of previous calendar month (UTC)` : 'Statistics unavailable while loading or after a failed request.'}</p>
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
    {cards.map(({label, count, delta}) =>
      <div key={label} aria-label={label} className="bg-[#0B1320] border border-[#172338] p-4 font-mono">
        <p className="text-xs text-slate-400">{label}</p>
        <p className="text-2xl text-white mt-2">{count ?? '—'}</p>
        <p className="text-xs text-slate-400 mt-2" title={stats ? `Baseline: latest revision strictly before ${stats.comparison_before}` : undefined}>
          {!stats ? '—' : !stats.history_available || delta == null ? 'Insufficient history for last-month comparison' : `${delta > 0 ? '+' : ''}${delta} vs. end of last month`}
        </p>
      </div>)}
    </div>
  </section>;
}
