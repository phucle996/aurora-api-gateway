import React, { useState, useMemo } from 'react';
import { Search, X, ShieldPlus, Plus } from 'lucide-react';

interface CatalogRule {
  id: number;
  name: string;
  action: string;
  group?: string;
}

interface AddRuleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddRules: (rules: CatalogRule[]) => void;
  catalog: CatalogRule[];
  existingRuleIds: number[];
}

export function AddRuleModal({
  isOpen,
  onClose,
  onAddRules,
  catalog,
  existingRuleIds,
}: AddRuleModalProps) {
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

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
    const selectedRules = catalog.filter((r) => selectedIds.includes(r.id));
    if (selectedRules.length > 0) {
      onAddRules(selectedRules);
    }
    setSelectedIds([]);
    setSearch('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div
        className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#1C293D] w-full max-w-xl rounded-sm shadow-2xl overflow-hidden font-mono flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-[#1C293D] bg-slate-50/50 dark:bg-[#080E18]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xs bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-900/60 text-blue-600 dark:text-blue-400">
              <ShieldPlus className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Add Rules from Catalog
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Select real security rules from your catalog to include in this policy.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#152030] rounded-xs transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-3 border-b border-slate-200 dark:border-[#1C293D] bg-slate-50/30 dark:bg-[#080E18]/50">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by rule name, group (sqli, xss...), or action..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#1C293D] rounded-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:border-blue-500"
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
              const isAlreadyAdded = existingRuleIds.includes(item.id);
              const isSelected = selectedIds.includes(item.id);

              return (
                <div
                  key={item.id}
                  onClick={() => {
                    if (!isAlreadyAdded) toggleSelect(item.id);
                  }}
                  className={`flex items-center justify-between p-3 rounded-sm border transition-all text-xs ${
                    isAlreadyAdded
                      ? 'border-slate-200 dark:border-[#172338] bg-slate-50/40 dark:bg-[#080E18]/40 opacity-60 cursor-not-allowed'
                      : isSelected
                      ? 'border-blue-400 dark:border-blue-500 bg-blue-50/30 dark:bg-blue-950/20 cursor-pointer'
                      : 'border-slate-200 dark:border-[#172338] hover:border-slate-300 dark:hover:border-[#1C293D] bg-white dark:bg-[#0B1320] cursor-pointer'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={isSelected || isAlreadyAdded}
                      disabled={isAlreadyAdded}
                      onChange={() => {}}
                      className="rounded-xs border-slate-300 dark:border-[#1C293D] text-blue-600 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed"
                    />

                    <div>
                      <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                        <span>{item.name}</span>
                        {item.group && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-xs bg-slate-100 dark:bg-[#152030] text-slate-600 dark:text-slate-300">
                            {item.group}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                        ID: #{item.id} • Action:{' '}
                        <span
                          className={
                            item.action === 'allow'
                              ? 'text-emerald-500 font-medium'
                              : item.action === 'block'
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
                    {isAlreadyAdded ? (
                      <span className="text-[11px] px-2 py-0.5 rounded-xs bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-medium">
                        Added
                      </span>
                    ) : isSelected ? (
                      <span className="text-[11px] px-2 py-0.5 rounded-xs bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-medium">
                        Selected
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 dark:border-[#1C293D] bg-slate-50/50 dark:bg-[#080E18]">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {selectedIds.length} rule{selectedIds.length === 1 ? '' : 's'} selected
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#152030] rounded-sm transition-colors cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleConfirm}
              disabled={selectedIds.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-sm shadow-xs transition-all cursor-pointer disabled:cursor-not-allowed"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Selected ({selectedIds.length})</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
