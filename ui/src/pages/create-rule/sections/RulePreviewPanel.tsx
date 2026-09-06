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
    <section className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#152030] p-4 text-xs font-mono">
      <div className="pb-2 border-b border-slate-200 dark:border-[#152030]">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white font-sans">Rule definition preview</h2>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-sans mt-0.5">
          Exact JSON submitted to Create. Not an NGINX configuration or a live deployment.
        </p>
      </div>

      {/* Terminal with Copy icon button on hover */}
      <div className="relative group mt-3 p-3 bg-[#04070D] border border-slate-800 dark:border-[#1C293D] overflow-x-auto text-[11px] leading-relaxed rounded-xs">
        <button
          type="button"
          onClick={handleCopy}
          className={`absolute top-2.5 right-2.5 p-1.5 rounded-xs bg-[#152030]/90 hover:bg-[#1C293D] border border-[#1C293D] text-slate-300 hover:text-white transition-all duration-200 cursor-pointer shadow-xs ${
            copied
              ? 'opacity-100 text-emerald-400 border-emerald-500/40'
              : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
          }`}
          title={copied ? 'Copied definition!' : 'Copy definition'}
          aria-label="Copy rule definition"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </button>
        <pre className="text-emerald-300 whitespace-pre-wrap break-all select-text font-mono text-[11px] leading-relaxed">
          {json}
        </pre>
      </div>
    </section>
  );
}
