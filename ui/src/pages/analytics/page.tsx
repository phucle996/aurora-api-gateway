import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  analyticsApi,
  AnalyticsQueryItem,
  AnalyticsSeries,
  MetricCatalogCategory,
  TelemetrySourceInfo,
} from '../../lib/api/analytics';
import { AnalyticsHeader, TimeRangePreset } from './components/AnalyticsHeader';
import { PresetSelector, PresetType, PRESET_DEFINITIONS } from './components/PresetSelector';
import { QueryBuilder } from './components/QueryBuilder';
import { TimeSeriesCanvas } from './components/TimeSeriesCanvas';
import { ConnectionsTab } from './components/ConnectionsTab';
import { LineChart, PlugZap } from 'lucide-react';

export default function AnalyticsPage() {
  const [activeMainTab, setActiveMainTab] = useState<'explorer' | 'connections'>('explorer');

  const [sources, setSources] = useState<TelemetrySourceInfo[]>([]);
  const [categories, setCategories] = useState<MetricCatalogCategory[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>('prometheus');

  // Controls State
  const [timeRange, setTimeRange] = useState<TimeRangePreset>('1h');
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(30); // 30s default
  const [activePreset, setActivePreset] = useState<PresetType>('traffic');

  // Query State
  const [queries, setQueries] = useState<AnalyticsQueryItem[]>(
    PRESET_DEFINITIONS[0].queries
  );
  const [isRawMode, setIsRawMode] = useState<boolean>(false);
  const [rawPromQL, setRawPromQL] = useState<string>('sum(rate(nginx_http_requests_total[1m]))');

  // Data & Execution State
  const [series, setSeries] = useState<AnalyticsSeries[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Convert TimeRangePreset to seconds
  const getTimeBounds = useCallback(() => {
    const now = Math.floor(Date.now() / 1000);
    let duration = 3600; // 1h
    let step = 15;

    switch (timeRange) {
      case '15m':
        duration = 900;
        step = 5;
        break;
      case '1h':
        duration = 3600;
        step = 15;
        break;
      case '6h':
        duration = 21600;
        step = 60;
        break;
      case '24h':
        duration = 86400;
        step = 300;
        break;
      case '7d':
        duration = 604800;
        step = 1800;
        break;
    }

    return {
      start: now - duration,
      end: now,
      step_seconds: step,
    };
  }, [timeRange]);

  // Load Catalog on mount
  const refreshCatalog = useCallback(() => {
    analyticsApi
      .getCatalog()
      .then((res) => {
        setSources(res.sources || []);
        setCategories(res.categories || []);
        if (res.sources && res.sources.length > 0) {
          setSelectedSourceId(res.sources[0].id);
        }
      })
      .catch((err) => {
        console.error('Failed to load metric catalog', err);
      });
  }, []);

  useEffect(() => {
    refreshCatalog();
  }, [refreshCatalog]);

  // Run Query
  const executeQuery = useCallback(() => {
    if (activeMainTab !== 'explorer') return;

    const { start, end, step_seconds } = getTimeBounds();
    setIsLoading(true);
    setError(null);

    if (isRawMode) {
      if (!rawPromQL.trim()) {
        setIsLoading(false);
        return;
      }
      analyticsApi
        .queryRaw({
          source_id: selectedSourceId,
          query: rawPromQL.trim(),
          start,
          end,
          step_seconds,
        })
        .then((res) => {
          setSeries(res.series || []);
        })
        .catch((err) => {
          const msg =
            err?.data?.message ||
            err?.data?.error ||
            err?.message ||
            'Lỗi truy vấn PromQL từ máy chủ Prometheus';
          setError(msg);
          setSeries([]);
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else {
      if (!queries || queries.length === 0) {
        setIsLoading(false);
        return;
      }
      analyticsApi
        .query({
          source_id: selectedSourceId,
          queries,
          start,
          end,
          step_seconds,
        })
        .then((res) => {
          setSeries(res.series || []);
        })
        .catch((err) => {
          const msg =
            err?.data?.message ||
            err?.data?.error ||
            err?.message ||
            'Không thể lấy số liệu từ máy chủ metrics';
          setError(msg);
          setSeries([]);
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [activeMainTab, selectedSourceId, isRawMode, rawPromQL, queries, getTimeBounds]);

  // Handle Preset Selection
  const handleSelectPreset = (presetId: PresetType) => {
    setActivePreset(presetId);
    const def = PRESET_DEFINITIONS.find((p) => p.id === presetId);
    if (def && def.queries.length > 0) {
      setQueries(def.queries);
      setIsRawMode(false);
    }
  };

  // Re-run on parameter change
  useEffect(() => {
    if (activeMainTab === 'explorer') {
      executeQuery();
    }
  }, [activeMainTab, timeRange, queries, isRawMode, selectedSourceId]);

  // Auto-Refresh Loop with document visibility check
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (activeMainTab !== 'explorer' || autoRefreshInterval <= 0) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    const runAutoRefresh = () => {
      if (document.visibilityState === 'visible') {
        executeQuery();
      }
    };

    timerRef.current = setInterval(runAutoRefresh, autoRefreshInterval * 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeMainTab, autoRefreshInterval, executeQuery]);

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-4 font-sans">
      {/* Main Sub-Tabs Switcher */}
      <div className="flex border-b border-border bg-muted/20 text-xs overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveMainTab('explorer')}
          className={`flex items-center gap-2 px-5 py-2.5 transition-colors whitespace-nowrap cursor-pointer ${
            activeMainTab === 'explorer'
              ? 'text-primary border-b-2 border-primary font-bold bg-card'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
          }`}
        >
          <LineChart className="w-3.5 h-3.5" />
          <span>Biểu Đồ & Truy Vấn (Explorer)</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveMainTab('connections')}
          className={`flex items-center gap-2 px-5 py-2.5 transition-colors whitespace-nowrap cursor-pointer ${
            activeMainTab === 'connections'
              ? 'text-primary border-b-2 border-primary font-bold bg-card'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
          }`}
        >
          <PlugZap className="w-3.5 h-3.5" />
          <span>Kết Nối & Nguồn Dữ Liệu (Connections & TLS/mTLS)</span>
        </button>
      </div>

      {activeMainTab === 'explorer' ? (
        <>
          {/* 1. Header Bar: Sources & Time Range */}
          <AnalyticsHeader
            sources={sources}
            selectedSourceId={selectedSourceId}
            onSelectSource={setSelectedSourceId}
            timeRange={timeRange}
            onSelectTimeRange={setTimeRange}
            autoRefreshInterval={autoRefreshInterval}
            onChangeAutoRefresh={setAutoRefreshInterval}
            onManualRefresh={executeQuery}
            isLoading={isLoading}
          />

          {/* 2. Preset Quick Dashboards */}
          <PresetSelector activePreset={activePreset} onSelectPreset={handleSelectPreset} />

          {/* 3. Visual & Raw Query Builder */}
          <QueryBuilder
            categories={categories}
            queries={queries}
            onChangeQueries={(newQ) => {
              setActivePreset('custom');
              setQueries(newQ);
            }}
            isRawMode={isRawMode}
            onToggleRawMode={(raw) => {
              setActivePreset('custom');
              setIsRawMode(raw);
            }}
            rawPromQL={rawPromQL}
            onChangeRawPromQL={setRawPromQL}
            onExecuteQuery={executeQuery}
            isLoading={isLoading}
          />

          {/* 4. Interactive Time-Series Canvas */}
          <TimeSeriesCanvas series={series} isLoading={isLoading} error={error} />
        </>
      ) : (
        <ConnectionsTab />
      )}
    </div>
  );
}
