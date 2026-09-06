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
  return (
    <section aria-label="Global rule statistics" className="space-y-2">
      <p className="text-xs text-muted-foreground">{stats ? `All saved rules · independent of table filters · Read at ${stats.as_of} · comparison: end of previous calendar month (UTC)` : 'All saved rules · Statistics unavailable while loading or after a failed request.'}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {cards.map(({label, count, delta}) => (
          <div key={label} aria-label={label} className="bg-card border border-border p-4 font-sans shadow-xs rounded-sm transition-colors">
            <p className="text-xs text-muted-foreground font-medium">{label}</p>
            <p className="text-2xl text-foreground mt-1.5 font-bold tracking-tight">{count ?? '—'}</p>
            <p className="text-[11px] text-muted-foreground mt-2 font-normal" title={stats ? `Baseline: latest revision strictly before ${stats.comparison_before}` : undefined}>
              {!stats ? '—' : !stats.history_available || delta == null ? 'Insufficient history for last-month comparison' : `${delta > 0 ? '+' : ''}${delta} vs. end of last month`}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
