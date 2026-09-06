import React, { useState } from 'react';
import {
  Layers,
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
  Copy,
} from 'lucide-react';
import type { AccessObject, AccessStatus, AccessChange, AccessGroupDocument } from '../../../lib/api/access';

interface IpGroupsTabProps {
  items: AccessObject[];
  busy: boolean;
  status: AccessStatus | null;
  onChange: (command: AccessChange) => Promise<void>;
  onSelectHistory: (item: AccessObject) => void;
}

export function IpGroupsTab({
  items,
  busy,
  status,
  onChange,
  onSelectHistory,
}: IpGroupsTabProps) {
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<{
    id: number;
    version: number;
    release: number;
    name: string;
    text: string;
  } | null>(null);
  const [formError, setFormError] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const groups = items.filter((x) => x.kind === 'group');

  const filtered = groups.filter((g) => {
    const doc = g.document as AccessGroupDocument;
    const nameMatch = doc.name.toLowerCase().includes(search.toLowerCase());
    const networkMatch = (doc.networks || []).some((n) =>
      n.toLowerCase().includes(search.toLowerCase())
    );
    return nameMatch || networkMatch;
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
    const doc = item.document as AccessGroupDocument;
    setEditor({
      id: item.id,
      version: item.version,
      release: status ? status.release_id : 1,
      name: doc.name || '',
      text: (doc.networks || []).join('\n'),
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 65536) {
      setFormError('File size exceeds the 64 KiB snapshot boundary.');
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
        setFormError('Please provide at least one IP address or CIDR range.');
        return;
      }

      await onChange({
        id: editor.id,
        kind: 'group',
        expected_version: editor.version,
        expected_release: editor.release,
        delete: false,
        document: {
          name: editor.name.trim(),
          networks: lines,
        },
      });

      setEditor(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (item: AccessObject) => {
    const doc = item.document as AccessGroupDocument;
    if (
      !confirm(
        `Are you sure you want to delete IP group “${doc.name}”? Any enabled access rules referencing this group will be impacted.`
      )
    ) {
      return;
    }

    if (!status) return;

    await onChange({
      id: item.id,
      kind: 'group',
      expected_version: item.version,
      expected_release: status.release_id,
      delete: true,
      document: null,
    });
  };

  const copyNetworks = (item: AccessObject) => {
    const doc = item.document as AccessGroupDocument;
    const text = (doc.networks || []).join('\n');
    navigator.clipboard.writeText(text);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="space-y-4 font-sans">
      {/* Action Header & Search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] p-4 rounded-xs shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-500" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Reusable IP Groups
            </h2>
            <span className="px-2 py-0.5 text-[11px] font-mono font-medium rounded-full bg-slate-100 dark:bg-[#152030] text-slate-600 dark:text-slate-300">
              {groups.length} total
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Define reusable IP collections and subnets. Updates automatically cascade to all rules referencing the group with atomic zero-downtime deployment.
          </p>
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          {/* Search */}
          <div className="relative flex-1 sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search group name or CIDR..."
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
            <span>Add IP Group</span>
          </button>
        </div>
      </div>

      {/* Grid of IP Groups */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 text-center bg-white dark:bg-[#080E18] border border-slate-200 dark:border-[#172338] rounded-xs">
          <Layers className="w-10 h-10 text-slate-400 dark:text-slate-600 mb-3" />
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
            {groups.length === 0 ? 'No IP groups defined yet' : 'No matching IP groups'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
            {groups.length === 0
              ? 'Create reusable IP groups to simplify access policies across internal networks, partners, and VPN ranges.'
              : 'Try adjusting your search terms.'}
          </p>
          {groups.length === 0 && (
            <button
              onClick={handleOpenCreate}
              disabled={!status || busy}
              className="mt-4 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create First Group</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filtered.map((item) => {
            const doc = item.document as AccessGroupDocument;
            const networks = doc.networks || [];
            const previewNetworks = networks.slice(0, 4);
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
                        {networks.length} {networks.length === 1 ? 'network' : 'networks'} defined
                      </p>
                    </div>

                    <button
                      onClick={() => copyNetworks(item)}
                      title="Copy all CIDRs to clipboard"
                      className="text-slate-400 hover:text-slate-200 p-1 transition-colors"
                    >
                      {copiedId === item.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  {/* Network Pills Preview */}
                  <div className="flex flex-wrap gap-1.5 py-1">
                    {previewNetworks.map((net, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#172338] text-[11px] font-mono text-slate-700 dark:text-slate-300 rounded-xs"
                      >
                        {net}
                      </span>
                    ))}
                    {remainingCount > 0 && (
                      <span className="px-1.5 py-0.5 text-[10px] font-mono text-slate-400 self-center">
                        +{remainingCount} more
                      </span>
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
                      title="Edit group"
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
                      title="Delete group"
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

      {/* Add / Edit Modal */}
      {editor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] w-full max-w-xl rounded-xs shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-[#172338]">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-xs bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-500">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    {editor.id === 0 ? 'Create IP Group' : `Edit IP Group: ${editor.name}`}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {editor.id === 0
                      ? 'Define a new reusable group of IP addresses or subnets'
                      : `Updating version v${editor.version} for active release`}
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

            {/* Modal Body / Form */}
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {formError && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2 rounded-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Group Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex justify-between">
                  <span>Group Name</span>
                  <span className="text-[11px] font-normal text-slate-400">Max 120 chars</span>
                </label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  placeholder="e.g. Corporate VPN & Office Egress"
                  value={editor.name}
                  onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#172338] text-slate-900 dark:text-white px-3 py-2 text-xs rounded-xs focus:outline-none focus:border-blue-500 transition-colors font-medium"
                />
              </div>

              {/* File Upload Shortcut */}
              <div className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-[#080E18] border border-dashed border-slate-300 dark:border-[#1E2D45] rounded-xs">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-slate-400" />
                  <div>
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      Import CIDR list from file
                    </p>
                    <p className="text-[10px] text-slate-400">
                      Plain text or CSV file (max 64 KiB)
                    </p>
                  </div>
                </div>

                <label className="flex items-center gap-1.5 px-2.5 py-1 bg-white dark:bg-[#152030] hover:bg-slate-100 dark:hover:bg-[#1C293D] border border-slate-200 dark:border-[#223552] text-xs font-medium text-slate-700 dark:text-slate-200 rounded-xs cursor-pointer transition-colors">
                  <Upload className="w-3.5 h-3.5 text-slate-400" />
                  <span>Browse...</span>
                  <input
                    type="file"
                    accept=".txt,.csv"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Textarea for Networks */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Networks & CIDRs
                  </label>
                  <span className="text-[11px] font-mono text-slate-400">
                    {editor.text.split('\n').filter((s) => s.trim()).length} lines
                  </span>
                </div>
                <textarea
                  required
                  rows={8}
                  placeholder={`192.168.1.0/24\n10.0.0.0/8\n2001:db8::/32`}
                  value={editor.text}
                  onChange={(e) => setEditor({ ...editor, text: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#172338] text-slate-900 dark:text-white p-3 text-xs font-mono rounded-xs focus:outline-none focus:border-blue-500 transition-colors leading-relaxed"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Enter one IPv4 or IPv6 address/subnet per line. Comments and blank lines will be stripped.
                </p>
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
                  <span>{busy ? 'Saving...' : 'Save & Deploy'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
