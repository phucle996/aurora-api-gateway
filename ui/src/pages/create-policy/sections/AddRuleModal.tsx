import React, { useState, useMemo, useEffect } from 'react';
import { Search, X, SlidersHorizontal, Check } from 'lucide-react';

export interface CatalogRule {
  id: number;
  name: string;
  action: string;
  group?: string;
}

interface AddRuleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveRules: (selectedIds: number[]) => void;
  catalog: CatalogRule[];
  selectedRuleIds: number[];
}

export function AddRuleModal({
  isOpen,
  onClose,
  onSaveRules,
  catalog,
  selectedRuleIds,
}: AddRuleModalProps) {
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // Sync selectedIds whenever modal opens or initial selection changes
  useEffect(() => {
    if (isOpen) {
      setSelectedIds(selectedRuleIds);
      setSearch('');
    }
  }, [isOpen, selectedRuleIds]);

  // Filter catalog items
  const filteredCatalog = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.group && r.group.toLowerCase().includes(q)) ||
        r.action.toLowerCase().includes(q)
    );
  }, [catalog, search]);

  if (!isOpen) return null;

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleConfirm = () => {
    onSaveRules(selectedIds);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div
        className="bg-card border border-border w-full max-w-xl rounded-sm shadow-2xl overflow-hidden font-sans flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xs bg-primary/10 border border-primary/20 text-primary">
              <SlidersHorizontal className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Edit Policy Rules
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Select or deselect security rules from your catalog to include in this policy.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-muted rounded-xs transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-3 border-b border-border bg-muted/20">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by rule name, group (sqli, xss...), or action..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-background border border-input rounded-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:border-primary"
            />
          </div>
        </div>

        {/* Rules List */}
        <div className="overflow-y-auto p-3 space-y-1.5 flex-1">
          {filteredCatalog.length === 0 ? (
            <div className="py-8 text-center text-slate-400 dark:text-slate-500 text-xs">
              {catalog.length === 0
                ? 'No rules found in catalog.'
                : 'No catalog rules match your search.'}
            </div>
          ) : (
            filteredCatalog.map((item) => {
              const isSelected = selectedIds.includes(item.id);

              return (
                <div
                  key={item.id}
                  onClick={() => toggleSelect(item.id)}
                  className={`flex items-center justify-between p-3 rounded-sm border transition-all text-xs cursor-pointer ${
                    isSelected
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-input bg-card'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(item.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded-xs border-input text-primary focus:ring-primary cursor-pointer"
                    />

                    <div>
                      <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                        <span>{item.name}</span>
                        {item.group && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-xs bg-muted text-muted-foreground">
                            {item.group}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 font-mono">
                        ID: #{item.id} • Action:{' '}
                        <span
                          className={
                            item.action.toLowerCase() === 'allow'
                              ? 'text-emerald-500 font-medium'
                              : item.action.toLowerCase() === 'block'
                              ? 'text-rose-500 font-medium'
                              : 'text-amber-500 font-medium'
                          }
                        >
                          {item.action.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    {isSelected ? (
                      <span className="text-[11px] px-2 py-0.5 rounded-xs bg-primary/10 text-primary font-medium border border-primary/20">
                        Included
                      </span>
                    ) : (
                      <span className="text-[11px] px-2 py-0.5 rounded-xs bg-muted text-muted-foreground font-medium">
                        Excluded
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-muted/40">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            <strong className="text-slate-900 dark:text-white">{selectedIds.length}</strong> of {catalog.length} rules selected
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-sm transition-colors cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleConfirm}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-sm shadow-xs transition-all cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Save Rules ({selectedIds.length})</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
