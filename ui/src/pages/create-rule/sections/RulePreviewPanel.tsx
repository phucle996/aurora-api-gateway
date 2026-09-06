import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

export function RulePreviewPanel({ definition }: { definition: object }) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(definition, null, 2);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <section className="bg-card border border-border p-4 text-xs font-mono">
      <div className="pb-2 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground font-sans">Rule definition preview</h2>
        <p className="text-[11px] text-muted-foreground font-sans mt-0.5">
          Exact JSON submitted to Create. Not an NGINX configuration or a live deployment.
        </p>
      </div>

      {/* Terminal with Copy icon button on hover */}
      <div className="relative group mt-3 p-3 bg-muted/40 border border-border overflow-x-auto text-[11px] leading-relaxed rounded-xs">
        <button
          type="button"
          onClick={handleCopy}
          className={`absolute top-2.5 right-2.5 p-1.5 rounded-xs bg-card/90 hover:bg-accent border border-border text-foreground transition-all duration-200 cursor-pointer shadow-xs ${
            copied
              ? 'opacity-100 text-primary border-primary/40'
              : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
          }`}
          title={copied ? 'Copied definition!' : 'Copy definition'}
          aria-label="Copy rule definition"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-primary" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </button>
        <pre className="text-primary whitespace-pre-wrap break-all select-text font-mono text-[11px] leading-relaxed">
          {json}
        </pre>
      </div>
    </section>
  );
}
