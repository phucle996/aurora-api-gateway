import React from 'react';
import { Plus, Trash2, Code2, Layers, Play } from 'lucide-react';
import { AnalyticsQueryItem, MetricCatalogCategory } from '../../../lib/api/analytics';

interface QueryBuilderProps {
  categories: MetricCatalogCategory[];
  queries: AnalyticsQueryItem[];
  onChangeQueries: (queries: AnalyticsQueryItem[]) => void;
  isRawMode: boolean;
  onToggleRawMode: (isRaw: boolean) => void;
  rawPromQL: string;
  onChangeRawPromQL: (query: string) => void;
  onExecuteQuery: () => void;
  isLoading: boolean;
}

export function QueryBuilder({
  categories,
  queries,
  onChangeQueries,
  isRawMode,
  onToggleRawMode,
  rawPromQL,
  onChangeRawPromQL,
  onExecuteQuery,
  isLoading,
}: QueryBuilderProps) {
  const addQuery = () => {
    const nextLetter = String.fromCharCode(65 + queries.length);
    const firstMetric = categories[0]?.metrics[0]?.key || 'traffic.requests_rate';
    const newQuery: AnalyticsQueryItem = {
      id: nextLetter,
      metric_key: firstMetric,
      aggregation: 'sum',
      group_by: ['node_id'],
    };
    onChangeQueries([...queries, newQuery]);
  };

  const removeQuery = (index: number) => {
    if (queries.length <= 1) return;
    const updated = queries.filter((_, i) => i !== index);
    onChangeQueries(updated);
  };

  const updateQueryField = <K extends keyof AnalyticsQueryItem>(
    index: number,
    field: K,
    val: AnalyticsQueryItem[K]
  ) => {
    const updated = [...queries];
    updated[index] = { ...updated[index], [field]: val };
    onChangeQueries(updated);
  };

  return (
    <div className="bg-card border border-border p-4 my-3 shadow-xs">
      <div className="flex items-center justify-between border-b border-border pb-2.5 mb-3">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary" />
          <span className="text-xs font-bold uppercase tracking-wider text-foreground">
            Bảng Điều Khiển Truy Vấn (Query Inspector)
          </span>
        </div>

        {/* Mode Toggle & Run Button */}
        <div className="flex items-center gap-3">
          <div className="flex items-center border border-border bg-muted/30 p-0.5 text-xs">
            <button
              onClick={() => onToggleRawMode(false)}
              className={`px-2.5 py-0.5 font-medium transition-colors ${
                !isRawMode
                  ? 'bg-card text-foreground font-semibold shadow-2xs border border-border'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Visual Builder
            </button>
            <button
              onClick={() => onToggleRawMode(true)}
              className={`flex items-center gap-1 px-2.5 py-0.5 font-medium transition-colors ${
                isRawMode
                  ? 'bg-card text-foreground font-semibold shadow-2xs border border-border'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>PromQL Raw</span>
            </button>
          </div>

          <button
            onClick={onExecuteQuery}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3.5 py-1 bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
          >
            <Play className="w-3 h-3 fill-current" />
            <span>{isLoading ? 'Đang chạy...' : 'Thực thi Query'}</span>
          </button>
        </div>
      </div>

      {isRawMode ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Nhập biểu thức PromQL tuỳ ý:</span>
            <span className="font-mono text-[11px]">Hỗ trợ rate(), sum by(), histogram_quantile()</span>
          </div>
          <textarea
            value={rawPromQL}
            onChange={(e) => onChangeRawPromQL(e.target.value)}
            placeholder='Ví dụ: sum by (rule_id) (rate(aurora_waf_matched_total[1m]))'
            className="w-full h-20 p-3 font-mono text-xs bg-muted/30 border border-border text-foreground focus:outline-none focus:border-primary/60 resize-y"
          />
        </div>
      ) : (
        <div className="space-y-3">
          {queries.map((q, idx) => {
            // Tìm metric definition hiện tại
            let currentDef = null;
            for (const cat of categories) {
              for (const m of cat.metrics || []) {
                if (m.key === q.metric_key) {
                  currentDef = m;
                  break;
                }
              }
            }

            return (
              <div
                key={q.id || idx}
                className="flex flex-wrap items-center gap-2.5 p-2.5 bg-muted/20 border border-border/70 text-xs"
              >
                {/* Query Badge */}
                <span className="font-mono font-bold text-primary px-2 py-1 bg-primary/10 border border-primary/20 shrink-0">
                  {q.id || String.fromCharCode(65 + idx)}
                </span>

                {/* Metric Key Selector */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-muted-foreground font-medium">Chỉ số:</span>
                  <select
                    value={q.metric_key}
                    onChange={(e) => updateQueryField(idx, 'metric_key', e.target.value)}
                    className="bg-card border border-border px-2 py-1 text-xs text-foreground font-medium focus:outline-none"
                  >
                    {categories.map((cat) => (
                      <optgroup key={cat.id} label={cat.name}>
                        {(cat.metrics || []).map((m) => (
                          <option key={m.key} value={m.key}>
                            {m.name} ({m.unit})
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                {/* Aggregation Selector */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-muted-foreground font-medium">Gộp:</span>
                  <select
                    value={q.aggregation || 'sum'}
                    onChange={(e) => updateQueryField(idx, 'aggregation', e.target.value)}
                    className="bg-card border border-border px-2 py-1 text-xs text-foreground font-medium focus:outline-none"
                  >
                    {(currentDef?.supported_aggregations || ['sum', 'avg', 'max', 'min']).map((agg: string) => (
                      <option key={agg} value={agg}>
                        {agg.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Group By */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-muted-foreground font-medium">Gom theo:</span>
                  <select
                    value={(q.group_by && q.group_by[0]) || ''}
                    onChange={(e) =>
                      updateQueryField(idx, 'group_by', e.target.value ? [e.target.value] : [])
                    }
                    className="bg-card border border-border px-2 py-1 text-xs text-foreground font-medium focus:outline-none"
                  >
                    <option value="">(Không gom nhóm)</option>
                    {(currentDef?.supported_group_by || ['node_id', 'status', 'action']).map((grp: string) => (
                      <option key={grp} value={grp}>
                        {grp}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Filter Node */}
                <div className="flex items-center gap-1.5 flex-1 min-w-[140px]">
                  <span className="text-muted-foreground font-medium">Lọc Node:</span>
                  <input
                    type="text"
                    placeholder="Mọi node hoặc node-id"
                    value={q.filters?.node_id || ''}
                    onChange={(e) => {
                      const newFilters = { ...(q.filters || {}) };
                      if (e.target.value) {
                        newFilters.node_id = e.target.value;
                      } else {
                        delete newFilters.node_id;
                      }
                      updateQueryField(idx, 'filters', newFilters);
                    }}
                    className="flex-1 bg-card border border-border px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                </div>

                {/* Remove button */}
                {queries.length > 1 && (
                  <button
                    onClick={() => removeQuery(idx)}
                    className="p-1 text-muted-foreground hover:text-red-500 transition-colors"
                    title="Xóa truy vấn này"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })}

          {/* Add Query Button */}
          <div className="pt-1">
            <button
              onClick={addQuery}
              className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground border border-dashed border-border hover:border-primary/50 bg-muted/20 transition-all cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Thêm dòng Query (+ Add Query)</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
