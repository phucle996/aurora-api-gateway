import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Lock, Info, RefreshCw } from 'lucide-react';
import {
  accessApi,
  type AccessRuleDocument,
  type AccessObject,
  type AccessCatalog,
} from '../../lib/api/access';
import { routesApi } from '../../lib/api/routes';
import { BasicInfoSection } from './sections/BasicInfoSection';
import { SourceSection } from './sections/SourceSection';
import { ScopeSection } from './sections/ScopeSection';
import { AdditionalOptionsSection } from './sections/AdditionalOptionsSection';
import { RulePreviewPanel } from './sections/RulePreviewPanel';
import { RuleSummaryPanel } from './sections/RuleSummaryPanel';

export function CreateIpRulePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const id = Number(params.get('edit') || 0);
  const clone = Number(params.get('clone') || 0);

  const [form, setForm] = useState<AccessRuleDocument>({
    name: '',
    description: '',
    action: 'block',
    enabled: true,
    priority: 100,
    source: 'ip',
    values: [],
    host: '*',
    path_prefix: '/',
    method: '*',
    schedule: 'always',
    expires_at: 0,
    log: true,
    reputation: false,
    alert: false,
  });

  const [values, setValues] = useState('');
  const [objects, setObjects] = useState<AccessObject[]>([]);
  const [catalog, setCatalog] = useState<AccessCatalog | null>(null);
  const [domainHosts, setDomainHosts] = useState<string[]>([]);
  const [authority, setAuthority] = useState<{ version: number; release: number } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const receipt = useRef<{ body: string; key: string } | null>(null);

  useEffect(() => {
    let live = true;
    setAuthority(null);
    Promise.all([
      accessApi.list(),
      accessApi.status(),
      accessApi.catalog(),
      routesApi.list({ limit: 200 }).then(r => {
        const seen = new Set<string>();
        return (r.items || []).filter(i => i.host && !seen.has(i.host) && seen.add(i.host)).map(i => ({ domain: i.host }));
      }).catch(() => []),
    ])
      .then(([items, status, cat, domCatalog]) => {
        if (!live) return;
        setObjects(items);
        setCatalog(cat);
        const domList = (domCatalog || []).map((d) => d.domain);
        const combined = Array.from(new Set([...(cat.hosts || []), ...domList])).sort();
        setDomainHosts(combined);
        const item = items.find((x) => x.id === (id || clone) && x.kind === 'rule');
        if ((id || clone) && !item) throw Error('Access rule not found');
        if (item) {
          const doc = item.document as AccessRuleDocument;
          setForm({ ...doc, name: doc.name + (clone ? ' (copy)' : '') });
          setValues(doc.values.join('\n'));
        }
        setAuthority({ version: id ? item!.version : 0, release: status.release_id });
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [id, clone]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!authority || busy) return;

    if (!form.name.trim()) {
      setError('Rule name is required.');
      return;
    }

    const parsedValues = values.split(/[\s,]+/).filter(Boolean);
    if (parsedValues.length === 0) {
      setError('At least one source value or network must be specified.');
      return;
    }

    if (form.source === 'ip') {
      const hasCidr = parsedValues.some((v) => v.includes('/'));
      if (hasCidr) {
        setError(
          'One or more values contain a CIDR prefix (e.g. /24). Please switch to the "CIDR / Network" source tab above.'
        );
        return;
      }
    }

    setBusy(true);
    setError('');

    const doc: AccessRuleDocument = {
      ...form,
      name: form.name.trim(),
      description: form.description.trim(),
      values: parsedValues,
      path_prefix: form.path_prefix.trim() || '/',
    };

    const command = {
      id,
      kind: 'rule' as const,
      expected_version: authority.version,
      expected_release: authority.release,
      delete: false,
      document: doc,
    };

    const body = JSON.stringify(command);
    if (receipt.current?.body !== body) {
      receipt.current = { body, key: crypto.randomUUID() };
    }

    try {
      await accessApi.change(command, receipt.current.key);
      navigate('/ip-access');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 w-full space-y-5 font-sans">
      {/* Header & Breadcrumbs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
            <Link to="/ip-access" className="hover:text-primary transition-colors">
              IP & Access Control
            </Link>
            <span>/</span>
            <span className="text-foreground font-medium">
              {id ? 'Edit Rule' : clone ? 'Clone Rule' : 'Add Rule'}
            </span>
          </div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">
            {id ? 'Edit Access Rule' : clone ? 'Clone Access Rule' : 'Add Access Rule'}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure deterministic perimeter filtering across IP addresses, subnets, countries, and ASNs.
          </p>
        </div>

        <Link
          to="/ip-access"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-card hover:bg-muted border border-border text-foreground text-xs font-medium rounded-sm transition-colors cursor-pointer self-start sm:self-auto"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to IP & Access Control</span>
        </Link>
      </div>

      {/* Error alert */}
      {error && (
        <div
          role="alert"
          className="p-3 bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-center justify-between rounded-sm"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError('')}
            className="text-xs font-bold underline ml-2 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {!authority && !error && (
        <p role="status" className="text-xs text-muted-foreground flex items-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-primary" />
          <span>Loading access authority & cluster catalog…</span>
        </p>
      )}

      {/* Main 2-Column Form */}
      <form onSubmit={save}>
        <fieldset disabled={!authority || busy} className="disabled:opacity-60">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Left Column: Form Sections (~60-65% width) */}
            <div className="lg:col-span-7 xl:col-span-8 space-y-5">
              <BasicInfoSection form={form} setForm={setForm} />
              <SourceSection
                form={form}
                setForm={setForm}
                values={values}
                setValues={setValues}
                objects={objects}
                catalog={catalog}
              />
              <ScopeSection form={form} setForm={setForm} hosts={domainHosts.length > 0 ? domainHosts : (catalog?.hosts || [])} />
              <AdditionalOptionsSection form={form} setForm={setForm} />

              {/* Bottom Form Actions */}
              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => navigate('/ip-access')}
                  className="px-4 py-2 bg-card hover:bg-muted border border-border text-foreground text-xs font-medium rounded-sm transition-colors cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={busy || !form.name.trim()}
                  className="inline-flex items-center gap-2 px-5 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-xs font-semibold rounded-sm shadow-sm transition-all cursor-pointer"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>{busy ? 'Saving rule...' : id ? 'Save Changes' : 'Create Rule'}</span>
                </button>
              </div>
            </div>

            {/* Right Column: Preview & Summary Sidebar (~35-40% width) */}
            <div className="lg:col-span-5 xl:col-span-4 space-y-4 lg:sticky lg:top-6">
              <RulePreviewPanel form={form} values={values} />
              <RuleSummaryPanel form={form} values={values} />

              {/* Tip Box */}
              <div className="bg-primary/5 border border-primary/20 rounded-sm p-3.5 flex items-start gap-2.5 text-xs text-muted-foreground">
                <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-primary block mb-0.5">
                    Tip
                  </span>
                  <span className="text-[11px] text-muted-foreground leading-relaxed">
                    Rules are compiled into an immutable snapshot. More specific rules (higher priority number) are evaluated first.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </fieldset>
      </form>
    </div>
  );
}

export default CreateIpRulePage;
