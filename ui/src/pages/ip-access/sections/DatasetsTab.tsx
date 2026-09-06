import React, { useState } from 'react';
import {
  Globe,
  Plus,
  Search,
  Pencil,
  History,
  Trash2,
  Upload,
  X,
  Check,
  AlertTriangle,
  FileText,
  HelpCircle,
} from 'lucide-react';
import type {
  AccessObject,
  AccessStatus,
  AccessChange,
  AccessDatasetDocument,
} from '../../../lib/api/access';

interface DatasetsTabProps {
  items: AccessObject[];
  busy: boolean;
  status: AccessStatus | null;
  onChange: (command: AccessChange) => Promise<void>;
  onSelectHistory: (item: AccessObject) => void;
}

export function DatasetsTab({
  items,
  busy,
  status,
  onChange,
  onSelectHistory,
}: DatasetsTabProps) {
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<{
    id: number;
    version: number;
    release: number;
    name: string;
    text: string;
  } | null>(null);
  const [formError, setFormError] = useState('');

  const datasets = items.filter((x) => x.kind === 'dataset');

  const filtered = datasets.filter((d) => {
    const doc = d.document as AccessDatasetDocument;
    const nameMatch = doc.name.toLowerCase().includes(search.toLowerCase());
    const netMatch = (doc.networks || []).some(
      (n) =>
        n.cidr.toLowerCase().includes(search.toLowerCase()) ||
        n.country.toLowerCase().includes(search.toLowerCase()) ||
        n.asn.toLowerCase().includes(search.toLowerCase())
    );
    return nameMatch || netMatch;
  });

  const handleOpenCreate = () => {
    setFormError('');
    setEditor({
      id: 0,
      version: 0,
      release: status ? status.release_id : 1,
      name: '',
      text: '',
    });
  };

  const handleOpenEdit = (item: AccessObject) => {
    setFormError('');
    const doc = item.document as AccessDatasetDocument;
    const text = (doc.networks || [])
      .map((n) => `${n.cidr}, ${n.country}, ${n.asn}`)
      .join('\n');

    setEditor({
      id: item.id,
      version: item.version,
      release: status ? status.release_id : 1,
      name: doc.name || '',
      text,
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 65536) {
      setFormError('Dataset file exceeds the 64 KiB snapshot boundary.');
      return;
    }
    try {
      const content = await file.text();
      setEditor((prev) => (prev ? { ...prev, text: content } : null));
      setFormError('');
    } catch (err) {
      setFormError(`Failed to read file: ${String(err)}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editor) return;
    setFormError('');

    try {
      const lines = editor.text
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

      if (lines.length === 0) {
        setFormError('Please provide at least one dataset mapping line.');
        return;
      }

      const networks = lines.map((line, idx) => {
        const parts = line.split(',').map((s) => s.trim());
        if (parts.length < 1) {
          throw new Error(`Line ${idx + 1}: Invalid format.`);
        }
        const [cidr, country = '', asn = '', ...extra] = parts;
        if (extra.length > 0) {
          throw new Error(`Line ${idx + 1}: Expected format "CIDR, CountryCode, ASN"`);
        }
        return { cidr, country: country.toUpperCase(), asn: asn.toUpperCase() };
      });

      await onChange({
        id: editor.id,
        kind: 'dataset',
        expected_version: editor.version,
        expected_release: editor.release,
        delete: false,
        document: {
          name: editor.name.trim(),
          networks,
        },
      });

      setEditor(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (item: AccessObject) => {
    const doc = item.document as AccessDatasetDocument;
    if (
      !confirm(
        `Are you sure you want to delete dataset “${doc.name}”? Any enabled country/ASN access rules referencing this dataset will lose their matching data.`
      )
    ) {
      return;
    }

    if (!status) return;

    await onChange({
      id: item.id,
      kind: 'dataset',
      expected_version: item.version,
      expected_release: status.release_id,
      delete: true,
      document: null,
    });
  };

  return (
    <div className="space-y-4 font-sans">
      {/* Action Header & Search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] p-4 rounded-xs shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-blue-500" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Geo & ASN Datasets
            </h2>
            <span className="px-2 py-0.5 text-[11px] font-mono font-medium rounded-full bg-slate-100 dark:bg-[#152030] text-slate-600 dark:text-slate-300">
              {datasets.length} total
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Import custom CIDR, ISO country code, and ASN mapping datasets. Compiled snapshots are limited to 64 KiB per snapshot for zero-latency in-memory lookup.
          </p>
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          {/* Search */}
          <div className="relative flex-1 sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search dataset, country, ASN..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#172338] pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-500 transition-colors rounded-xs"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <button
            type="button"
            disabled={!status || busy}
            onClick={handleOpenCreate}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xs shadow-xs transition-colors shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Dataset</span>
          </button>
        </div>
      </div>

      {/* Grid of Datasets */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 text-center bg-white dark:bg-[#080E18] border border-slate-200 dark:border-[#172338] rounded-xs">
          <Globe className="w-10 h-10 text-slate-400 dark:text-slate-600 mb-3" />
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
            {datasets.length === 0 ? 'No custom datasets imported' : 'No matching datasets'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
            {datasets.length === 0
              ? 'Import external CIDR-to-Country or CIDR-to-ASN mappings for location and cloud provider access filtering.'
              : 'Try searching with different keywords.'}
          </p>
          {datasets.length === 0 && (
            <button
              onClick={handleOpenCreate}
              disabled={!status || busy}
              className="mt-4 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Import Dataset</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filtered.map((item) => {
            const doc = item.document as AccessDatasetDocument;
            const networks = doc.networks || [];
            const previewNetworks = networks.slice(0, 3);
            const remainingCount = networks.length - previewNetworks.length;

            return (
              <div
                key={item.id}
                className="flex flex-col justify-between bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] hover:border-slate-300 dark:hover:border-[#223552] p-4 rounded-xs shadow-xs transition-all duration-150"
              >
                {/* Header */}
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <h3 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          {doc.name}
                        </h3>
                        <span className="px-1.5 py-0.2 rounded-xs text-[10px] font-mono bg-slate-100 dark:bg-[#152030] text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-[#1E2D45]">
                          v{item.version}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {networks.length} {networks.length === 1 ? 'entry' : 'entries'} mapped
                      </p>
                    </div>
                  </div>

                  {/* Sample rows */}
                  <div className="space-y-1 py-1">
                    {previewNetworks.map((net, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between text-[11px] font-mono bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#172338] px-2 py-0.5 rounded-xs"
                      >
                        <span className="text-slate-800 dark:text-slate-200">{net.cidr}</span>
                        <div className="flex items-center gap-1.5 text-slate-500">
                          {net.country && (
                            <span className="font-semibold text-blue-600 dark:text-blue-400">
                              {net.country}
                            </span>
                          )}
                          {net.asn && <span>{net.asn}</span>}
                        </div>
                      </div>
                    ))}
                    {remainingCount > 0 && (
                      <p className="text-[10px] text-slate-400 font-mono text-center pt-0.5">
                        +{remainingCount} more entries
                      </p>
                    )}
                  </div>
                </div>

                {/* Footer Controls */}
                <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-100 dark:border-[#172338]">
                  <span className="text-[10px] text-slate-400 font-mono">
                    ID: #{item.id}
                  </span>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={!status}
                      onClick={() => handleOpenEdit(item)}
                      className="p-1 text-slate-500 hover:text-blue-500 dark:text-slate-400 dark:hover:text-blue-400 rounded-xs transition-colors cursor-pointer"
                      title="Edit dataset"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelectHistory(item)}
                      className="p-1 text-slate-500 hover:text-amber-500 dark:text-slate-400 dark:hover:text-amber-400 rounded-xs transition-colors cursor-pointer"
                      title="Revision history"
                    >
                      <History className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={busy || !status}
                      onClick={() => handleDelete(item)}
                      className="p-1 text-slate-500 hover:text-rose-500 dark:text-slate-400 dark:hover:text-rose-400 rounded-xs transition-colors cursor-pointer"
                      title="Delete dataset"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Dataset Modal */}
      {editor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] w-full max-w-xl rounded-xs shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-[#172338]">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-xs bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-500">
                  <Globe className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    {editor.id === 0 ? 'Import Geo / ASN Dataset' : `Edit Dataset: ${editor.name}`}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {editor.id === 0
                      ? 'Upload custom IP ranges mapped to ISO country codes and ASNs'
                      : `Updating snapshot version v${editor.version}`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditor(null)}
                className="text-slate-400 hover:text-slate-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {formError && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2 rounded-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Dataset Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex justify-between">
                  <span>Dataset Name / Provenance</span>
                  <span className="text-[11px] font-normal text-slate-400">Max 120 chars</span>
                </label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  placeholder="e.g. MaxMind GeoLite2 Snapshot - Southeast Asia"
                  value={editor.name}
                  onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#172338] text-slate-900 dark:text-white px-3 py-2 text-xs rounded-xs focus:outline-none focus:border-blue-500 transition-colors font-medium"
                />
              </div>

              {/* Format Hint Box */}
              <div className="p-3 bg-blue-50/50 dark:bg-[#0E1726] border border-blue-200/60 dark:border-[#1C293D] rounded-xs space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                  <HelpCircle className="w-3.5 h-3.5" />
                  <span>Expected CSV Format</span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Each line must contain: <code className="px-1 py-0.2 bg-slate-200 dark:bg-[#152030] font-mono text-[10px]">CIDR, CountryCode, ASN</code>. Header rows are not allowed.
                </p>
                <div className="bg-white dark:bg-[#080E18] p-2 border border-slate-200 dark:border-[#172338] font-mono text-[10px] text-slate-600 dark:text-slate-300 rounded-xs space-y-0.5">
                  <p>198.51.100.0/24, US, AS15169</p>
                  <p>203.0.113.0/24, VN, AS7552</p>
                </div>
              </div>

              {/* File Upload Shortcut */}
              <div className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-[#080E18] border border-dashed border-slate-300 dark:border-[#1E2D45] rounded-xs">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-slate-400" />
                  <div>
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      Import CSV / text dataset file
                    </p>
                    <p className="text-[10px] text-slate-400">
                      Maximum 64 KiB snapshot boundary
                    </p>
                  </div>
                </div>

                <label className="flex items-center gap-1.5 px-2.5 py-1 bg-white dark:bg-[#152030] hover:bg-slate-100 dark:hover:bg-[#1C293D] border border-slate-200 dark:border-[#223552] text-xs font-medium text-slate-700 dark:text-slate-200 rounded-xs cursor-pointer transition-colors">
                  <Upload className="w-3.5 h-3.5 text-slate-400" />
                  <span>Browse...</span>
                  <input
                    type="file"
                    accept=".csv,.txt"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Textarea */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Dataset Mapping Rows
                  </label>
                  <span className="text-[11px] font-mono text-slate-400">
                    {editor.text.split('\n').filter((s) => s.trim()).length} rows
                  </span>
                </div>
                <textarea
                  required
                  rows={7}
                  placeholder={`1.1.1.0/24, US, AS13335\n8.8.8.0/24, US, AS15169`}
                  value={editor.text}
                  onChange={(e) => setEditor({ ...editor, text: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#172338] text-slate-900 dark:text-white p-3 text-xs font-mono rounded-xs focus:outline-none focus:border-blue-500 transition-colors leading-relaxed"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-[#172338]">
                <button
                  type="button"
                  onClick={() => setEditor(null)}
                  className="px-3.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-[#172338] rounded-xs transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xs shadow-xs transition-colors cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{busy ? 'Saving...' : 'Save & Compile'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
