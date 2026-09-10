import React, { useState, useEffect } from 'react';
import { ExtensionItem } from '../types';
import { ExtensionIcon } from './ExtensionIcon';
import { EXTENSIONS_CATALOG, CATEGORIES_META } from '../data/catalog';
import { ExtensionRuleItem } from './ExtensionRulesDrawer';
import {
  X,
  Check,
  AlertCircle,
  Wand2,
  RotateCcw,
  Save,
  RotateCw,
  Copy,
  SlidersHorizontal,
  Plus,
  ArrowLeft,
  Trash2,
  Edit3,
  Layers,
  Gauge,
  CheckCircle2,
  XCircle,
  Shield,
  Code2,
  Table as TableIcon,
  Search,
  Sparkles,
} from 'lucide-react';

interface ExtensionConfigModalProps {
  extension: ExtensionItem | null;
  onClose: () => void;
  onSave: (id: string, configJSON: string) => Promise<boolean>;
  onToggleStatus?: (id: string, enabled: boolean) => void;
}

export function ExtensionConfigModal({
  extension,
  onClose,
  onSave,
  onToggleStatus,
}: ExtensionConfigModalProps) {
  // Mode: 'table' (Extension-specific data table workspace) or 'json' (Full raw JSON editor)
  const [workspaceMode, setWorkspaceMode] = useState<'table' | 'json'>('table');
  const [configText, setConfigText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [copied, setCopied] = useState(false);

  // Parsed configuration state
  const [parsedConfig, setParsedConfig] = useState<Record<string, any>>({});
  const [rules, setRules] = useState<ExtensionRuleItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Inline Rule Form State (replaces table view inside drawer)
  const [isEditingRule, setIsEditingRule] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  // Form state for UI mode
  const [ruleForm, setRuleForm] = useState<ExtensionRuleItem>({
    id: '',
    name: '',
    description: '',
    enabled: true,
    match_type: 'path',
    match_value: '',
    method: 'ALL',
    rate: undefined,
    burst: undefined,
    period_secs: undefined,
    action: 'block',
    custom_code: undefined,
    custom_message: '',
  });

  const catalogEntry = extension
    ? EXTENSIONS_CATALOG.find((c) => c.id === extension.id)
    : null;

  const meta = extension
    ? CATEGORIES_META[extension.category as keyof typeof CATEGORIES_META]
    : null;

  // Initialize state when extension changes
  useEffect(() => {
    if (extension) {
      let parsed: Record<string, any> = {};
      try {
        parsed = JSON.parse(extension.config_json || '{}');
        setConfigText(JSON.stringify(parsed, null, 2));
      } catch {
        setConfigText(extension.config_json || '{}');
      }

      setParsedConfig(parsed);
      if (Array.isArray(parsed.rules)) {
        setRules(parsed.rules);
      } else {
        setRules([]);
      }

      setJsonError(null);
      setSaveSuccess(false);
      setIsEditingRule(false);
      setEditingIndex(null);
      setWorkspaceMode('table');
    }
  }, [extension]);

  if (!extension) return null;

  // Extension category & type detection
  const isRateLimit =
    extension.id.includes('rate-limit') ||
    extension.category === 'traffic_control' ||
    parsedConfig.rate !== undefined ||
    parsedConfig.default_rate !== undefined;

  const isBotOrSecurity =
    extension.category === 'security_engine' ||
    extension.id.includes('bot') ||
    extension.id.includes('waf') ||
    extension.id.includes('protection');

  const isHeaderOrAuth =
    extension.category === 'authentication' ||
    extension.category === 'header_mutation' ||
    extension.id.includes('auth') ||
    extension.id.includes('header');

  // Synchronize state between Table and JSON
  const syncToJSON = (updatedConfig: Record<string, any>, updatedRules: ExtensionRuleItem[]) => {
    const nextConfig = {
      ...updatedConfig,
      rules: updatedRules.length > 0 ? updatedRules : undefined,
    };
    if (updatedRules.length === 0) {
      delete nextConfig.rules;
    }
    const formatted = JSON.stringify(nextConfig, null, 2);
    setConfigText(formatted);
    setParsedConfig(nextConfig);
    return formatted;
  };

  const syncFromJSON = (text: string): boolean => {
    try {
      const parsed = JSON.parse(text);
      setParsedConfig(parsed);
      if (Array.isArray(parsed.rules)) {
        setRules(parsed.rules);
      } else {
        setRules([]);
      }
      setJsonError(null);
      return true;
    } catch (e) {
      setJsonError('JSON syntax error: ' + (e as Error).message);
      return false;
    }
  };

  const handleModeChange = (mode: 'table' | 'json') => {
    if (mode === 'table') {
      const ok = syncFromJSON(configText);
      if (!ok) return;
    } else {
      syncToJSON(parsedConfig, rules);
    }
    setWorkspaceMode(mode);
  };

  // Extension status toggle handler
  const handleToggleExtension = () => {
    const nextStatus = parsedConfig.enabled === false ? true : false;
    const nextConfig = { ...parsedConfig, enabled: nextStatus };
    setParsedConfig(nextConfig);
    syncToJSON(nextConfig, rules);
    if (onToggleStatus) {
      onToggleStatus(extension.id, nextStatus);
    }
  };

  // Open Add Rule Form (inline inside drawer)
  const handleOpenAdd = () => {
    const newRule: ExtensionRuleItem = {
      id: `rule_${Date.now().toString(36)}`,
      name: '',
      description: '',
      enabled: true,
      match_type: 'path',
      match_value: '',
      method: 'ALL',
      rate: undefined,
      burst: undefined,
      period_secs: undefined,
      action: isRateLimit ? 'throttle' : 'block',
      custom_code: undefined,
      custom_message: '',
    };
    setRuleForm(newRule);
    setEditingIndex(null);
    setIsEditingRule(true);
  };

  // Open Edit Rule Form (inline inside drawer)
  const handleOpenEdit = (rule: ExtensionRuleItem, index: number) => {
    setRuleForm({ ...rule });
    setEditingIndex(index);
    setIsEditingRule(true);
  };

  // Save Rule from inline form
  const handleSaveRuleEntry = () => {
    if (!ruleForm.name.trim()) return;
    const savedRule: ExtensionRuleItem = { ...ruleForm };

    let updatedRules: ExtensionRuleItem[];
    if (editingIndex !== null) {
      updatedRules = [...rules];
      updatedRules[editingIndex] = savedRule;
    } else {
      updatedRules = [...rules, savedRule];
    }

    setRules(updatedRules);
    syncToJSON(parsedConfig, updatedRules);
    setIsEditingRule(false);
    setEditingIndex(null);
  };

  // Delete rule
  const handleDeleteRule = (index: number) => {
    const updated = rules.filter((_, i) => i !== index);
    setRules(updated);
    syncToJSON(parsedConfig, updated);
  };

  // Toggle rule
  const handleToggleRule = (index: number) => {
    const updated = [...rules];
    updated[index] = { ...updated[index], enabled: !updated[index].enabled };
    setRules(updated);
    syncToJSON(parsedConfig, updated);
  };

  // Format JSON
  const handleFormat = () => {
    try {
      const parsed = JSON.parse(configText);
      setConfigText(JSON.stringify(parsed, null, 2));
      setJsonError(null);
    } catch (e) {
      setJsonError((e as Error).message);
    }
  };

  // Reset config
  const handleReset = () => {
    try {
      const parsed = JSON.parse(extension.config_json || '{}');
      setConfigText(JSON.stringify(parsed, null, 2));
      setParsedConfig(parsed);
      setRules(Array.isArray(parsed.rules) ? parsed.rules : []);
    } catch {
      setConfigText(extension.config_json || '{}');
    }
    setJsonError(null);
    setIsEditingRule(false);
    setEditingIndex(null);
  };

  // Save to backend
  const handleApplyConfig = async () => {
    try {
      let finalJson = configText;
      if (workspaceMode === 'table') {
        finalJson = syncToJSON(parsedConfig, rules);
      }

      const parsed = JSON.parse(finalJson);
      const minified = JSON.stringify(parsed);
      setJsonError(null);

      setIsSaving(true);
      const ok = await onSave(extension.id, minified);
      if (ok) {
        setSaveSuccess(true);
        setTimeout(() => {
          onClose();
        }, 700);
      }
    } catch (e) {
      setJsonError('Invalid JSON syntax: ' + (e as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const filteredRules = rules.filter((r) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      r.name.toLowerCase().includes(q) ||
      (r.description && r.description.toLowerCase().includes(q)) ||
      (r.match_value && r.match_value.toLowerCase().includes(q)) ||
      (r.action && r.action.toLowerCase().includes(q))
    );
  });

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      {/* 3/4 Height Bottom Drawer Workspace */}
      <div
        style={{ height: '78vh' }}
        className="bg-card border-t border-x border-border rounded-t-2xl shadow-2xl w-full flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300 ease-out"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="px-6 py-3.5 border-b border-border flex items-center justify-between bg-muted/20 shrink-0">
          <div className="flex items-center gap-3.5">
            <div
              className={`p-2.5 rounded-xl ${meta?.iconBgClass || 'bg-primary/10 text-primary'
                } shadow-xs`}
            >
              <ExtensionIcon id={extension.id} category={extension.category} className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-base text-foreground tracking-tight">
                  {extension.name}
                </h3>
                <span className="font-mono text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-none">
                  {extension.id}
                </span>
                {meta && (
                  <span
                    className={`px-2 py-0.5 rounded-none text-[10px] font-medium border uppercase tracking-wider ${meta.badgeClass}`}
                  >
                    {meta.label}
                  </span>
                )}
                <span className="text-[11px] text-muted-foreground font-mono">
                  v{extension.version}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                {extension.description}
              </p>
            </div>
          </div>

          {/* Header Action Controls */}
          <div className="flex items-center gap-3">
            {/* Status Switch On/Off */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 border border-border">
              <span className="text-xs font-medium text-muted-foreground">Status:</span>
              <button
                type="button"
                role="switch"
                aria-checked={parsedConfig.enabled !== false}
                onClick={handleToggleExtension}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-all duration-300 ease-in-out hover:scale-105 active:scale-95 focus:outline-none focus:ring-1 focus:ring-primary ${parsedConfig.enabled !== false ? 'bg-emerald-500 shadow-xs' : 'bg-muted/80'
                  }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${parsedConfig.enabled !== false ? 'translate-x-4' : 'translate-x-0'
                    }`}
                />
              </button>
            </div>

            {/* Mode Switch: Table vs JSON with animated sliding pill */}
            <div className="relative flex items-center p-1 bg-muted/60 rounded-lg border border-border">
              {/* Sliding active pill background with smooth spring animation */}
              <div
                className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-card rounded-md shadow-xs border border-border/80 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${workspaceMode === 'table' ? 'left-1' : 'left-[calc(50%)]'
                  }`}
              />
              <button
                type="button"
                onClick={() => handleModeChange('table')}
                className={`relative z-10 inline-flex items-center justify-center gap-1.5 px-3.5 py-1 text-xs font-medium transition-colors duration-200 cursor-pointer min-w-[72px] ${workspaceMode === 'table'
                  ? 'text-foreground font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
                  }`}
              >
                <TableIcon className={`w-3.5 h-3.5 transition-colors duration-200 ${workspaceMode === 'table' ? 'text-primary' : 'text-muted-foreground'}`} />
                <span>Table</span>
              </button>
              <button
                type="button"
                onClick={() => handleModeChange('json')}
                className={`relative z-10 inline-flex items-center justify-center gap-1.5 px-3.5 py-1 text-xs font-medium transition-colors duration-200 cursor-pointer min-w-[72px] ${workspaceMode === 'json'
                  ? 'text-foreground font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
                  }`}
              >
                <Code2 className={`w-3.5 h-3.5 transition-colors duration-200 ${workspaceMode === 'json' ? 'text-primary' : 'text-muted-foreground'}`} />
                <span>JSON</span>
              </button>
            </div>

            {/* Add Button */}
            {workspaceMode === 'table' && !isEditingRule && (
              <button
                type="button"
                onClick={handleOpenAdd}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-all hover:scale-102 active:scale-95 shadow-xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Rule</span>
              </button>
            )}

            {/* Apply Button */}
            <button
              type="button"
              disabled={isSaving}
              onClick={handleApplyConfig}
              className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 shadow-xs cursor-pointer disabled:opacity-50 active:scale-95 ${saveSuccess
                ? 'bg-emerald-600 text-white scale-102'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
            >
              {isSaving ? (
                <>
                  <RotateCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : saveSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5 animate-bounce" />
                  <span>Saved</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Apply Configuration</span>
                </>
              )}
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-all duration-150 hover:rotate-90 cursor-pointer ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Drawer Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {workspaceMode === 'table' ? (
            isEditingRule ? (
              /* INLINE RULE FORM - Replaces table inside drawer */
              <div className="space-y-5 animate-in fade-in duration-200">
                {/* Form Header */}
                <div className="flex items-center justify-between pb-3 border-b border-border">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditingRule(false);
                        setEditingIndex(null);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted border border-border/80 transition-colors cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Back to Table</span>
                    </button>
                    <div className="h-4 w-px bg-border" />
                    <div>
                      <h4 className="font-semibold text-sm text-foreground">
                        {editingIndex !== null ? 'Edit Rule' : 'Add New Rule'}
                      </h4>
                      <p className="text-[11px] text-muted-foreground">
                        Configure match conditions and execution behaviors directly for this extension.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Form Inputs (Pure UI view, no JSON mode toggle) */}
                <div className="bg-card border border-border rounded-xl p-6 shadow-xs space-y-4 text-xs">
                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1.5">
                      Rule Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={ruleForm.name}
                      onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
                      className="w-full px-3.5 py-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-2xs"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1.5">
                        Action
                      </label>
                      <select
                        value={ruleForm.action}
                        onChange={(e) => setRuleForm({ ...ruleForm, action: e.target.value })}
                        className="w-full px-3.5 py-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-2xs"
                      >
                        <option value="throttle">Throttle (Rate Limit 429)</option>
                        <option value="block">Block (Forbidden 403)</option>
                        <option value="challenge">Challenge (Interactive CAPTCHA)</option>
                        <option value="allow">Allow (Bypass / Whitelist)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1.5">
                        HTTP Method
                      </label>
                      <select
                        value={ruleForm.method}
                        onChange={(e) => setRuleForm({ ...ruleForm, method: e.target.value })}
                        className="w-full px-3.5 py-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-2xs"
                      >
                        <option value="ALL">ALL Methods</option>
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                        <option value="DELETE">DELETE</option>
                        <option value="PATCH">PATCH</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1.5">
                        Match Condition Type
                      </label>
                      <select
                        value={ruleForm.match_type}
                        onChange={(e) => setRuleForm({ ...ruleForm, match_type: e.target.value })}
                        className="w-full px-3.5 py-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-2xs"
                      >
                        <option value="path">URI Path (Path Prefix)</option>
                        <option value="ip">Client IP / CIDR</option>
                        <option value="header">Request Header</option>
                        <option value="all">All Requests (Global)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1.5">
                        Match Value
                      </label>
                      <input
                        type="text"
                        value={ruleForm.match_value || ''}
                        onChange={(e) => setRuleForm({ ...ruleForm, match_value: e.target.value })}
                        className="w-full px-3.5 py-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono shadow-2xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1.5">
                        Rate Limit (req/s)
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={ruleForm.rate ?? ''}
                        onChange={(e) =>
                          setRuleForm({
                            ...ruleForm,
                            rate: e.target.value ? parseInt(e.target.value, 10) : undefined,
                          })
                        }
                        className="w-full px-3.5 py-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono shadow-2xs"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1.5">
                        Burst Capacity
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={ruleForm.burst ?? ''}
                        onChange={(e) =>
                          setRuleForm({
                            ...ruleForm,
                            burst: e.target.value ? parseInt(e.target.value, 10) : undefined,
                          })
                        }
                        className="w-full px-3.5 py-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono shadow-2xs"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1.5">
                      Description / Notes
                    </label>
                    <input
                      type="text"
                      value={ruleForm.description || ''}
                      onChange={(e) => setRuleForm({ ...ruleForm, description: e.target.value })}
                      className="w-full px-3.5 py-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-2xs"
                    />
                  </div>

                  {/* Form Footer Buttons */}
                  <div className="pt-4 border-t border-border flex items-center justify-end gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditingRule(false);
                        setEditingIndex(null);
                      }}
                      className="px-4 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveRuleEntry}
                      disabled={!ruleForm.name.trim()}
                      className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-all cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {editingIndex !== null ? 'Update Rule' : 'Save Rule'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-6 animate-in fade-in duration-200">


                {/* Data Table Toolbar */}
                <div className="flex items-center justify-between gap-4">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-3 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      Showing <strong>{filteredRules.length}</strong> / {rules.length} rules
                    </span>
                  </div>
                </div>

                {/* Extension-Specific Data Table */}
                <div className="border border-border rounded-xl overflow-hidden shadow-xs bg-card">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/40 border-b border-border text-muted-foreground uppercase font-mono text-[10px] tracking-wider">
                      <tr>
                        <th className="py-3 px-4 w-1/12">Status</th>
                        <th className="py-3 px-4 w-3/12">Rule Name</th>
                        <th className="py-3 px-4 w-3/12">Match Condition</th>
                        <th className="py-3 px-4 w-2/12">Rate / Limits</th>
                        <th className="py-3 px-4 w-2/12">Action</th>
                        <th className="py-3 px-4 w-1/12 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {filteredRules.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-12 text-center text-muted-foreground">
                            <div className="flex flex-col items-center justify-center">
                              <Shield className="w-8 h-8 opacity-40 mb-2" />
                              <p className="text-sm font-semibold text-foreground">
                                No rules defined yet
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Click "+ Add Rule" above to define rules for this extension.
                              </p>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        filteredRules.map((rule, idx) => {
                          const originalIndex = rules.findIndex((r) => r.id === rule.id);
                          return (
                            <tr
                              key={rule.id}
                              className={`hover:bg-muted/30 transition-colors ${!rule.enabled ? 'opacity-60 bg-muted/10' : ''
                                }`}
                            >
                              {/* Status */}
                              <td className="py-3 px-4">
                                <button
                                  type="button"
                                  onClick={() => handleToggleRule(originalIndex)}
                                  className="cursor-pointer hover:scale-110 active:scale-95 transition-transform"
                                  title={rule.enabled ? 'Enabled' : 'Disabled'}
                                >
                                  {rule.enabled ? (
                                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                  ) : (
                                    <XCircle className="w-4 h-4 text-muted-foreground" />
                                  )}
                                </button>
                              </td>

                              {/* Name & ID */}
                              <td className="py-3 px-4">
                                <div>
                                  <span className="font-semibold text-foreground">{rule.name}</span>
                                  {rule.description && (
                                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                                      {rule.description}
                                    </p>
                                  )}
                                </div>
                              </td>

                              {/* Match condition */}
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {rule.method && (
                                    <span className="font-mono text-[10px] px-1.5 py-0.5 bg-muted rounded-sm border border-border/80">
                                      {rule.method}
                                    </span>
                                  )}
                                  <span className="font-mono text-[10px] px-2 py-0.5 bg-muted/80 text-foreground rounded-sm truncate max-w-[220px]">
                                    {rule.match_type ? `${rule.match_type}: ` : ''}
                                    {rule.match_value || 'All requests'}
                                  </span>
                                </div>
                              </td>

                              {/* Specs / Rate */}
                              <td className="py-3 px-4 font-mono text-[11px]">
                                {rule.rate ? (
                                  <span className="inline-flex items-center gap-1 text-primary bg-primary/10 px-2 py-0.5 rounded-sm border border-primary/20">
                                    <Gauge className="w-3 h-3" />
                                    <span>
                                      {rule.rate} r/s (burst {rule.burst ?? rule.rate})
                                    </span>
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </td>

                              {/* Action */}
                              <td className="py-3 px-4">
                                <span
                                  className={`px-2 py-0.5 rounded-none text-[10px] font-mono uppercase tracking-wider ${rule.action === 'block'
                                    ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                                    : rule.action === 'throttle'
                                      ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                                      : rule.action === 'challenge'
                                        ? 'bg-purple-500/10 text-purple-500 border border-purple-500/20'
                                        : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                                    }`}
                                >
                                  {rule.action || 'block'}
                                </span>
                              </td>

                              {/* Actions */}
                              <td className="py-3 px-4 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEdit(rule, originalIndex)}
                                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
                                    title="Edit"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteRule(originalIndex)}
                                    className="p-1 rounded text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                                    title="Delete"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          ) : (
            /* RAW JSON MODE */
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground uppercase tracking-wide">
                  Raw JSON Configuration
                </label>
                <div className="flex items-center gap-2">

                  <button
                    type="button"
                    onClick={handleFormat}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted px-2 py-1 rounded-sm border border-border/60 transition-all duration-150 cursor-pointer"
                  >
                    <Wand2 className="w-3 h-3" />
                    <span>Format</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (configText) {
                        void navigator.clipboard.writeText(configText);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted px-2 py-1 rounded-sm border border-border/60 transition-all duration-150 cursor-pointer"
                  >
                    {copied ? (
                      <Check className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted px-2 py-1 rounded-sm border border-border/60 transition-all duration-150 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset</span>
                  </button>
                </div>
              </div>

              <textarea
                rows={16}
                value={configText}
                onChange={(e) => {
                  setConfigText(e.target.value);
                  if (jsonError) setJsonError(null);
                }}
                className="w-full font-mono text-xs bg-muted/20 border border-border/80 rounded-xl p-4 text-foreground leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-200 resize-y"
                spellCheck={false}
              />
            </div>
          )}

          {/* Syntax Error Alert */}
          {jsonError && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-500/40 rounded-lg flex items-center gap-2 text-xs text-rose-700 dark:text-rose-400">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{jsonError}</span>
            </div>
          )}
        </div>

        {/* Footer info strip */}
        <div className="px-6 py-3 border-t border-border bg-muted/10 flex items-center justify-between text-xs text-muted-foreground shrink-0">
          <span className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span>
              Configuration is automatically persisted to SQLite Authority and synchronized to Dataplane Nodes.
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-md border border-border hover:bg-muted text-foreground transition-colors cursor-pointer"
          >
            Close Workspace
          </button>
        </div>
      </div>


    </div>
  );
}
