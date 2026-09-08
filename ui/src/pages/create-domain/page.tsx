import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { domainsApi } from '../../lib/api/domains';
import { upstreamsApi } from '../../lib/api/upstreams';
import type { DomainItem } from '../domains/types';
import type { UpstreamItem } from '../upstreams/types';
export default function CreateDomainPage() {
 const navigate = useNavigate();
 const {id} = useParams();
 const [domain, setDomain] = useState('');
 const [target, setTarget] = useState('');
 const [status, setStatus] = useState<DomainItem['status']>('Active');
 const [description, setDescription] = useState('');
 const [tags, setTags] = useState('');
 const [pools, setPools] = useState<UpstreamItem[]>([]);
 const [saved, setSaved] = useState<DomainItem | null>(null);
 const [error, setError] = useState('');
 const [loading, setLoading] = useState(true);
 const [busy, setBusy] = useState(false);
 const pending = useRef(false);
 useEffect(() => {
  let active = true;
  void (async () => {
   try {
    const all: UpstreamItem[] = [];
    for (let page = 1; ; page++) {
     const result = await upstreamsApi.list({limit: 100, page});
     all.push(...result.items);
     if (!result.items.length || all.length >= result.total) break;
    }
    if (active) setPools(all);

   } catch (err) { if (active) setError(err instanceof Error ? err.message : 'Unable to load data'); }
   finally { if (active) setLoading(false); }
  })();
  return () => { active = false; };
 }, [id]);
 const submit = async (e: FormEvent) => {
  e.preventDefault();
  if (pending.current || loading) return;
  pending.current = true; setBusy(true); setError('');
  try {
   const payload = {upstream: target.trim(), status, description: description.trim(),
    tags: [...new Set(tags.split(',').map(t => t.trim()).filter(Boolean))]};
   await domainsApi.create({...payload, domain: domain.trim(), hsts_enabled: false, ocsp_stapling: false});
   navigate('/domains');
  } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save domain'); }
  finally { pending.current = false; setBusy(false); }
 };
 return <div className="p-6 max-w-3xl mx-auto space-y-5">
  <Link to="/domains" className="text-primary text-sm">← Domains</Link>
  <h1 className="text-2xl font-semibold">Create Domain</h1>
  <p className="text-sm text-muted-foreground">Route HTTP requests by hostname to a saved pool or an HTTP(S) origin. Nodes apply validated changes asynchronously.</p>
  {error && <p role="alert" className="text-destructive">{error}</p>}
  <form onSubmit={submit}>
   <fieldset disabled={loading || busy } className="space-y-5 disabled:opacity-60">
    <label className="block text-sm space-y-2">Domain hostname
     <input required readOnly={false} value={domain} onChange={e => setDomain(e.target.value)} placeholder="app.example.com" className="block w-full p-2 border border-input rounded bg-background" />
    </label>
    <label className="block text-sm space-y-2">Upstream pool or direct origin URL
     <input required list="upstream-pools" value={target} onChange={e => setTarget(e.target.value)} placeholder="my-pool or http://backend:8080" className="block w-full p-2 border border-input rounded bg-background" />
     <datalist id="upstream-pools">{pools.map(p => <option key={p.id} value={p.name}>{p.servers.length} configured servers</option>)}</datalist>
    </label>
    <label className="block text-sm space-y-2">Routing status
     <select value={status} onChange={e => setStatus(e.target.value as DomainItem['status'])} className="block w-full p-2 border border-input rounded bg-background"><option>Active</option><option>Inactive</option></select>
    </label>
    <p className="text-xs text-muted-foreground">Inactive domains return HTTP 503 after the configuration is applied.</p>
    <label className="block text-sm space-y-2">Description<textarea value={description} onChange={e => setDescription(e.target.value)} className="block w-full p-2 border border-input rounded bg-background" /></label>
    <label className="block text-sm space-y-2">Tags, separated by commas<input value={tags} onChange={e => setTags(e.target.value)} className="block w-full p-2 border border-input rounded bg-background" /></label>
    <div className="border border-border rounded p-4 text-sm text-muted-foreground space-y-2">
     <p>Edge HTTPS, certificate issuance and client mTLS are not available in this runtime. Existing TLS metadata does not indicate an active certificate.</p>
     <p>WAF enforcement follows the published security configuration. Configure host-specific policies in <Link to="/policies" className="text-primary">Policies</Link>.</p>
    </div>
    <button type="submit" className="px-4 py-2 bg-primary text-primary-foreground rounded">{busy ? 'Saving…' : 'Create Domain'}</button>
   </fieldset>
  </form>
 </div>;
}
