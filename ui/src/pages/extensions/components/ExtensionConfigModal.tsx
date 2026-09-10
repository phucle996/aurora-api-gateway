import React, { useState, useEffect } from 'react';
import { ExtensionItem } from '../types';
import { ExtensionIcon } from './ExtensionIcon';
import { EXTENSIONS_CATALOG, CATEGORIES_META } from '../data/catalog';
import { getDefaultConfigJson } from '../data/defaultConfigs';
import { ExtensionRuleItem } from './ExtensionRulesDrawer';
import {
  X,
  Check,
  AlertCircle,
  Wand2,
  RotateCcw,
  Save,
  RotateCw,
  FileCode,
  Copy,
  SlidersHorizontal,
  Plus,
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

  // Add/Edit Sub-Panel State
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<'ui' | 'json'>('ui');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [ruleJsonText, setRuleJsonText] = useState('');
  const [ruleJsonError, setRuleJsonError] = useState<string | null>(null);

  // Form state for UI mode
  const [ruleForm, setRuleForm] = useState<ExtensionRuleItem>({
    id: '',
    name: '',
    description: '',
    enabled: true,
    match_type: 'path',
    match_value: '',
    method: 'ALL',
    rate: 100,
    burst: 200,
    period_secs: 1,
    action: 'throttle',
    custom_code: 429,
    custom_message: 'Too Many Requests',
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
      setIsAddOpen(false);
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
      setJsonError('Lỗi cú pháp JSON: ' + (e as Error).message);
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

  // Open Add Rule Panel
  const handleOpenAdd = () => {
    const newRule: ExtensionRuleItem = {
      id: `rule_${Date.now().toString(36)}`,
      name: `Quy tắc ${rules.length + 1}`,
      description: '',
      enabled: true,
      match_type: 'path',
      match_value: '/api/',
      method: 'ALL',
      rate: parsedConfig.rate || 100,
      burst: parsedConfig.burst || 200,
      period_secs: 1,
      action: isRateLimit ? 'throttle' : 'block',
      custom_code: 429,
      custom_message: 'Too Many Requests',
    };
    setRuleForm(newRule);
    setRuleJsonText(JSON.stringify(newRule, null, 2));
    setRuleJsonError(null);
    setEditingIndex(null);
    setAddMode('ui');
    setIsAddOpen(true);
  };

  // Open Edit Rule
  const handleOpenEdit = (rule: ExtensionRuleItem, index: number) => {
    setRuleForm({ ...rule });
    setRuleJsonText(JSON.stringify(rule, null, 2));
    setRuleJsonError(null);
    setEditingIndex(index);
    setAddMode('ui');
    setIsAddOpen(true);
  };

  // Save Rule from Add/Edit panel (supporting both UI mode and JSON mode)
  const handleSaveRuleEntry = () => {
    let savedRule: ExtensionRuleItem;
    if (addMode === 'json') {
      try {
        savedRule = JSON.parse(ruleJsonText);
        if (!savedRule.id) savedRule.id = `rule_${Date.now().toString(36)}`;
        if (!savedRule.name) savedRule.name = 'Quy tắc mới';
      } catch (e) {
        setRuleJsonError('Lỗi cú pháp JSON: ' + (e as Error).message);
        return;
      }
    } else {
      if (!ruleForm.name.trim()) return;
      savedRule = { ...ruleForm };
    }

    let updatedRules: ExtensionRuleItem[];
    if (editingIndex !== null) {
      updatedRules = [...rules];
      updatedRules[editingIndex] = savedRule;
    } else {
      updatedRules = [...rules, savedRule];
    }

    setRules(updatedRules);
    syncToJSON(parsedConfig, updatedRules);
    setIsAddOpen(false);
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
    setIsAddOpen(false);
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
      setJsonError('Cú pháp JSON không hợp lệ: ' + (e as Error).message);
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
              className={`p-2.5 rounded-xl ${
                meta?.iconBgClass || 'bg-primary/10 text-primary'
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
              <span className="text-xs font-medium text-muted-foreground">Trạng thái:</span>
              <button
                type="button"
                role="switch"
                aria-checked={parsedConfig.enabled !== false}
                onClick={handleToggleExtension}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-all duration-300 ease-in-out hover:scale-105 active:scale-95 focus:outline-none focus:ring-1 focus:ring-primary ${
                  parsedConfig.enabled !== false ? 'bg-emerald-500 shadow-xs' : 'bg-muted/80'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                    parsedConfig.enabled !== false ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
              <span
                className={`text-xs font-semibold ${
                  parsedConfig.enabled !== false
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-muted-foreground'
                }`}
              >
                {parsedConfig.enabled !== false ? 'Đang Bật' : 'Tắt'}
              </span>
            </div>

            {/* Mode Switch: Table vs JSON */}
            <div className="flex items-center p-0.5 bg-muted/60 rounded-lg border border-border">
              <button
                type="button"
                onClick={() => handleModeChange('table')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 cursor-pointer ${
                  workspaceMode === 'table'
                    ? 'bg-card text-foreground shadow-xs border border-border/80'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <TableIcon className="w-3.5 h-3.5 text-primary" />
                <span>Bảng dữ liệu & Rules</span>
              </button>
              <button
                type="button"
                onClick={() => handleModeChange('json')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 cursor-pointer ${
                  workspaceMode === 'json'
                    ? 'bg-card text-foreground shadow-xs border border-border/80'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Code2 className="w-3.5 h-3.5" />
                <span>JSON Raw</span>
              </button>
            </div>

            {/* Add Button */}
            {workspaceMode === 'table' && (
              <button
                type="button"
                onClick={handleOpenAdd}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-all hover:scale-102 active:scale-95 shadow-xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Thêm quy tắc</span>
              </button>
            )}

            {/* Apply Button */}
            <button
              type="button"
              disabled={isSaving}
              onClick={handleApplyConfig}
              className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 shadow-xs cursor-pointer disabled:opacity-50 active:scale-95 ${
                saveSuccess
                  ? 'bg-emerald-600 text-white scale-102'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
              }`}
            >
              {isSaving ? (
                <>
                  <RotateCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Đang lưu...</span>
                </>
              ) : saveSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5 animate-bounce" />
                  <span>Đã lưu</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Áp dụng cấu hình</span>
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
            <div className="space-y-6">
              {/* Extension-Specific Parameter Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl border border-border bg-muted/10 text-xs">
                {isRateLimit ? (
                  <>
                    <div>
                      <span className="text-[11px] text-muted-foreground block mb-0.5">
                        Tốc độ mặc định
                      </span>
                      <span className="font-semibold text-foreground font-mono text-sm">
                        {parsedConfig.rate ?? parsedConfig.default_rate ?? 100} req/s
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] text-muted-foreground block mb-0.5">
                        Dung lượng Burst
                      </span>
                      <span className="font-semibold text-foreground font-mono text-sm">
                        {parsedConfig.burst ?? parsedConfig.default_burst ?? 200}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] text-muted-foreground block mb-0.5">
                        Định danh theo
                      </span>
                      <span className="font-semibold text-foreground font-mono uppercase text-xs">
                        {parsedConfig.limit_by ?? 'Client IP'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] text-muted-foreground block mb-0.5">
                        HTTP Phản hồi
                      </span>
                      <span className="font-semibold text-rose-500 font-mono text-sm">
                        {parsedConfig.rejected_code ?? 429} Too Many Requests
                      </span>
                    </div>
                  </>
                ) : isBotOrSecurity ? (
                  <>
                    <div>
                      <span className="text-[11px] text-muted-foreground block mb-0.5">
                        Chế độ phòng thủ
                      </span>
                      <span className="font-semibold text-foreground font-mono uppercase text-xs">
                        {parsedConfig.mode ?? 'Enforce'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] text-muted-foreground block mb-0.5">
                        Độ nhạy (Sensitivity)
                      </span>
                      <span className="font-semibold text-foreground font-mono text-xs">
                        {parsedConfig.sensitivity ?? 'High'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] text-muted-foreground block mb-0.5">
                        Ngưỡng Anomaly
                      </span>
                      <span className="font-semibold text-foreground font-mono text-xs">
                        {parsedConfig.anomaly_threshold ?? 5} điểm
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] text-muted-foreground block mb-0.5">
                        Hành vi vi phạm
                      </span>
                      <span className="font-semibold text-rose-500 font-mono text-xs uppercase">
                        {parsedConfig.action ?? 'Block (403)'}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <span className="text-[11px] text-muted-foreground block mb-0.5">
                        Mã định danh
                      </span>
                      <span className="font-mono text-xs text-foreground">{extension.id}</span>
                    </div>
                    <div>
                      <span className="text-[11px] text-muted-foreground block mb-0.5">
                        Nhóm phân loại
                      </span>
                      <span className="font-medium text-xs text-foreground uppercase">
                        {extension.category}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] text-muted-foreground block mb-0.5">
                        Số quy tắc cấu hình
                      </span>
                      <span className="font-mono text-xs text-primary font-bold">
                        {rules.length} quy tắc
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] text-muted-foreground block mb-0.5">
                        Thời gian tạo
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {new Date().toLocaleDateString()}
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/* Data Table Toolbar */}
              <div className="flex items-center justify-between gap-4">
                <div className="relative flex-1 max-w-sm">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Tìm quy tắc trong bảng (tên, URI, action)..."
                    className="w-full pl-9 pr-3 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    Hiển thị <strong>{filteredRules.length}</strong> / {rules.length} quy tắc
                  </span>
                </div>
              </div>

              {/* Extension-Specific Data Table */}
              <div className="border border-border rounded-xl overflow-hidden shadow-xs bg-card">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/40 border-b border-border text-muted-foreground uppercase font-mono text-[10px] tracking-wider">
                    <tr>
                      <th className="py-3 px-4 w-1/12">Status</th>
                      <th className="py-3 px-4 w-3/12">Tên quy tắc</th>
                      <th className="py-3 px-4 w-3/12">Điều kiện khớp (Match)</th>
                      <th className="py-3 px-4 w-2/12">Thông số / Giới hạn</th>
                      <th className="py-3 px-4 w-2/12">Hành động</th>
                      <th className="py-3 px-4 w-1/12 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredRules.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-muted-foreground">
                          <div className="flex flex-col items-center justify-center">
                            <Shield className="w-8 h-8 opacity-40 mb-2" />
                            <p className="text-sm font-semibold text-foreground">
                              Chưa có quy tắc nào
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Nhấn "+ Thêm quy tắc" ở góc trên để bắt đầu thêm bộ luật cho extension.
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
                            className={`hover:bg-muted/30 transition-colors ${
                              !rule.enabled ? 'opacity-60 bg-muted/10' : ''
                            }`}
                          >
                            {/* Status */}
                            <td className="py-3 px-4">
                              <button
                                type="button"
                                onClick={() => handleToggleRule(originalIndex)}
                                className="cursor-pointer hover:scale-110 active:scale-95 transition-transform"
                                title={rule.enabled ? 'Đang bật' : 'Đang tắt'}
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
                                  {rule.match_value || 'Mọi request'}
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
                                className={`px-2 py-0.5 rounded-none text-[10px] font-mono uppercase tracking-wider ${
                                  rule.action === 'block'
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
                                  title="Chỉnh sửa"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteRule(originalIndex)}
                                  className="p-1 rounded text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                                  title="Xóa"
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
          ) : (
            /* RAW JSON MODE */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground uppercase tracking-wide">
                  Cấu hình thô (Raw JSON Configuration)
                </label>
                <div className="flex items-center gap-2">
                  {catalogEntry && (
                    <button
                      type="button"
                      onClick={() => {
                        const defaultTemplate = getDefaultConfigJson(extension.id);
                        if (defaultTemplate && defaultTemplate !== '{}') {
                          setConfigText(defaultTemplate);
                          syncFromJSON(defaultTemplate);
                        }
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted px-2 py-1 rounded-sm border border-border/60 transition-all duration-150 cursor-pointer"
                    >
                      <FileCode className="w-3 h-3 text-primary" />
                      <span>Template</span>
                    </button>
                  )}
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
                    <span>{copied ? 'Đã copy' : 'Copy'}</span>
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
              Cấu hình được tự động lưu vào SQLite Authority và đồng bộ xuống Dataplane Nodes.
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-md border border-border hover:bg-muted text-foreground transition-colors cursor-pointer"
          >
            Đóng Workspace
          </button>
        </div>
      </div>

      {/* SUB-PANEL: ADD / EDIT RULE WITH 2 MODES (UI VIEW & JSON VIEW) */}
      {isAddOpen && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setIsAddOpen(false)}
        >
          <div
            className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sub-panel Header */}
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between bg-muted/20">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-primary" />
                <h4 className="font-semibold text-sm text-foreground">
                  {editingIndex !== null ? 'Chỉnh sửa quy tắc' : 'Thêm quy tắc mới'}
                </h4>
              </div>

              {/* Mode switch for Add Rule: UI View vs JSON View */}
              <div className="flex items-center p-0.5 bg-muted/60 rounded-md border border-border">
                <button
                  type="button"
                  onClick={() => setAddMode('ui')}
                  className={`px-2.5 py-1 rounded-sm text-[11px] font-medium transition-all ${
                    addMode === 'ui'
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  UI View
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRuleJsonText(JSON.stringify(ruleForm, null, 2));
                    setAddMode('json');
                  }}
                  className={`px-2.5 py-1 rounded-sm text-[11px] font-medium transition-all ${
                    addMode === 'json'
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  JSON View
                </button>
              </div>
            </div>

            {/* Sub-panel Body */}
            <div className="p-5 space-y-4">
              {addMode === 'ui' ? (
                <div className="space-y-3.5 text-xs">
                  <div>
                    <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                      Tên quy tắc *
                    </label>
                    <input
                      type="text"
                      required
                      value={ruleForm.name}
                      onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
                      placeholder="VD: Chặn spam login"
                      className="w-full px-3 py-1.5 bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                        Hành động (Action)
                      </label>
                      <select
                        value={ruleForm.action}
                        onChange={(e) => setRuleForm({ ...ruleForm, action: e.target.value })}
                        className="w-full px-3 py-1.5 bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value="throttle">Throttle (Giới hạn tốc độ 429)</option>
                        <option value="block">Block (Chặn truy cập 403)</option>
                        <option value="challenge">Challenge (Xác thực CAPTCHA)</option>
                        <option value="allow">Allow (Bypass / Ưu tiên cho phép)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                        Phương thức HTTP
                      </label>
                      <select
                        value={ruleForm.method}
                        onChange={(e) => setRuleForm({ ...ruleForm, method: e.target.value })}
                        className="w-full px-3 py-1.5 bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value="ALL">ALL Methods</option>
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                        <option value="DELETE">DELETE</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                        Loại điều kiện khớp
                      </label>
                      <select
                        value={ruleForm.match_type}
                        onChange={(e) => setRuleForm({ ...ruleForm, match_type: e.target.value })}
                        className="w-full px-3 py-1.5 bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value="path">Đường dẫn URI (Path Prefix)</option>
                        <option value="ip">Địa chỉ IP / CIDR</option>
                        <option value="header">Request Header</option>
                        <option value="all">Tất cả request (Global)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                        Giá trị khớp (Match Value)
                      </label>
                      <input
                        type="text"
                        value={ruleForm.match_value || ''}
                        onChange={(e) => setRuleForm({ ...ruleForm, match_value: e.target.value })}
                        placeholder="/api/v1/auth/login"
                        className="w-full px-3 py-1.5 bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                        Tốc độ giới hạn (Rate - req/s)
                      </label>
                      <input
                        type="number"
                        value={ruleForm.rate ?? 100}
                        onChange={(e) =>
                          setRuleForm({ ...ruleForm, rate: parseInt(e.target.value, 10) || 1 })
                        }
                        className="w-full px-3 py-1.5 bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                        Dung lượng bùng phát (Burst)
                      </label>
                      <input
                        type="number"
                        value={ruleForm.burst ?? 200}
                        onChange={(e) =>
                          setRuleForm({ ...ruleForm, burst: parseInt(e.target.value, 10) || 1 })
                        }
                        className="w-full px-3 py-1.5 bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                /* JSON VIEW FOR RULE */
                <div className="space-y-2">
                  <label className="block text-[11px] font-medium text-muted-foreground">
                    Định nghĩa Rule bằng JSON
                  </label>
                  <textarea
                    rows={10}
                    value={ruleJsonText}
                    onChange={(e) => {
                      setRuleJsonText(e.target.value);
                      if (ruleJsonError) setRuleJsonError(null);
                    }}
                    className="w-full font-mono text-xs bg-muted/20 border border-border rounded-md p-3 text-foreground leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary"
                    spellCheck={false}
                  />
                  {ruleJsonError && (
                    <p className="text-xs text-rose-500 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>{ruleJsonError}</span>
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Sub-panel Footer */}
            <div className="px-5 py-3 border-t border-border bg-muted/20 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
                className="px-3.5 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleSaveRuleEntry}
                className="px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-all cursor-pointer shadow-xs"
              >
                Lưu vào danh sách
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
