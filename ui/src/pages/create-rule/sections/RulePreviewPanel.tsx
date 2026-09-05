import { useState } from 'react';

export function RulePreviewPanel({ definition }: { definition: object }) {
  const [message, setMessage] = useState('');
  const json = JSON.stringify(definition, null, 2);
  return <section className="bg-[#0B1320] border border-[#152030] p-4 text-xs">
    <h2 className="text-sm font-semibold text-white">Rule definition preview</h2>
    <p className="text-slate-400 mt-2">Exact JSON submitted to Create. Not an NGINX configuration or a live deployment.</p>
    <button type="button" className="my-3 text-emerald-400" onClick={async () => {
      try { await navigator.clipboard.writeText(json); setMessage('Copied definition'); }
      catch { setMessage('Clipboard unavailable; select the JSON to copy.'); }
    }}>Copy definition</button>
    <span role="status" className="ml-3">{message}</span>
    <pre className="bg-[#04070D] p-3 text-emerald-300 whitespace-pre-wrap break-all select-text">{json}</pre>
  </section>;
}
