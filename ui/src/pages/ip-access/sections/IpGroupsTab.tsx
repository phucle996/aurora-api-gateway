import React, { useState } from 'react';
import {
  Layers,
  Plus,
  Search,
  Pencil,
  Trash2,
  Upload,
  X,
  Check,
  AlertTriangle,
  FileText,
  Copy,
  Network,
  Calendar,
  Eye,
  Download,
} from 'lucide-react';
import type {
  AccessObject,
  AccessStatus,
  AccessChange,
  AccessGroupDocument,
  AccessRuleDocument,
} from '../../../lib/api/access';

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
}: IpGroupsTabProps) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name' | 'networks'>('newest');
  const [editor, setEditor] = useState<{
    id: number;
    version: number;
    release: number;
    name: string;
    description: string;
    text: string;
  } | null>(null);
  const [viewingGroup, setViewingGroup] = useState<AccessObject | null>(null);
  const [viewSearch, setViewSearch] = useState('');
  const [formError, setFormError] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [copiedCidr, setCopiedCidr] = useState<string | null>(null);

  const groups = items.filter((x) => x.kind === 'group' && !x.deleted);

  const filtered = groups.filter((g) => {
    const doc = g.document as AccessGroupDocument;
    const nameMatch = doc.name.toLowerCase().includes(search.toLowerCase());
    const descMatch = (doc.description || '').toLowerCase().includes(search.toLowerCase());
    const networkMatch = (doc.networks || []).some((n) =>
      n.toLowerCase().includes(search.toLowerCase())
    );
    return nameMatch || descMatch || networkMatch;
  });

  const sorted = [...filtered].sort((a, b) => {
    const docA = a.document as AccessGroupDocument;
    const docB = b.document as AccessGroupDocument;
    switch (sortBy) {
      case 'oldest':
        return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
      case 'name':
        return (docA.name || '').localeCompare(docB.name || '');
      case 'networks':
        return (docB.networks?.length || 0) - (docA.networks?.length || 0);
      case 'newest':
      default:
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    }
  });

  const getRuleCountForGroup = (groupId: number) => {
    const idStr = String(groupId);
    return items.filter(
      (x) =>
        x.kind === 'rule' &&
        !x.deleted &&
        (x.document as AccessRuleDocument)?.source === 'group' &&
        Array.isArray((x.document as AccessRuleDocument)?.values) &&
        (x.document as AccessRuleDocument).values.includes(idStr)
    ).length;
  };

  const formatDate = (isoString?: string) => {
    if (!isoString) return 'Aug 28, 2024';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return isoString;
    }
  };

  const handleOpenCreate = () => {
    setFormError('');
    setEditor({
      id: 0,
      version: 0,
      release: status ? status.release_id : 1,
      name: '',
      description: '',
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
      description: doc.description || '',
      text: (doc.networks || []).join('\n'),
    });
  };

  const handleClone = (item: AccessObject) => {
    const doc = item.document as AccessGroupDocument;
    setFormError('');
    setEditor({
      id: 0,
      version: 0,
      release: status ? status.release_id : 1,
      name: `${doc.name} (Copy)`,
      description: doc.description || '',
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
        .split(/[\r\n,]+/)
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
          description: editor.description.trim(),
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
    const ruleCount = getRuleCountForGroup(item.id);
    const msg =
      ruleCount > 0
        ? `Warning: IP group "${doc.name}" is currently referenced by ${ruleCount} active access rule(s). Deleting it will impact those rules.\n\nAre you sure you want to delete it?`
        : `Are you sure you want to delete IP group "${doc.name}"?`;

    if (!confirm(msg)) {
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

  const copyAllNetworks = (item: AccessObject) => {
    const doc = item.document as AccessGroupDocument;
    const text = (doc.networks || []).join('\n');
    navigator.clipboard.writeText(text);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const copySingleCidr = (cidr: string) => {
    navigator.clipboard.writeText(cidr);
    setCopiedCidr(cidr);
    setTimeout(() => setCopiedCidr(null), 1500);
  };

  const handleExportCsv = (group: AccessObject) => {
    const doc = group.document as AccessGroupDocument;
    const rows = ['CIDR,Group Name,Description'];
    for (const net of doc.networks || []) {
      rows.push(`"${net}","${doc.name}","${doc.description || ''}"`);
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-networks.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 font-sans text-xs">
      {/* 1. Main Action Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-card border border-border p-4 rounded-sm shadow-xs">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-sm bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0 mt-0.5">
            <Layers className="w-5 h-5 text-primary" />
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-foreground">
                Reusable IP Groups
              </h2>
              <span className="px-2 py-0.5 text-[11px] font-mono font-medium rounded-full bg-muted text-muted-foreground">
                {groups.length} total
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Define reusable IP collections and subnets. Updates automatically cascade to all rules referencing the group with atomic zero-downtime deployment.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            disabled={!status || busy}
            onClick={handleOpenCreate}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-xs font-semibold rounded-sm shadow-xs transition-colors shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add IP Group</span>
          </button>
        </div>
      </div>

      {/* 2. Filter & Sort Bar (Single Unified Search) */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-card border border-border px-4 py-2.5 rounded-sm shadow-xs">
        <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
          {/* Unified Search */}
          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search IP group name, description, CIDR..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-background border border-input pl-8 pr-7 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors rounded-sm"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Sort By Dropdown */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>Sort by</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-background border border-input px-2 py-1 text-foreground rounded-sm text-xs focus:outline-none focus:border-primary cursor-pointer"
            >
              <option value="newest">Last updated (newest)</option>
              <option value="oldest">Last updated (oldest)</option>
              <option value="name">Name (A-Z)</option>
              <option value="networks">Most networks</option>
            </select>
          </div>
        </div>

        <div className="text-xs text-muted-foreground font-medium self-end sm:self-center">
          {sorted.length} of {groups.length} groups
        </div>
      </div>

      {/* 3. Horizontal Cards List */}
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 text-center bg-card border border-border rounded-sm">
          <Layers className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="text-sm font-medium text-foreground">
            {groups.length === 0 ? 'No IP groups defined yet' : 'No matching IP groups found'}
          </p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">
            {groups.length === 0
              ? 'Create reusable IP groups to simplify access policies across internal networks, partners, and VPN ranges.'
              : 'Try adjusting your search terms or clear filters.'}
          </p>
          {groups.length === 0 && (
            <button
              onClick={handleOpenCreate}
              disabled={!status || busy}
              className="mt-4 px-3.5 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-sm transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create First Group</span>
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((item) => {
            const doc = item.document as AccessGroupDocument;
            const networks = doc.networks || [];
            const previewNetworks = networks.slice(0, 3);
            const remainingCount = Math.max(0, networks.length - previewNetworks.length);
            const ruleCount = getRuleCountForGroup(item.id);

            return (
              <div
                key={item.id}
                className="bg-card border border-border hover:border-primary/40 rounded-sm p-4 sm:p-5 shadow-xs transition-colors grid grid-cols-1 md:grid-cols-12 items-center gap-4"
              >
                {/* Cột 1: 6/12 - Icon + Name + Version + Description + CIDR Preview */}
                <div className="md:col-span-6 flex items-start gap-3.5 min-w-0">
                  <div className="w-11 h-11 rounded-sm bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0 mt-0.5">
                    <Layers className="w-5 h-5 text-primary" />
                  </div>

                  <div className="space-y-1.5 min-w-0 flex-1">
                    {/* Title & Version Pill */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-bold text-foreground truncate">
                        {doc.name}
                      </h3>
                      <span className="px-1.5 py-0.5 rounded-xs text-[10px] font-mono bg-muted text-muted-foreground border border-border">
                        v{item.version}
                      </span>
                    </div>

                    {/* Subtitle / Description */}
                    <p className="text-xs text-muted-foreground truncate">
                      {doc.description ||
                        (networks.length === 1
                          ? '1 network configured'
                          : `${networks.length} networks configured`)}
                    </p>

                    {/* CIDR Preview Pills */}
                    <div className="flex items-center flex-wrap gap-1.5 pt-1">
                      {previewNetworks.map((net, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 bg-muted/50 border border-border text-[11px] font-mono text-foreground rounded-xs"
                        >
                          {net}
                        </span>
                      ))}
                      <span className="px-2 py-0.5 bg-muted/30 border border-border text-[11px] font-mono text-muted-foreground rounded-xs">
                        +{remainingCount} more
                      </span>
                    </div>
                  </div>
                </div>

                {/* Cột 2: 3/12 - Metadata stats (networks, used by rules, last updated) */}
                <div className="md:col-span-3 flex flex-col gap-1.5 text-xs text-muted-foreground border-t md:border-t-0 md:border-l border-border pt-3 md:pt-0 md:pl-5">
                  <div className="flex items-center gap-2">
                    <Network className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="font-medium text-foreground">
                      {networks.length} {networks.length === 1 ? 'network' : 'networks'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span>
                      Used by{' '}
                      <strong className="text-foreground font-semibold">
                        {ruleCount} {ruleCount === 1 ? 'rule' : 'rules'}
                      </strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span>Last updated {formatDate(item.updated_at)}</span>
                  </div>
                </div>

                {/* Cột 3: 3/12 - 4 Action Buttons căn giữa kèm đường phân cách với cột 2 */}
                <div className="md:col-span-3 flex items-center justify-center gap-2 border-t md:border-t-0 md:border-l border-border pt-3 md:pt-0 md:pl-4">
                  <button
                    type="button"
                    onClick={() => {
                      setViewSearch('');
                      setViewingGroup(item);
                    }}
                    className="w-8 h-8 rounded-xs border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors cursor-pointer"
                    title="View all networks"
                  >
                    <Eye className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    disabled={!status || busy}
                    onClick={() => handleOpenEdit(item)}
                    className="w-8 h-8 rounded-xs border border-border bg-card hover:bg-muted text-muted-foreground hover:text-primary flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50"
                    title="Edit group"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    disabled={!status || busy}
                    onClick={() => handleClone(item)}
                    className="w-8 h-8 rounded-xs border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50"
                    title="Clone / Duplicate group"
                  >
                    <Copy className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    disabled={busy || !status}
                    onClick={() => handleDelete(item)}
                    className="w-8 h-8 rounded-xs border border-border bg-card hover:bg-destructive/10 text-destructive/80 hover:text-destructive flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50"
                    title="Delete group"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 4. View Group Details Modal */}
      {viewingGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-card border border-border w-full max-w-2xl rounded-sm shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-sm bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-foreground">
                      {(viewingGroup.document as AccessGroupDocument).name}
                    </h3>
                    <span className="px-1.5 py-0.5 rounded-xs text-[10px] font-mono bg-muted text-muted-foreground border border-border">
                      v{viewingGroup.version}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {(viewingGroup.document as AccessGroupDocument).description ||
                      'Reusable IP and CIDR collection'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingGroup(null)}
                className="text-muted-foreground hover:text-foreground p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Filter & Actions Bar */}
            <div className="px-5 py-3 border-b border-border bg-muted/20 flex items-center justify-between gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter CIDRs..."
                  value={viewSearch}
                  onChange={(e) => setViewSearch(e.target.value)}
                  className="w-full bg-background border border-input pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary rounded-sm"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => copyAllNetworks(viewingGroup)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-card hover:bg-muted border border-border text-foreground text-xs rounded-sm transition-colors cursor-pointer"
                >
                  {copiedId === viewingGroup.id ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-primary" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                      <span>Copy All</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleExportCsv(viewingGroup)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-card hover:bg-muted border border-border text-foreground text-xs rounded-sm transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-muted-foreground" />
                  <span>Export CSV</span>
                </button>
              </div>
            </div>

            {/* List of Networks */}
            <div className="flex-1 overflow-y-auto p-5">
              {(() => {
                const doc = viewingGroup.document as AccessGroupDocument;
                const list = (doc.networks || []).filter((n) =>
                  n.toLowerCase().includes(viewSearch.toLowerCase())
                );

                if (list.length === 0) {
                  return (
                    <div className="text-center py-8 text-muted-foreground text-xs">
                      No CIDRs match "{viewSearch}"
                    </div>
                  );
                }

                return (
                  <div className="border border-border rounded-sm overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-muted/50 border-b border-border text-[11px] text-muted-foreground uppercase font-semibold">
                        <tr>
                          <th className="p-2.5 w-12 text-center">#</th>
                          <th className="p-2.5">CIDR / IP Range</th>
                          <th className="p-2.5 w-24 text-right pr-4">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {list.map((net, idx) => (
                          <tr key={idx} className="hover:bg-muted/30 transition-colors">
                            <td className="p-2.5 text-center font-mono text-muted-foreground">
                              {idx + 1}
                            </td>
                            <td className="p-2.5 font-mono text-foreground font-medium">
                              {net}
                            </td>
                            <td className="p-2.5 text-right pr-4">
                              <button
                                type="button"
                                onClick={() => copySingleCidr(net)}
                                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                              >
                                {copiedCidr === net ? (
                                  <>
                                    <Check className="w-3 h-3 text-primary" />
                                    <span className="text-primary font-medium">Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3" />
                                    <span>Copy</span>
                                  </>
                                )}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-border bg-muted/20 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Total: {(viewingGroup.document as AccessGroupDocument).networks?.length || 0} networks
              </span>
              <button
                type="button"
                onClick={() => setViewingGroup(null)}
                className="px-4 py-1.5 bg-card hover:bg-muted border border-border text-foreground rounded-sm cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Add / Edit Modal */}
      {editor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-card border border-border w-full max-w-xl rounded-sm shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-sm bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">
                    {editor.id === 0 ? 'Add IP Group' : `Edit IP Group: ${editor.name}`}
                  </h3>
                  <p className="text-[11px] text-muted-foreground">
                    {editor.id === 0
                      ? 'Define a new reusable collection of IP addresses or subnets'
                      : `Updating version v${editor.version} for active release`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditor(null)}
                className="text-muted-foreground hover:text-foreground p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body / Form */}
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {formError && (
                <div className="p-3 bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-center gap-2 rounded-sm">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-foreground">
                  Group Name <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. HQ Office & Wireguard VPN"
                  value={editor.name}
                  onChange={(e) =>
                    setEditor((prev) => (prev ? { ...prev, name: e.target.value } : null))
                  }
                  className="w-full bg-background border border-input px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary rounded-sm transition-colors"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-foreground">
                  Description <span className="text-muted-foreground font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Trusted internal office and VPN ranges"
                  value={editor.description}
                  onChange={(e) =>
                    setEditor((prev) => (prev ? { ...prev, description: e.target.value } : null))
                  }
                  className="w-full bg-background border border-input px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary rounded-sm transition-colors"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-foreground">
                    IP Addresses & CIDR Subnets <span className="text-destructive">*</span>
                  </label>
                  <label className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline cursor-pointer">
                    <Upload className="w-3 h-3" />
                    <span>Import text / CSV file</span>
                    <input
                      type="file"
                      accept=".txt,.csv,.cidr,.list"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>
                <textarea
                  required
                  rows={6}
                  placeholder={`192.168.1.0/24\n10.8.0.0/24\n2001:db8:cafe::/48`}
                  value={editor.text}
                  onChange={(e) =>
                    setEditor((prev) => (prev ? { ...prev, text: e.target.value } : null))
                  }
                  className="w-full bg-background border border-input p-3 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary rounded-sm transition-colors resize-y"
                />
                <p className="text-[11px] text-muted-foreground">
                  Enter one IPv4 or IPv6 CIDR subnet or individual IP address per line.
                </p>
              </div>

              {/* Form Actions */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setEditor(null)}
                  className="px-3.5 py-1.5 bg-card hover:bg-muted border border-border text-foreground text-xs font-medium rounded-sm transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-sm transition-colors cursor-pointer disabled:opacity-50"
                >
                  {editor.id === 0 ? 'Create Group' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
