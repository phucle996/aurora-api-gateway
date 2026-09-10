import { ExtensionItem } from '../../types';
import { ExtensionIcon } from '../ExtensionIcon';
import { CATEGORIES_META } from '../../data/catalog';
import {
  X,
  Check,
  Save,
  RotateCw,
  SlidersHorizontal,
  Code2,
} from 'lucide-react';

interface ExtensionConfigHeaderProps {
  extension: ExtensionItem;
  workspaceMode: 'visual' | 'json';
  onModeChange: (mode: 'visual' | 'json') => void;
  isSaving: boolean;
  saveSuccess: boolean;
  onApplyConfig: () => void;
  onClose: () => void;
  onToggleStatus?: (id: string, enabled: boolean) => void;
}

export function ExtensionConfigHeader({
  extension,
  workspaceMode,
  onModeChange,
  isSaving,
  saveSuccess,
  onApplyConfig,
  onClose,
  onToggleStatus,
}: ExtensionConfigHeaderProps) {
  const meta = CATEGORIES_META[extension.category as keyof typeof CATEGORIES_META];

  return (
    <div className="px-6 py-3.5 border-b border-border flex items-center justify-between bg-muted/20 shrink-0">
      <div className="flex items-center gap-3.5">
        <div
          className={`p-2.5 rounded-xl ${meta?.iconBgClass || 'bg-primary/10 text-primary'
            } shadow-xs`}
        >
          <ExtensionIcon id={extension.id} category={extension.category} className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-base text-foreground tracking-tight">
              {extension.name}
            </h3>
            <span className="font-mono text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded">
              {extension.id}
            </span>
            {meta && (
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-medium border uppercase tracking-wider ${meta.badgeClass}`}
              >
                {meta.label}
              </span>
            )}
            <span className="text-[11px] text-muted-foreground font-mono">
              v{extension.version}
            </span>
            {onToggleStatus && (
              <button
                type="button"
                onClick={() => onToggleStatus(extension.id, !extension.enabled)}
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors cursor-pointer ${extension.enabled
                    ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                    : 'bg-muted text-muted-foreground border-border'
                  }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${extension.enabled ? 'bg-emerald-500' : 'bg-muted-foreground'
                    }`}
                />
                <span>{extension.enabled ? 'Active' : 'Disabled'}</span>
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
            {extension.description}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        {/* Mode Switch Tabs */}
        <div className="flex items-center bg-muted/70 p-0.5 rounded-lg border border-border/60">
          <button
            type="button"
            onClick={() => onModeChange('visual')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 cursor-pointer ${workspaceMode === 'visual'
                ? 'bg-background text-foreground shadow-xs font-semibold'
                : 'text-muted-foreground hover:text-foreground'
              }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Visual Form</span>
          </button>

          <button
            type="button"
            onClick={() => onModeChange('json')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 cursor-pointer ${workspaceMode === 'json'
                ? 'bg-background text-foreground shadow-xs font-semibold'
                : 'text-muted-foreground hover:text-foreground'
              }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>Raw JSON</span>
          </button>
        </div>

        <button
          type="button"
          disabled={isSaving || saveSuccess}
          onClick={onApplyConfig}
          className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer shadow-xs ${saveSuccess
              ? 'bg-emerald-600 text-white'
              : 'bg-primary hover:bg-primary/90 text-primary-foreground'
            }`}
        >
          {isSaving ? (
            <>
              <RotateCw className="w-3.5 h-3.5 animate-spin" />
              <span>Saving...</span>
            </>
          ) : saveSuccess ? (
            <>
              <Check className="w-3.5 h-3.5" />
              <span>Saved!</span>
            </>
          ) : (
            <>
              <Save className="w-3.5 h-3.5" />
              <span>Save Configuration</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-lg transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
