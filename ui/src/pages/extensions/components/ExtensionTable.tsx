import React from 'react';
import { ExtensionItem } from '../types';
import { ExtensionIcon } from './ExtensionIcon';
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
  const getCategoryClass = (cat: string) => {
    switch (cat) {
      case 'security':
        return 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20';
      case 'observability':
        return 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20';
      case 'traffic':
        return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20';
      case 'auth':
        return 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20';
      case 'runtime':
        return 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20';
      default:
        return 'bg-muted text-muted-foreground border-border';
    }
  };

  return (
    <div className="bg-card border border-border/80 rounded-md overflow-hidden shadow-xs">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-muted/40 border-b border-border text-muted-foreground uppercase font-mono text-[10px] tracking-wider">
            <tr>
              <th className="py-3 px-4">Extension</th>
              <th className="py-3 px-4">Category</th>
              <th className="py-3 px-4">Type & Version</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {extensions.map((ext) => {
              const isToggling = Boolean(togglingIds[ext.id]);

              return (
                <tr
                  key={ext.id}
                  className={`hover:bg-muted/30 transition-colors ${
                    !ext.enabled ? 'opacity-75 hover:opacity-100' : ''
                  }`}
                >
                  {/* Extension Name & ID */}
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-md bg-muted/60 shrink-0 text-foreground">
                        <ExtensionIcon id={ext.id} category={ext.category} className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 max-w-sm sm:max-w-md">
                        <div className="font-semibold text-foreground flex items-center gap-2">
                          <span className="truncate">{ext.name}</span>
                          <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.2 rounded-xs">
                            {ext.id}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                          {ext.description}
                        </p>
                      </div>
                    </div>
                  </td>

                  {/* Category */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium border uppercase tracking-wider ${getCategoryClass(
                        ext.category
                      )}`}
                    >
                      {ext.category}
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
                        <RotateCw className="w-4 h-4 animate-spin text-muted-foreground" />
                      ) : (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={ext.enabled}
                          onClick={() => onToggle(ext.id, !ext.enabled)}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-1 focus:ring-primary ${
                            ext.enabled ? 'bg-emerald-500' : 'bg-muted/80'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                              ext.enabled ? 'translate-x-4' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      )}
                      <span
                        className={`text-[11px] font-medium ${
                          ext.enabled
                            ? 'text-emerald-600 dark:text-emerald-400'
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
                      className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted px-2.5 py-1 rounded-sm transition-colors cursor-pointer border border-border/60"
                    >
                      <Settings2 className="w-3.5 h-3.5" />
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
