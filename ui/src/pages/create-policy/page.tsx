import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { policiesApi, type PolicyDraft, type PolicyRule } from '../../lib/api/policies';
import { CreatePolicyHeader } from './sections/CreatePolicyHeader';
import { BasicInfoSection, type PolicyMode } from './sections/BasicInfoSection';
import { ScopeSection } from './sections/ScopeSection';
import { PolicyRulesSection, type PolicyRuleItem } from './sections/PolicyRulesSection';
import { PolicyPreviewPanel } from './sections/PolicyPreviewPanel';
import { PolicySummaryPanel } from './sections/PolicySummaryPanel';
import { FilePlus, ShieldCheck, AlertCircle } from 'lucide-react';

function mapCatalogRuleToItem(r: PolicyRule): PolicyRuleItem {
  let type: PolicyRuleItem['type'] = 'custom';
  const g = (r.group || '').toLowerCase();
  const nm = r.name.toLowerCase();
  if (g === 'rate-limit' || nm.includes('rate-limit')) {
    type = 'rate-limit';
  } else if (
    g === 'endpoint' ||
    g === 'authentication' ||
    g === 'access-control' ||
    nm.includes('allow') ||
    nm.includes('access')
  ) {
    type = 'access-control';
  }

  let action: PolicyRuleItem['action'] = 'block';
  const act = (r.action || '').toLowerCase();
  if (act.includes('allow')) action = 'allow';
  else if (act.includes('limit') || act.includes('throttle') || act.includes('log')) action = 'throttle';

  return {
    id: r.id,
    name: r.name,
    type,
    group: r.group,
    action,
    enabled: r.enabled ?? true,
  };
}

export default function CreatePolicyPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const source = params.get('edit') || params.get('clone');
  const isEditing = params.has('edit');

  // Form State (100% Real API Contract)
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<PolicyMode>('mixed');
  const [priority, setPriority] = useState(100);

  const [target, setTarget] = useState('*');

  const [rules, setRules] = useState<PolicyRuleItem[]>([]);
  const [catalog, setCatalog] = useState<PolicyRule[]>([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true);

  const [expectedVersion, setExpectedVersion] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const retryRef = useRef<{ body: string; key: string } | null>(null);

  // Load catalog and source policy if editing/cloning
  useEffect(() => {
    let active = true;
    setIsLoadingCatalog(true);

    Promise.all([
      policiesApi.ruleCatalog().catch(() => [] as PolicyRule[]),
      source ? policiesApi.detail(Number(source)).catch(() => []) : Promise.resolve([]),
    ])
      .then(([catalogData, rows]) => {
        if (!active) return;
        const fetchedCatalog = catalogData || [];
        setCatalog(fetchedCatalog);

        if (source && rows && rows.length > 0) {
          const policy = rows[0];
          const doc = policy.document;
          setName(doc.name + (isEditing ? '' : ' (copy)'));
          setDescription(doc.description || '');
          setTarget(doc.host || '*');
          setPriority(doc.priority ?? 100);
          setMode(doc.mode || 'mixed');
          setExpectedVersion(isEditing ? policy.version : 0);

          // Map attached rules
          if (doc.rules && doc.rules.length > 0) {
            setRules(doc.rules.map(mapCatalogRuleToItem));
          }
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setIsLoadingCatalog(false);
      });

    return () => {
      active = false;
    };
  }, [source, isEditing]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;

    if (!name.trim()) {
      setError('Policy name is required.');
      return;
    }

    const cleanHost = target.trim() === 'All Domains' ? '*' : (target.trim() || '*');

    setIsSaving(true);
    setError('');

    const draft: PolicyDraft = {
      name: name.trim(),
      description: description.trim(),
      host: cleanHost,
      mode,
      priority,
      rule_ids: rules.filter((r) => r.enabled).map((r) => r.id),
      expected_version: expectedVersion,
    };

    const bodyStr = JSON.stringify(draft);
    if (retryRef.current?.body !== bodyStr) {
      retryRef.current = { body: bodyStr, key: crypto.randomUUID() };
    }

    try {
      await policiesApi.save(
        isEditing ? Number(source) : null,
        draft,
        retryRef.current.key
      );
      retryRef.current = null;
      navigate('/policies');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-6 w-full space-y-6">
      {/* Header & Breadcrumb */}
      <CreatePolicyHeader isEditing={isEditing} />

      {/* Error Alert */}
      {error && (
        <div className="p-3.5 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-400 text-xs font-sans flex items-center gap-2 rounded-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main 2-Column Layout */}
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Configuration Cards (~65% width) */}
          <div className="lg:col-span-7 xl:col-span-8 space-y-5">
            {/* 1. Basic Information & Enforcement Mode */}
            <BasicInfoSection
              name={name}
              setName={setName}
              description={description}
              setDescription={setDescription}
              mode={mode}
              setMode={setMode}
              priority={priority}
              setPriority={setPriority}
            />

            {/* 2. Scope */}
            <ScopeSection
              target={target}
              setTarget={setTarget}
            />

            {/* 3. Policy Rules */}
            <PolicyRulesSection
              rules={rules}
              setRules={setRules}
              availableCatalog={catalog}
              isLoading={isLoadingCatalog}
            />

            {/* Bottom Form Actions */}
            <div className="flex items-center justify-between pt-2 font-sans">
              <button
                type="button"
                onClick={() => navigate('/policies')}
                className="px-4 py-2 bg-muted hover:bg-accent border border-border text-foreground text-xs rounded-sm transition-colors cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={isSaving || !name.trim()}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-xs font-semibold rounded-sm shadow-lg shadow-primary/20 transition-all cursor-pointer"
              >
                {isSaving ? (
                  <span>Saving policy...</span>
                ) : isEditing ? (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Save Policy Changes</span>
                  </>
                ) : (
                  <>
                    <FilePlus className="w-4 h-4" />
                    <span>Create Policy</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right Column: Preview & Summary Sidebar (~35% width) */}
          <div className="lg:col-span-5 xl:col-span-4 space-y-5 lg:sticky lg:top-20">
            {/* Policy Preview (Draft Payload & Compiled Runtime Snapshot) */}
            <PolicyPreviewPanel
              name={name}
              description={description}
              mode={mode}
              priority={priority}
              rules={rules}
              target={target}
              expectedVersion={expectedVersion}
            />

            {/* Policy Summary */}
            <PolicySummaryPanel
              name={name}
              mode={mode}
              priority={priority}
              rules={rules}
              target={target}
              isEditing={isEditing}
              expectedVersion={expectedVersion}
            />
          </div>
        </div>
      </form>
    </div>
  );
}
