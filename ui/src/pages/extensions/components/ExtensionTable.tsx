import React from 'react';
import { ExtensionItem } from '../types';
import { ExtensionIcon } from './ExtensionIcon';
import { CATEGORIES_META } from '../data/catalog';
import { Settings2, RotateCw } from 'lucide-react';

interface ExtensionTableProps {
  extensions: ExtensionItem[];
  onToggle: (id: string, enabled: boolean) => void;
  onConfigure: (ext: ExtensionItem) => void;
  togglingIds: Record<string, boolean>;
}

export function ExtensionTable({
  extensions,
  onToggle,
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
                  className={`group hover:bg-muted/40 transition-colors duration-200 ${!ext.enabled ? 'opacity-80 hover:opacity-100' : ''
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
                          <span className="truncate group-hover:text-primary transition-colors duration-150">{ext.name}</span>
                          <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.2 rounded-xs shrink-0">
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
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium border uppercase tracking-wider transition-transform duration-150 inline-block group-hover:scale-105 ${meta.badgeClass}`}
                    >
                      {meta.label}
                    </span>
                  </td>

                  {/* Type & Version */}
                  <td className="py-3 px-4 whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <span>v{ext.version}</span>
                      <span className="text-[10px] bg-muted px-1.5 py-0.2 rounded-xs">
                        {ext.is_builtin ? 'Core' : 'Custom'}
                      </span>
                    </div>
                  </td>

                  {/* Status Toggle */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      {isToggling ? (
                        <RotateCw className="w-4 h-4 animate-spin text-primary" />
                      ) : (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={ext.enabled}
                          onClick={() => onToggle(ext.id, !ext.enabled)}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-all duration-300 ease-in-out hover:scale-105 active:scale-95 focus:outline-none focus:ring-1 focus:ring-primary ${ext.enabled ? 'bg-emerald-500 shadow-xs' : 'bg-muted/80'
                            }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${ext.enabled ? 'translate-x-4' : 'translate-x-0'
                              }`}
                          />
                        </button>
                      )}
                      <span
                        className={`text-[11px] font-medium transition-colors duration-200 ${ext.enabled
                            ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                            : 'text-muted-foreground'
                          }`}
                      >
                        {ext.enabled ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                  </td>

                  {/* Actions */}
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => onConfigure(ext)}
                      className="group/btn inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted/80 px-2.5 py-1 rounded-sm transition-all duration-150 active:scale-95 cursor-pointer border border-border/60 shadow-2xs"
                    >
                      <Settings2 className="w-3.5 h-3.5 transition-transform duration-300 group-hover/btn:rotate-45" />
                      <span>Configure</span>
                    </button>
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
