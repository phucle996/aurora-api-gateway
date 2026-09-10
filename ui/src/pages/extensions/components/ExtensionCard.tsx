import React from 'react';
import { ExtensionItem } from '../types';
import { ExtensionIcon } from './ExtensionIcon';
import { CATEGORIES_META } from '../data/catalog';
import { Settings2, RotateCw, Tag } from 'lucide-react';

interface ExtensionCardProps {
  extension: ExtensionItem;
  onToggle: (id: string, enabled: boolean) => void;
  onConfigure: (ext: ExtensionItem) => void;
  isToggling?: boolean;
}

export function ExtensionCard({
  extension,
  onToggle,
  onConfigure,
  isToggling = false,
}: ExtensionCardProps) {
  const meta = CATEGORIES_META[extension.category as keyof typeof CATEGORIES_META] || {
    label: extension.category,
    badgeClass: 'bg-muted text-muted-foreground border-border',
    iconBgClass: 'bg-muted text-muted-foreground',
    borderClass: 'border-border',
  };

  return (
    <div
      className={`group relative bg-card/85 backdrop-blur-xs border rounded-lg p-4 flex flex-col justify-between transition-all duration-200 hover:shadow-md ${
        extension.enabled
          ? 'border-primary/40 shadow-xs ring-1 ring-primary/10'
          : 'border-border/70 opacity-85 hover:opacity-100 hover:border-border'
      }`}
    >
      {/* Top row: Icon + Title + Status Switch */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`p-2.5 rounded-lg ${meta.iconBgClass} transition-transform duration-200 group-hover:scale-105 shrink-0 shadow-2xs`}
            >
              <ExtensionIcon id={extension.id} category={extension.category} className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-sm text-foreground truncate" title={extension.name}>
                {extension.name}
              </h3>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="font-mono text-[10px] text-muted-foreground bg-muted/70 px-1.5 py-0.5 rounded-xs">
                  {extension.id}
                </span>
                <span className="text-[10px] text-muted-foreground/80 font-mono">
                  v{extension.version}
                </span>
              </div>
            </div>
          </div>

          {/* Switch toggle */}
          <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
            {isToggling ? (
              <RotateCw className="w-4 h-4 animate-spin text-primary" />
            ) : (
              <button
                type="button"
                role="switch"
                aria-checked={extension.enabled}
                title={extension.enabled ? 'Click to disable' : 'Click to enable'}
                onClick={() => onToggle(extension.id, !extension.enabled)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-1 focus:ring-primary ${
                  extension.enabled ? 'bg-emerald-500 shadow-xs' : 'bg-muted/80'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                    extension.enabled ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            )}
          </div>
        </div>

        {/* Description */}
        <p
          className="mt-3 text-xs text-muted-foreground line-clamp-2 leading-relaxed h-8"
          title={extension.description}
        >
          {extension.description}
        </p>

        {/* Tags preview if any */}
        {extension.tags && extension.tags.length > 0 && (
          <div className="mt-2.5 flex items-center gap-1 overflow-hidden">
            <Tag className="w-3 h-3 text-muted-foreground/60 shrink-0" />
            <div className="flex items-center gap-1 overflow-x-hidden">
              {extension.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="text-[9px] text-muted-foreground/70 bg-muted/40 px-1.5 py-0.2 rounded-xs whitespace-nowrap font-mono"
                >
                  #{tag}
                </span>
              ))}
              {extension.tags.length > 3 && (
                <span className="text-[9px] text-muted-foreground/50 font-mono">
                  +{extension.tags.length - 3}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer: Category & Built-in badge + Configure button */}
      <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-medium border uppercase tracking-wider ${meta.badgeClass}`}
          >
            {meta.label}
          </span>
          {extension.is_builtin ? (
            <span className="px-1.5 py-0.5 rounded-xs text-[10px] bg-muted/80 text-muted-foreground font-mono">
              Core
            </span>
          ) : (
            <span className="px-1.5 py-0.5 rounded-xs text-[10px] bg-primary/10 text-primary font-mono">
              Custom
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => onConfigure(extension)}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 px-2 py-1 rounded-sm transition-colors cursor-pointer border border-border/40 hover:border-border"
        >
          <Settings2 className="w-3.5 h-3.5" />
          <span>Config</span>
        </button>
      </div>
    </div>
  );
}
