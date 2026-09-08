import {useEffect, useRef, useState} from 'react';
import {api} from '../../../lib/fetcher';

interface DependencyNode {
  node_id: string;
  checked_at: number;
  nginx_version: string;
  architecture: string;
  fresh: boolean;
  installable: boolean;
  error: string;
  modules: Array<{name: string; available: boolean; loaded: boolean; source: string}>;
  job_id: number;
  job_action: string;
  job_state: string;
  job_message: string;
}

export function DependenciesSettingsSection() {
  const [nodes, setNodes] = useState<DependencyNode[]>([]);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  async function refresh() {
    const current = ++sequence.current;
    try {
      const result = await api.get<DependencyNode[]>('/api/v1/settings/dependencies');
      if (sequence.current === current) {setNodes(result); setError('');}
    } catch (e) {
      if (sequence.current === current) setError(e instanceof Error ? e.message : 'Cannot read dependency reports');
    } finally {if (sequence.current === current) setLoading(false);}
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {clearInterval(timer); sequence.current++;};
  }, []);
  async function submit(node: string, action: 'check' | 'install_brotli') {
    setPending(node);
    try {await api.post(`/api/v1/settings/dependencies/${encodeURIComponent(node)}/jobs`, {action}); await refresh();}
    catch(e) {setError(e instanceof Error ? e.message : 'Cannot queue dependency job');}
    finally {setPending(null);}
  }
  return <section className="space-y-4">
    <div className="bg-card border border-border rounded-lg p-5 space-y-2">
      <h2 className="font-semibold">Dependencies &amp; NGINX modules</h2>
      <p className="text-sm text-muted-foreground">Nodes check dependencies at startup and every 30 seconds. Reports older than 90 seconds are marked stale.</p>
      <p className="text-xs text-muted-foreground">Install Brotli uses the compatible package included with the node image. Installation verifies integrity, validates NGINX configuration, reloads workers and checks a compressed response. Installed modules persist across container replacement. Compression for domain traffic is configured separately.</p>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {loading && <p>Loading dependency reports…</p>}
    {!loading && !nodes.length && <p>No registered nodes.</p>}
    {nodes.map(node => {
      const fresh = !error && node.fresh && Date.now() - node.checked_at < 90000;
      const brotli = node.modules.find(m => m.name === 'brotli');
      const busy = pending === node.node_id || ['pending','running'].includes(node.job_state);
      return <article key={node.node_id} className="bg-card border border-border rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">{node.node_id}</h3>
            <p className="text-xs text-muted-foreground">{node.nginx_version ? `NGINX ${node.nginx_version} · ${node.architecture}` : 'Waiting for startup report'}</p>
            <p className="text-xs text-muted-foreground">{node.checked_at ? `${fresh ? 'Checked' : 'Stale'} · ${new Date(node.checked_at).toLocaleString()}` : 'Not checked yet'}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => void submit(node.node_id,'check')} className="px-3 py-2 border border-border rounded text-xs disabled:opacity-50">Check again</button>
            <button type="button" disabled={busy || !fresh || !node.installable || brotli?.loaded} onClick={() => void submit(node.node_id,'install_brotli')} className="px-3 py-2 bg-primary text-primary-foreground rounded text-xs disabled:opacity-50">{brotli?.loaded && fresh ? 'Brotli installed' : 'Install Brotli'}</button>
          </div>
        </div>
        {node.error && <p className="text-destructive text-sm">{node.error}</p>}
        {!node.installable && !brotli?.loaded && <p className="text-xs text-muted-foreground">No compatible install package reported. Rebuild the node image with a Brotli package matching its NGINX version and architecture.</p>}
        {node.job_id > 0 && <p role="status" className={`text-sm ${node.job_state === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>Job #{node.job_id} · {node.job_action === 'install_brotli' ? 'Install Brotli' : 'Dependency check'} · {node.job_state}{node.job_message && ` — ${node.job_message}`}</p>}
        <div className="overflow-x-auto"><table className="w-full text-sm text-left">
          <thead><tr className="border-b border-border"><th className="py-2">Module / capability</th><th>Status</th><th>Evidence</th></tr></thead>
          <tbody>{node.modules.map(module => <tr key={module.name} className="border-b border-border/50"><td className="py-2 font-mono text-xs">{module.name}</td><td>{!fresh ? 'Unknown · stale' : module.loaded ? 'Available' : 'Not loaded'}</td><td className="text-xs text-muted-foreground">{module.source}</td></tr>)}</tbody>
        </table></div>
      </article>;
    })}
  </section>;
}
