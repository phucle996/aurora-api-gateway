import { useState } from 'react';
import { Wand2, Copy, Check, AlertCircle } from 'lucide-react';

interface ExtensionRawJsonProps {
  configText: string;
  setConfigText: (text: string) => void;
  jsonError: string | null;
  setJsonError: (err: string | null) => void;
}

export function ExtensionRawJson({
  configText,
  setConfigText,
  jsonError,
  setJsonError,
}: ExtensionRawJsonProps) {
  const [copied, setCopied] = useState(false);

  const handleFormat = () => {
    try {
      const parsed = JSON.parse(configText);
      setConfigText(JSON.stringify(parsed, null, 2));
      setJsonError(null);
    } catch (e) {
      setJsonError((e as Error).message);
    }
  };

  const handleCopy = () => {
    if (configText) {
      void navigator.clipboard.writeText(configText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-foreground uppercase tracking-wide">
          Raw JSON Configuration
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleFormat}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted px-2 py-1 rounded border border-border/60 transition-all cursor-pointer"
          >
            <Wand2 className="w-3 h-3" />
            <span>Format</span>
          </button>

          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted px-2 py-1 rounded border border-border/60 transition-all cursor-pointer"
          >
            {copied ? (
              <Check className="w-3 h-3 text-emerald-500" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>

      <textarea
        rows={18}
        value={configText}
        onChange={(e) => {
          setConfigText(e.target.value);
          if (jsonError) setJsonError(null);
        }}
        className="w-full font-mono text-xs bg-muted/20 border border-border/80 rounded-xl p-4 text-foreground leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary transition-all resize-y"
        spellCheck={false}
      />

      {jsonError && (
        <div className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-500/40 rounded-lg flex items-center gap-2 text-xs text-rose-700 dark:text-rose-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{jsonError}</span>
        </div>
      )}
    </div>
  );
}
