import React from 'react';
import { ExtensionItem } from '../types';
import { ExtensionIcon } from './ExtensionIcon';
import { Settings2, RotateCw } from 'lucide-react';

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
  const categoryTheme = {
    security: {
      bg: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
      iconBg: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    },
    observability: {
      bg: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20',
      iconBg: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
    },
    traffic: {
      bg: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
      iconBg: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    },
    auth: {
      bg: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
      iconBg: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
    },
    runtime: {
      bg: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
      iconBg: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
    },
  }[extension.category] || {
    bg: 'bg-muted text-muted-foreground border-border',
    iconBg: 'bg-muted text-muted-foreground',
  };

  return (
    <div
      className={`group relative bg-card/80 backdrop-blur-xs border rounded-md p-4 flex flex-col justify-between transition-all duration-200 hover:shadow-sm ${
        extension.enabled
          ? 'border-border/90 shadow-2xs'
          : 'border-border/60 opacity-80 hover:opacity-100'
      }`}
    >
      {/* Top row: Icon + Title + Status Switch */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`p-2 rounded-md ${categoryTheme.iconBg} transition-transform group-hover:scale-105 shrink-0`}
            >
              <ExtensionIcon id={extension.id} category={extension.category} className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-sm text-foreground truncate" title={extension.name}>
                {extension.name}
              </h3>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="font-mono text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.2 rounded-xs">
                  {extension.id}
                </span>
                <span className="text-[10px] text-muted-foreground/80 font-mono">
                  v{extension.version}
                </span>
              </div>
            </div>
          </div>

          {/* Switch toggle */}
          <div className="flex items-center gap-1.5 shrink-0">
            {isToggling ? (
              <RotateCw className="w-4 h-4 animate-spin text-muted-foreground" />
            ) : (
              <button
                type="button"
                role="switch"
                aria-checked={extension.enabled}
                title={extension.enabled ? 'Click to disable' : 'Click to enable'}
                onClick={() => onToggle(extension.id, !extension.enabled)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-1 focus:ring-primary ${
                  extension.enabled ? 'bg-emerald-500' : 'bg-muted/80'
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
      </div>

      {/* Footer: Category & Built-in badge + Configure button */}
      <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-medium border uppercase tracking-wider ${categoryTheme.bg}`}
          >
            {extension.category}
          </span>
          {extension.is_builtin ? (
            <span className="px-1.5 py-0.5 rounded-xs text-[10px] bg-muted text-muted-foreground font-mono">
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
          className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 px-2 py-1 rounded-sm transition-colors cursor-pointer"
        >
          <Settings2 className="w-3.5 h-3.5" />
          <span>Config</span>
        </button>
      </div>
    </div>
  );
}
