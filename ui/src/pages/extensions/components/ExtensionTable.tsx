import React from 'react';
import { ExtensionItem } from '../types';
import { ExtensionIcon } from './ExtensionIcon';
import { CATEGORIES_META } from '../data/catalog';

interface ExtensionTableProps {
  extensions: ExtensionItem[];
  onToggle: (id: string, enabled: boolean) => void;
  onConfigure: (ext: ExtensionItem) => void;
  togglingIds: Record<string, boolean>;
}

export function ExtensionTable({
  extensions,
  onConfigure,
  togglingIds,
}: ExtensionTableProps) {
  return (
    <div className="bg-card border border-border/80 rounded-lg overflow-hidden shadow-xs">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-muted/40 border-b border-border text-muted-foreground uppercase font-mono text-[10px] tracking-wider">
            <tr>
              <th className="py-3 px-4 w-5/12">Extension</th>
              <th className="py-3 px-4 w-2/12">Group / Category</th>
              <th className="py-3 px-4 w-2/12">Type & Version</th>
              <th className="py-3 px-4 w-2/12">Status</th>
              <th className="py-3 px-4 w-1/12 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {extensions.map((ext) => {
              const isToggling = Boolean(togglingIds[ext.id]);
              const meta = CATEGORIES_META[ext.category as keyof typeof CATEGORIES_META] || {
                label: ext.category,
                badgeClass: 'bg-muted text-muted-foreground border-border',
              };

              return (
                <tr
                  key={ext.id}
                  onClick={() => onConfigure(ext)}
                  className={`group hover:bg-muted/40 transition-colors duration-200 cursor-pointer ${!ext.enabled ? 'opacity-80 hover:opacity-100' : ''
                    }`}
                >
                  {/* Extension Name & ID */}
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-md bg-muted/60 shrink-0 text-foreground transition-transform duration-200 group-hover:scale-110">
                        <ExtensionIcon id={ext.id} category={ext.category} className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-foreground flex items-center gap-2">
                          <span className="truncate group-hover:text-primary transition-colors duration-150">
                            {ext.name}
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-none shrink-0">
                            {ext.id}
                          </span>
                          {ext.enabled && (
                            <span className="relative flex h-2 w-2 shrink-0">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5" title={ext.description}>
                          {ext.description}
                        </p>
                      </div>
                    </div>
                  </td>

                  {/* Category */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    <span
                      className={`px-2.5 py-0.5 rounded-none text-[10px] font-medium border uppercase tracking-wider transition-transform duration-150 inline-block group-hover:scale-105 ${meta.badgeClass}`}
                    >
                      {meta.label}
                    </span>
                  </td>

                  {/* Type & Version */}
                  <td className="py-3 px-4 whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <span>v{ext.version}</span>
                      <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-none">
                        {ext.is_builtin ? 'Core' : 'Custom'}
                      </span>
                    </div>
                  </td>

                  {/* Status */}
                  <td className="py-3 px-4 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium border ${ext.enabled
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 font-semibold'
                          : 'bg-muted/50 text-muted-foreground border-border'
                          }`}
                      >
                        {ext.enabled && (
                          <span className="relative flex h-1.5 w-1.5 shrink-0">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                          </span>
                        )}
                        {ext.enabled ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                  </td>

                  {/* Actions: View cue */}
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <span className="text-xs text-muted-foreground group-hover:text-primary transition-colors flex items-center justify-end gap-1 font-medium">
                      <span>Mở</span>
                      <span>→</span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
