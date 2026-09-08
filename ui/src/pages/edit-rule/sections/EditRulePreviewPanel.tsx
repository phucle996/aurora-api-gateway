import { useState } from 'react';
import type { UpdateRuleDefinitionPayload } from '../../../lib/api/rules';

export function EditRulePreviewPanel({ definition }: { definition: UpdateRuleDefinitionPayload }) {
  const [error, setError] = useState('');
  return (
    <section className="bg-card border border-border p-4 space-y-3 text-xs text-foreground" aria-label="Draft definition">
      <h2 className="text-sm font-semibold">Draft definition</h2>
      <p className="text-muted-foreground">Current edit request. The save dialog selects Enabled or Disabled. This is not compiled NGINX configuration or a deployed rule.</p>
      <button type="button" className="text-primary" onClick={async () => {
        try { await navigator.clipboard.writeText(JSON.stringify(definition, null, 2)); setError(''); }
        catch { setError('Could not copy draft.'); }
      }}>Copy draft JSON</button>
      {error && <p role="alert">{error}</p>}
      <pre className="overflow-auto max-h-96 bg-background p-3">{JSON.stringify(definition, null, 2)}</pre>
    </section>
  );
}
