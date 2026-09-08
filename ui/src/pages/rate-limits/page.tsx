import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import { RateLimitsStats } from './sections/RateLimitsStats';
import { RateLimitsCharts } from './sections/RateLimitsCharts';
import { RateLimitsTable, RateLimitRuleItem } from './sections/RateLimitsTable';
import { rateLimitsApi, RateLimitStats as RateLimitStatsType } from '../../lib/api/rate-limits';

export default function RateLimitsPage() {
  const [rules, setRules] = useState<RateLimitRuleItem[]>([]);
  const [stats, setStats] = useState<RateLimitStatsType | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All Status');
  const [typeFilter, setTypeFilter] = useState('All Types');
  const [hostFilter, setHostFilter] = useState('All Hosts');

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.allSettled([rateLimitsApi.list(), rateLimitsApi.getStats()])
      .then(([rulesRes, statsRes]) => {
        if (rulesRes.status === 'fulfilled' && rulesRes.value && rulesRes.value.items) {
          const mapped: RateLimitRuleItem[] = rulesRes.value.items.map((item: any) => ({
            id: String(item.id),
            name: item.name,
            type: 'Request',
            key: (item.enabled_dimensions || []).join(' · ').toUpperCase() || 'IP',
            limit: item.rate_limit,
            window: item.rate_unit || '1s',
            action: item.action_exceeded === 'block' ? 'BLOCK' : 'RATE LIMIT',
            scope: item.path_config?.path ? `Path: ${item.path_config.path}` : 'Global',
            status: item.status === 'Active' ? 'Active' : 'Disabled',
            description: item.description || '',
          }));
          setRules(mapped);
        }
        if (statsRes.status === 'fulfilled' && statsRes.value) {
          setStats(statsRes.value);
        }
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000); // 10s auto-refresh
    return () => clearInterval(interval);
  }, [loadData]);

  const filteredRules = rules.filter((rule) => {
    const matchesSearch =
      rule.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rule.scope.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rule.description.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus =
      statusFilter === 'All Status' || rule.status === statusFilter;

    const matchesType =
      typeFilter === 'All Types' || rule.type === typeFilter;

    return matchesSearch && matchesStatus && matchesType;
  });

  const handleResetFilters = () => {
    setSearchQuery('');
    setStatusFilter('All Status');
    setTypeFilter('All Types');
    setHostFilter('All Hosts');
  };

  const activeCount = rules.filter((r) => r.status === 'Active').length;
  const isMetricsDisabled = stats?.mode === 'disabled' || stats?.enabled === false;

  return (
    <div className="p-6 w-full space-y-4 font-sans">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-foreground tracking-tight">
              Rate Limiting
            </h1>
            <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-xs border ${
              isMetricsDisabled
                ? 'bg-muted text-muted-foreground border-border'
                : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
            }`}>
              {isMetricsDisabled ? 'METRICS DISABLED' : 'LIVE TELEMETRY'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure and manage rate limiting rules with off-main-path zero-allocation telemetry.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadData}
            title="Refresh Live Metrics"
            className="p-2 bg-card hover:bg-muted active:bg-muted/80 text-foreground border border-border rounded-sm shadow-xs transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-primary' : ''}`} />
          </button>

          <Link
            to="/rate-limits/create"
            className="bg-primary hover:bg-primary/90 active:bg-primary/80 text-primary-foreground text-xs font-semibold px-3.5 py-2 flex items-center gap-1.5 transition-colors cursor-pointer uppercase tracking-wider w-fit rounded-sm shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Create Rate Limit Rule</span>
          </Link>
        </div>
      </div>

      {/* 4 Summary Stat Cards Section */}
      <RateLimitsStats
        totalRules={rules.length}
        activeRules={activeCount}
        stats={stats}
        loading={loading}
      />

      {/* Analytics Charts Section (Ẩn hoàn toàn khi Disabled) */}
      {!isMetricsDisabled ? (
        <RateLimitsCharts
          onSelectEndpoint={(path) => setSearchQuery(path)}
          selectedEndpoint={searchQuery}
        />
      ) : (
        <div className="p-3.5 bg-muted/20 border border-dashed border-border rounded-sm flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-muted-foreground/40" />
            <span>Thu thập số liệu Rate Limiting đang ở chế độ <strong>Tắt (Disabled)</strong>. Biểu đồ vận tốc và top endpoints được ẩn.</span>
          </div>
          <Link to="/settings" className="text-primary hover:underline text-[11px] font-medium">
            Đi đến Cài đặt
          </Link>
        </div>
      )}

      {/* Rate Limits Table */}
      <RateLimitsTable
        rules={filteredRules}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        hostFilter={hostFilter}
        onHostFilterChange={setHostFilter}
        onResetFilters={handleResetFilters}
      />
    </div>
  );
}

