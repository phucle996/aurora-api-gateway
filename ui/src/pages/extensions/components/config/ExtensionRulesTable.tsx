import React from 'react';
import {
  Table as TableIcon,
  Plus,
  Edit3,
  Trash2,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

interface ExtensionRulesTableProps {
  rules: any[];
  tableColumns?: { key: string; label: string }[];
  onOpenAddRule: () => void;
  onOpenEditRule: (rule: any, index: number) => void;
  onDeleteRule: (index: number) => void;
  onToggleRule: (index: number) => void;
}

export function ExtensionRulesTable({
  rules,
  tableColumns,
  onOpenAddRule,
  onOpenEditRule,
  onDeleteRule,
  onToggleRule,
}: ExtensionRulesTableProps) {
  const columns = (tableColumns || [
    { key: 'match_type', label: 'Match' },
    { key: 'action', label: 'Action' },
  ]).filter((c) => c.key !== 'name' && c.key !== 'enabled');

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-xs space-y-4">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
            <TableIcon className="w-4 h-4 text-primary" />
            <span>Policy Rules & Route Exceptions</span>
          </h4>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Granular route-level overrides and conditions for this extension.
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenAddRule}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer shadow-xs"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Policy Rule</span>
        </button>
      </div>

      {/* Table */}
      <div className="border border-border/80 rounded-lg overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-muted/40 border-b border-border text-muted-foreground uppercase font-mono text-[10px] tracking-wider">
            <tr>
              <th className="py-2.5 px-3 w-12 text-center">Active</th>
              <th className="py-2.5 px-3">Rule Name</th>
              {columns.map((col) => (
                <th key={col.key} className="py-2.5 px-3">
                  {col.label}
                </th>
              ))}
              <th className="py-2.5 px-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rules.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 3}
                  className="py-6 text-center text-muted-foreground italic text-xs"
                >
                  No specific rules configured. Extension parameters above apply globally.
                </td>
              </tr>
            ) : (
              rules.map((rule, idx) => (
                <tr
                  key={rule.id || idx}
                  className="hover:bg-muted/30 transition-colors"
                >
                  <td className="py-2.5 px-3 text-center">
                    <button
                      type="button"
                      onClick={() => onToggleRule(idx)}
                      className="cursor-pointer hover:scale-110 active:scale-95 transition-transform"
                    >
                      {rule.enabled !== false ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <XCircle className="w-4 h-4 text-muted-foreground" />
                      )}
                    </button>
                  </td>
                  <td className="py-2.5 px-3 font-medium text-foreground">
                    {rule.name || rule.pattern || `Rule #${idx + 1}`}
                  </td>
                  {columns.map((col) => {
                    const val = rule[col.key];
                    if (typeof val === 'boolean') {
                      return (
                        <td key={col.key} className="py-2.5 px-3">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              val
                                ? 'bg-emerald-500/10 text-emerald-600'
                                : 'bg-muted text-muted-foreground'
                            }`}
                          >
                            {val ? 'Yes' : 'No'}
                          </span>
                        </td>
                      );
                    }
                    if (Array.isArray(val)) {
                      return (
                        <td
                          key={col.key}
                          className="py-2.5 px-3 font-mono text-[11px] text-muted-foreground truncate max-w-[160px]"
                          title={val.join(', ')}
                        >
                          {val.length > 0 ? val.join(', ') : '—'}
                        </td>
                      );
                    }
                    return (
                      <td
                        key={col.key}
                        className="py-2.5 px-3 font-mono text-[11px] text-muted-foreground"
                      >
                        {String(val ?? '—')}
                      </td>
                    );
                  })}
                  <td className="py-2.5 px-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => onOpenEditRule(rule, idx)}
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
                        title="Edit"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteRule(idx)}
                        className="p-1 rounded text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
