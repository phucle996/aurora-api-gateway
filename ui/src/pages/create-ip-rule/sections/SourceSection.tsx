import React, { useRef } from 'react';
import { Link } from 'react-router-dom';
import { Globe, Network, Flag, Cpu, Layers, Upload, AlertCircle, Check } from 'lucide-react';
import type { AccessRuleDocument, AccessObject, AccessCatalog } from '../../../lib/api/access';

interface SourceSectionProps {
  form: AccessRuleDocument;
  setForm: React.Dispatch<React.SetStateAction<AccessRuleDocument>>;
  values: string;
  setValues: (val: string) => void;
  objects: AccessObject[];
  catalog?: AccessCatalog | null;
}

export function SourceSection({
  form,
  setForm,
  values,
  setValues,
  objects,
  catalog,
}: SourceSectionProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const sourceTabs: {
    id: AccessRuleDocument['source'];
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: 'ip', label: 'IP Address', icon: Globe },
    { id: 'cidr', label: 'CIDR / Network', icon: Network },
    { id: 'country', label: 'Country / Region', icon: Flag },
    { id: 'asn', label: 'ASN', icon: Cpu },
    { id: 'group', label: 'IP Group', icon: Layers },
  ];

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        const lines = content
          .split(/[\r\n]+/)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('#'));

        if (lines.length > 0) {
          const existing = values.trim() ? values.trim().split('\n') : [];
          const combined = Array.from(new Set([...existing, ...lines])).join('\n');
          setValues(combined);
        }
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const getPlaceholder = () => {
    switch (form.source) {
      case 'country':
        return 'Enter 2-letter ISO country codes (one per line).\ne.g.\nVN\nUS\nJP';
      case 'asn':
        return 'Enter ASNs (one per line).\ne.g.\nAS13335\nAS15169';
      case 'cidr':
        return 'Enter one CIDR network per line.\ne.g.\n192.0.2.0/24\n2001:db8::/32';
      case 'ip':
      default:
        return 'Enter one IP address per line (no prefix).\ne.g.\n192.168.1.1\n10.0.0.1';
    }
  };

  const getLabel = () => {
    switch (form.source) {
      case 'country':
        return 'Country / Region Codes';
      case 'asn':
        return 'Autonomous System Numbers (ASNs)';
      case 'cidr':
        return 'CIDR Networks';
      case 'group':
        return 'IP Groups';
      case 'ip':
      default:
        return 'IP Addresses';
    }
  };

  const selectedValues = values
    .split(/[\s,]+/)
    .map((v) => v.trim())
    .filter(Boolean);

  const toggleItemValue = (item: string) => {
    const upper = item.toUpperCase();
    if (selectedValues.includes(upper)) {
      setValues(selectedValues.filter((v) => v !== upper).join('\n'));
    } else {
      setValues([...selectedValues, upper].join('\n'));
    }
  };

  const hasCidrInIpTab = form.source === 'ip' && selectedValues.some((v) => v.includes('/'));

  return (
    <section className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] p-5 space-y-4 shadow-xs rounded-sm font-sans text-xs">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
          2. Source (IP / Network / Region)
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Define target traffic criteria for matching network packets.
        </p>
      </div>

      {/* Segmented Source Tabs */}
      <div className="flex flex-wrap gap-2 pt-1">
        {sourceTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = form.source === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setForm((prev) => ({ ...prev, source: tab.id }));
                if (tab.id !== form.source) {
                  setValues('');
                }
              }}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-sm text-xs font-medium transition-all cursor-pointer ${
                isActive
                  ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-500 dark:border-blue-500 shadow-xs'
                  : 'bg-slate-50 dark:bg-[#080E18] text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-[#1C293D] hover:bg-slate-100 dark:hover:bg-[#111C2E]'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-blue-500' : 'text-slate-400'}`} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Warning if CIDR entered in IP tab */}
      {hasCidrInIpTab && (
        <div className="p-2.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300 rounded-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-amber-500" />
          <span>
            You entered a CIDR range (contains <code className="font-mono">/</code>). Please switch to the{' '}
            <button
              type="button"
              onClick={() => setForm((prev) => ({ ...prev, source: 'cidr' }))}
              className="underline font-bold"
            >
              CIDR / Network
            </button>{' '}
            tab above.
          </span>
        </div>
      )}

      {/* Group selector, Catalog selector, or Textarea */}
      <div className="space-y-2 pt-2">
        <div className="flex items-center justify-between">
          <label className="block text-slate-700 dark:text-slate-300 font-medium">
            {getLabel()} <span className="text-rose-500">*</span>
          </label>

          {form.source !== 'group' && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.csv,.cidr,.list"
                className="hidden"
                onChange={handleFileImport}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-[#152030] hover:bg-slate-200 dark:hover:bg-[#1C293D] border border-slate-200 dark:border-[#22334D] px-2.5 py-1 rounded-sm cursor-pointer transition-colors"
              >
                <Upload className="w-3.5 h-3.5 text-slate-500" />
                <span>Import from file</span>
              </button>
            </>
          )}
        </div>

        {/* IP Group selection */}
        {form.source === 'group' && (
          <div className="p-4 bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#1C293D] rounded-sm space-y-3">
            {objects.filter((o) => o.kind === 'group').length === 0 ? (
              <p className="text-slate-400 py-2">
                No IP groups defined yet.{' '}
                <Link to="/ip-access?tab=groups" className="text-blue-500 hover:underline">
                  Create an IP Group first
                </Link>
                .
              </p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {objects
                  .filter((o) => o.kind === 'group')
                  .map((group) => {
                    const idStr = String(group.id);
                    const isChecked = selectedValues.includes(idStr);
                    return (
                      <label
                        key={group.id}
                        className="flex items-center gap-2 p-2 hover:bg-slate-100 dark:hover:bg-[#0F1A2E] rounded cursor-pointer select-none"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setValues([...selectedValues, idStr].join('\n'));
                            } else {
                              setValues(selectedValues.filter((id) => id !== idStr).join('\n'));
                            }
                          }}
                          className="rounded text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-slate-800 dark:text-slate-200 font-medium">
                          {group.document.name}
                        </span>
                        <span className="text-[11px] text-slate-400 font-mono">
                          ({(group.document as { networks?: string[] }).networks?.length || 0} items)
                        </span>
                      </label>
                    );
                  })}
              </div>
            )}
            <div className="pt-2 border-t border-slate-200 dark:border-[#1C293D]">
              <Link to="/ip-access?tab=groups" className="text-xs text-blue-500 hover:underline">
                Manage IP groups →
              </Link>
            </div>
          </div>
        )}

        {/* Available Countries Suggestion from real Datasets */}
        {form.source === 'country' && (
          <div className="space-y-2">
            {catalog && catalog.countries.length > 0 ? (
              <div className="p-3 bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#1C293D] rounded-sm space-y-2">
                <p className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                  Available Countries in active Datasets (click to select/unselect):
                </p>
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                  {catalog.countries.map((c) => {
                    const isSelected = selectedValues.includes(c.code);
                    return (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => toggleItemValue(c.code)}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-blue-600 text-white'
                            : 'bg-white dark:bg-[#152030] border border-slate-200 dark:border-[#22334D] text-slate-700 dark:text-slate-300 hover:border-blue-400'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3" />}
                        <span className="font-bold">{c.code}</span>
                        <span className="text-[10px] opacity-75">({c.cidr_count} CIDRs)</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300 rounded-sm text-xs space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-amber-500" />
                  <span>No country datasets imported yet</span>
                </p>
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  In Aurora WAF, country rules require pre-imported CIDR-to-Country mappings. Please import a dataset before saving this rule.{' '}
                  <Link to="/ip-access?tab=datasets" className="underline font-bold">
                    Import Dataset →
                  </Link>
                </p>
              </div>
            )}
          </div>
        )}

        {/* Available ASNs Suggestion from real Datasets */}
        {form.source === 'asn' && (
          <div className="space-y-2">
            {catalog && catalog.asns.length > 0 ? (
              <div className="p-3 bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#1C293D] rounded-sm space-y-2">
                <p className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                  Available ASNs in active Datasets (click to select/unselect):
                </p>
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                  {catalog.asns.map((a) => {
                    const isSelected = selectedValues.includes(a.asn.toUpperCase());
                    return (
                      <button
                        key={a.asn}
                        type="button"
                        onClick={() => toggleItemValue(a.asn)}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-blue-600 text-white'
                            : 'bg-white dark:bg-[#152030] border border-slate-200 dark:border-[#22334D] text-slate-700 dark:text-slate-300 hover:border-blue-400'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3" />}
                        <span className="font-bold">{a.asn}</span>
                        <span className="text-[10px] opacity-75">({a.cidr_count} CIDRs)</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300 rounded-sm text-xs space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-amber-500" />
                  <span>No ASN datasets imported yet</span>
                </p>
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  In Aurora WAF, ASN rules require pre-imported CIDR-to-ASN mappings.{' '}
                  <Link to="/ip-access?tab=datasets" className="underline font-bold">
                    Import Dataset →
                  </Link>
                </p>
              </div>
            )}
          </div>
        )}

        {/* Textarea for manual input (except group) */}
        {form.source !== 'group' && (
          <textarea
            required
            rows={5}
            value={values}
            onChange={(e) => setValues(e.target.value)}
            placeholder={getPlaceholder()}
            className="w-full bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#1C293D] p-3 text-slate-900 dark:text-white font-mono text-xs rounded-sm focus:outline-none focus:border-blue-500 transition-colors"
          />
        )}
      </div>
    </section>
  );
}
