import React, { useState, useEffect } from 'react';
import { ExtensionItem } from '../types';
import { ExtensionIcon } from './ExtensionIcon';
import { EXTENSIONS_CATALOG, CATEGORIES_META } from '../data/catalog';
import { X, Check, AlertCircle, Wand2, RotateCcw, Save, RotateCw, FileCode } from 'lucide-react';

interface ExtensionConfigModalProps {
  extension: ExtensionItem | null;
  onClose: () => void;
  onSave: (id: string, configJSON: string) => Promise<boolean>;
}

export function ExtensionConfigModal({
  extension,
  onClose,
  onSave,
}: ExtensionConfigModalProps) {
  const [configText, setConfigText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const catalogEntry = extension
    ? EXTENSIONS_CATALOG.find((c) => c.id === extension.id)
    : null;

  const meta = extension
    ? CATEGORIES_META[extension.category as keyof typeof CATEGORIES_META]
    : null;

  useEffect(() => {
    if (extension) {
      try {
        const parsed = JSON.parse(extension.config_json || '{}');
        setConfigText(JSON.stringify(parsed, null, 2));
      } catch {
        setConfigText(extension.config_json || '{}');
      }
      setJsonError(null);
      setSaveSuccess(false);
    }
  }, [extension]);

  if (!extension) return null;

  const handleFormat = () => {
    try {
      const parsed = JSON.parse(configText);
      setConfigText(JSON.stringify(parsed, null, 2));
      setJsonError(null);
    } catch (e) {
      setJsonError((e as Error).message);
    }
  };

  const handleReset = () => {
    try {
      const parsed = JSON.parse(extension.config_json || '{}');
      setConfigText(JSON.stringify(parsed, null, 2));
    } catch {
      setConfigText(extension.config_json || '{}');
    }
    setJsonError(null);
  };

  const handleLoadTemplate = () => {
    if (catalogEntry && catalogEntry.config_json) {
      try {
        const parsed = JSON.parse(catalogEntry.config_json);
        setConfigText(JSON.stringify(parsed, null, 2));
      } catch {
        setConfigText(catalogEntry.config_json);
      }
      setJsonError(null);
    }
  };

  const handleSave = async () => {
    try {
      // Validate JSON
      const parsed = JSON.parse(configText);
      const minified = JSON.stringify(parsed);
      setJsonError(null);

      setIsSaving(true);
      const ok = await onSave(extension.id, minified);
      if (ok) {
        setSaveSuccess(true);
        setTimeout(() => {
          onClose();
        }, 800);
      }
    } catch (e) {
      setJsonError('Invalid JSON format: ' + (e as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="bg-card border border-border rounded-lg shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-muted/20">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-md ${meta?.iconBgClass || 'bg-primary/10 text-primary'}`}>
              <ExtensionIcon id={extension.id} category={extension.category} className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-base text-foreground">{extension.name}</h3>
                <span className="font-mono text-xs text-muted-foreground bg-muted px-1.5 py-0.2 rounded-xs">
                  {extension.id}
                </span>
                {meta && (
                  <span
                    className={`px-2 py-0.2 rounded-full text-[10px] font-medium border uppercase tracking-wider ${meta.badgeClass}`}
                  >
                    {meta.label}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{extension.description}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Action buttons above editor */}
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-foreground tracking-wide uppercase">
              Extension Configuration (JSON)
            </label>
            <div className="flex items-center gap-2">
              {catalogEntry && (
                <button
                  type="button"
                  onClick={handleLoadTemplate}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted px-2 py-1 rounded-sm border border-border/60 transition-colors cursor-pointer"
                  title="Load recommended default template for this extension"
                >
                  <FileCode className="w-3 h-3 text-primary" />
                  <span>Default Template</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleFormat}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted px-2 py-1 rounded-sm border border-border/60 transition-colors cursor-pointer"
                title="Format and validate JSON indentation"
              >
                <Wand2 className="w-3 h-3" />
                <span>Format JSON</span>
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted px-2 py-1 rounded-sm border border-border/60 transition-colors cursor-pointer"
                title="Reset to saved configuration"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            </div>
          </div>

          {/* JSON Textarea Editor */}
          <div className="relative">
            <textarea
              rows={14}
              value={configText}
              onChange={(e) => {
                setConfigText(e.target.value);
                if (jsonError) setJsonError(null);
              }}
              className="w-full font-mono text-xs bg-muted/20 border border-border/80 rounded-md p-3.5 text-foreground leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary transition-all resize-y"
              spellCheck={false}
            />
          </div>

          {/* Syntax Error Alert */}
          {jsonError && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-500/40 rounded-sm flex items-center gap-2 text-xs text-rose-700 dark:text-rose-400 animate-in fade-in duration-150">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{jsonError}</span>
            </div>
          )}

          {/* Info note */}
          <div className="p-3 bg-muted/30 border border-border/60 rounded-sm text-[11px] text-muted-foreground space-y-1">
            <span className="font-semibold text-foreground">Declarative Cluster Sync:</span>
            <p>
              Configuration changes are recorded in SQLite authority and compiled directly into the
              deterministic YAML manifest during next node polling cycle.
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 border-t border-border bg-muted/20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {saveSuccess && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium animate-in fade-in">
                <Check className="w-4 h-4" />
                <span>Config saved successfully</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-sm border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-sm bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shadow-xs cursor-pointer disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <RotateCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Apply Config</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
