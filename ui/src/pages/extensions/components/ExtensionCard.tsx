import React from 'react';
import { ExtensionItem } from '../types';
import { ExtensionIcon } from './ExtensionIcon';
import { CATEGORIES_META } from '../data/catalog';
import { Tag } from 'lucide-react';

interface ExtensionCardProps {
  extension: ExtensionItem;
  onToggle?: (id: string, enabled: boolean) => void;
  onConfigure: (ext: ExtensionItem) => void;
  isToggling?: boolean;
  index?: number;
}

export function ExtensionCard({
  extension,
  onConfigure,
  index = 0,
}: ExtensionCardProps) {
  const meta = CATEGORIES_META[extension.category as keyof typeof CATEGORIES_META] || {
    label: extension.category,
    badgeClass: 'bg-muted text-muted-foreground border-border',
    iconBgClass: 'bg-muted text-muted-foreground',
    borderClass: 'border-border',
  };

  const delayMs = Math.min(index * 25, 400);

  return (
    <div
      style={{ animationDelay: `${delayMs}ms` }}
      className={`group relative bg-card/85 backdrop-blur-xs border rounded-lg p-4 flex flex-col justify-between transition-all duration-300 ease-out will-change-transform animate-ext-fade-in hover:-translate-y-1 hover:shadow-lg ${
        extension.enabled
          ? 'border-primary/40 shadow-xs ring-1 ring-primary/10 hover:border-primary/70 hover:shadow-primary/10'
          : 'border-border/70 opacity-85 hover:opacity-100 hover:border-border hover:shadow-muted/20'
      }`}
    >
      {/* Top glowing accent line when active */}
      {extension.enabled && (
        <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-emerald-500/80 to-transparent rounded-t-lg transition-opacity duration-300" />
      )}

      {/* Top row: Icon + Title + Status Switch */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <div
            onClick={() => onConfigure(extension)}
            className="flex items-center gap-3 min-w-0 cursor-pointer flex-1"
          >
            <div
              className={`p-2.5 rounded-lg ${meta.iconBgClass} transition-all duration-300 ease-out group-hover:scale-110 group-hover:rotate-3 shrink-0 shadow-2xs`}
            >
              <ExtensionIcon id={extension.id} category={extension.category} className="w-5 h-5 transition-transform duration-300" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <h3 className="font-semibold text-sm text-foreground truncate group-hover:text-primary transition-colors duration-200" title={extension.name}>
                  {extension.name}
                </h3>
                {extension.enabled && (
                  <span className="relative flex h-2 w-2 shrink-0" title="Active">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="font-mono text-[10px] text-muted-foreground bg-muted/70 px-1.5 py-0.5 rounded-none transition-colors group-hover:bg-muted">
                  {extension.id}
                </span>
                <span className="text-[10px] text-muted-foreground/80 font-mono">
                  v{extension.version}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Description */}
        <p
          onClick={() => onConfigure(extension)}
          className="mt-3 text-xs text-muted-foreground line-clamp-2 leading-relaxed h-8 transition-colors group-hover:text-foreground/80 cursor-pointer"
          title={extension.description}
        >
          {extension.description}
        </p>

        {/* Tags preview if any */}
        {extension.tags && extension.tags.length > 0 && (
          <div className="mt-2.5 flex items-center gap-1 overflow-hidden" onClick={() => onConfigure(extension)}>
            <Tag className="w-3 h-3 text-muted-foreground/60 shrink-0" />
            <div className="flex items-center gap-1 overflow-x-hidden">
              {extension.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="text-[9px] text-muted-foreground/70 bg-muted/40 px-1.5 py-0.5 rounded-none whitespace-nowrap font-mono hover:bg-muted transition-colors duration-150"
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

      {/* Footer: Category & Built-in badge + Click action cue */}
      <div
        onClick={() => onConfigure(extension)}
        className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between gap-2 text-xs cursor-pointer group-hover:bg-muted/10 -mx-4 -mb-4 px-4 pb-4 rounded-b-lg transition-colors"
      >
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={`px-2 py-0.5 rounded-none text-[10px] font-medium border uppercase tracking-wider transition-transform duration-200 group-hover:scale-105 ${meta.badgeClass}`}
          >
            {meta.label}
          </span>
          {extension.is_builtin ? (
            <span className="px-1.5 py-0.5 rounded-none text-[10px] bg-muted/80 text-muted-foreground font-mono">
              Core
            </span>
          ) : (
            <span className="px-1.5 py-0.5 rounded-none text-[10px] bg-primary/10 text-primary font-mono animate-pulse">
              Custom
            </span>
          )}
        </div>

        <span className="text-[11px] font-medium text-muted-foreground/80 group-hover:text-primary transition-colors flex items-center gap-1">
          <span>Chi tiết & Rules</span>
          <span className="text-xs transition-transform duration-200 group-hover:translate-x-0.5">→</span>
        </span>
      </div>
    </div>
  );
}

