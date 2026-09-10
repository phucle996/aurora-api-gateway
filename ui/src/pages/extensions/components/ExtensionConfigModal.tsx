import React, { useState, useEffect } from 'react';
import { ExtensionItem } from '../types';
import { ExtensionIcon } from './ExtensionIcon';
import { EXTENSIONS_CATALOG, CATEGORIES_META } from '../data/catalog';
import { getDefaultConfigJson } from '../data/defaultConfigs';
import { ExtensionRulesDrawer, ExtensionRuleItem } from './ExtensionRulesDrawer';
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
} from 'lucide-react';

interface ExtensionConfigModalProps {
  extension: ExtensionItem | null;
  onClose: () => void;
  onSave: (id: string, configJSON: string) => Promise<boolean>;
}

export function ExtensionConfigModal({
  extension,
  onClose,
  onSave,
}: ExtensionConfigModalProps) {
  const [activeTab, setActiveTab] = useState<'visual' | 'json'>('visual');
  const [configText, setConfigText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [copied, setCopied] = useState(false);

  // Visual Editor State
  const [parsedConfig, setParsedConfig] = useState<Record<string, any>>({});
  const [rules, setRules] = useState<ExtensionRuleItem[]>([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Rule Form State (Inline Add/Edit)
  const [isAddingRule, setIsAddingRule] = useState(false);
  const [editingRuleIndex, setEditingRuleIndex] = useState<number | null>(null);
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

  // Initial loading from extension prop
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
      setIsAddingRule(false);
      setEditingRuleIndex(null);
      setActiveTab('visual');
    }
  }, [extension]);

  if (!extension) return null;

  // Sync Visual state into JSON text
  const syncVisualToJson = (updatedConfig: Record<string, any>, updatedRules: ExtensionRuleItem[]) => {
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

  // Sync JSON text into Visual state
  const syncJsonToVisual = (text: string): boolean => {
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

  const handleTabChange = (tab: 'visual' | 'json') => {
    if (tab === 'visual') {
      const ok = syncJsonToVisual(configText);
      if (!ok) return; // Prevent switching if JSON is broken
    } else {
      syncVisualToJson(parsedConfig, rules);
    }
    setActiveTab(tab);
  };

  const handleFormat = () => {
    try {
      const parsed = JSON.parse(configText);
      setConfigText(JSON.stringify(parsed, null, 2));
      setJsonError(null);
    } catch (e) {
      setJsonError((e as Error).message);
    }
  };

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
    setIsAddingRule(false);
    setEditingRuleIndex(null);
  };

  const handleLoadTemplate = () => {
    const defaultTemplate = getDefaultConfigJson(extension.id);
    let templateStr = '';
    if (defaultTemplate && defaultTemplate !== '{}') {
      templateStr = defaultTemplate;
    } else if (catalogEntry && catalogEntry.config_json) {
      try {
        const parsed = JSON.parse(catalogEntry.config_json);
        templateStr = JSON.stringify(parsed, null, 2);
      } catch {
        templateStr = catalogEntry.config_json;
      }
    }

    if (templateStr) {
      setConfigText(templateStr);
      syncJsonToVisual(templateStr);
    }
    setJsonError(null);
  };

  const handleCopy = () => {
    if (configText) {
      void navigator.clipboard.writeText(configText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Rule management helpers
  const handleOpenAddRule = () => {
    setRuleForm({
      id: `rule_${Date.now()}`,
      name: `Quy tắc ${rules.length + 1}`,
      description: '',
      enabled: true,
      match_type: 'path',
      match_value: '/api/',
      method: 'ALL',
      rate: 100,
      burst: 200,
      period_secs: 1,
      action: 'throttle',
      custom_code: 429,
      custom_message: 'Too Many Requests',
    });
    setEditingRuleIndex(null);
    setIsAddingRule(true);
  };

  const handleOpenEditRule = (rule: ExtensionRuleItem, index: number) => {
    setRuleForm({ ...rule });
    setEditingRuleIndex(index);
    setIsAddingRule(true);
    setIsDrawerOpen(false);
  };

  const handleSaveRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleForm.name.trim()) return;

    let updatedRules: ExtensionRuleItem[];
    if (editingRuleIndex !== null) {
      updatedRules = [...rules];
      updatedRules[editingRuleIndex] = ruleForm;
    } else {
      updatedRules = [...rules, ruleForm];
    }

    setRules(updatedRules);
    syncVisualToJson(parsedConfig, updatedRules);
    setIsAddingRule(false);
    setEditingRuleIndex(null);
  };

  const handleDeleteRule = (index: number) => {
    const updated = rules.filter((_, i) => i !== index);
    setRules(updated);
    syncVisualToJson(parsedConfig, updated);
  };

  const handleToggleRule = (index: number) => {
    const updated = [...rules];
    updated[index] = { ...updated[index], enabled: !updated[index].enabled };
    setRules(updated);
    syncVisualToJson(parsedConfig, updated);
  };

  const handleFieldChange = (key: string, value: any) => {
    const next = { ...parsedConfig, [key]: value };
    setParsedConfig(next);
    syncVisualToJson(next, rules);
  };

  const handleSave = async () => {
    try {
      let finalJson = configText;
      if (activeTab === 'visual') {
        finalJson = syncVisualToJson(parsedConfig, rules);
      }

      // Validate JSON
      const parsed = JSON.parse(finalJson);
      const minified = JSON.stringify(parsed);
      setJsonError(null);

      setIsSaving(true);
      const ok = await onSave(extension.id, minified);
      if (ok) {
        setSaveSuccess(true);
        setTimeout(() => {
          onClose();
        }, 800);
      }
    } catch (e) {
      setJsonError('Cú pháp JSON không hợp lệ: ' + (e as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-3 duration-200 ease-out"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-muted/20">
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-md ${
                meta?.iconBgClass || 'bg-primary/10 text-primary'
              } transition-transform duration-200 hover:scale-105`}
            >
              <ExtensionIcon id={extension.id} category={extension.category} className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-base text-foreground">{extension.name}</h3>
                <span className="font-mono text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-none">
                  {extension.id}
                </span>
                {meta && (
                  <span
                    className={`px-2 py-0.5 rounded-none text-[10px] font-medium border uppercase tracking-wider ${meta.badgeClass}`}
                  >
                    {meta.label}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{extension.description}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-all duration-200 hover:rotate-90 hover:scale-110 active:scale-95 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Selector & Navigation */}
        <div className="px-5 py-2.5 border-b border-border bg-muted/10 flex items-center justify-between">
          <div className="flex items-center gap-1 bg-muted/50 p-0.5 rounded-md border border-border/60">
            <button
              type="button"
              onClick={() => handleTabChange('visual')}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-sm text-xs font-medium transition-all duration-150 cursor-pointer ${
                activeTab === 'visual'
                  ? 'bg-card text-foreground shadow-xs border border-border'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-primary" />
              <span>Nhập UI / Quy tắc</span>
              {rules.length > 0 && (
                <span className="px-1.5 py-0.2 text-[10px] font-mono rounded-full bg-primary/10 text-primary">
                  {rules.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => handleTabChange('json')}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-sm text-xs font-medium transition-all duration-150 cursor-pointer ${
                activeTab === 'json'
                  ? 'bg-card text-foreground shadow-xs border border-border'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>JSON Raw</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {activeTab === 'visual' && (
              <button
                type="button"
                onClick={() => setIsDrawerOpen(true)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground bg-muted/60 hover:bg-muted px-2.5 py-1.5 rounded-sm border border-border transition-all duration-150 cursor-pointer hover:scale-102"
              >
                <Layers className="w-3.5 h-3.5 text-primary" />
                <span>Xem danh sách quy tắc</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-primary text-primary-foreground font-mono">
                  {rules.length}
                </span>
              </button>
            )}

            {activeTab === 'json' && (
              <>
                {catalogEntry && (
                  <button
                    type="button"
                    onClick={handleLoadTemplate}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted px-2 py-1 rounded-sm border border-border/60 transition-all duration-150 cursor-pointer"
                    title="Nạp mẫu mặc định"
                  >
                    <FileCode className="w-3 h-3 text-primary" />
                    <span>Template</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleFormat}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted px-2 py-1 rounded-sm border border-border/60 transition-all duration-150 cursor-pointer"
                  title="Định dạng JSON"
                >
                  <Wand2 className="w-3 h-3" />
                  <span>Format</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted px-2 py-1 rounded-sm border border-border/60 transition-all duration-150 cursor-pointer"
                  title="Sao chép JSON"
                >
                  {copied ? (
                    <Check className="w-3 h-3 text-emerald-500" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  <span>{copied ? 'Đã sao chép' : 'Copy'}</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted px-2 py-1 rounded-sm border border-border/60 transition-all duration-150 cursor-pointer"
              title="Đặt lại cấu hình"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {/* TAB 1: VISUAL UI BUILDER */}
          {activeTab === 'visual' && (
            <div className="space-y-6 animate-in fade-in-50 duration-150">
              {/* General Settings Card */}
              <div className="p-4 rounded-lg border border-border bg-muted/10 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-border/60">
                  <div>
                    <h4 className="font-semibold text-xs text-foreground uppercase tracking-wider">
                      Cài đặt chung Extension
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Trạng thái hoạt động và tham số mặc định của module
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={parsedConfig.enabled !== false}
                      onChange={(e) => handleFieldChange('enabled', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                    <span className="ml-2.5 text-xs font-medium text-foreground">
                      {parsedConfig.enabled !== false ? 'Đang bật' : 'Tắt'}
                    </span>
                  </label>
                </div>

                {/* Dynamic Parameter Grid (Key-values like rate, burst, mode, etc.) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
                  {/* Rate Limiting specific friendly fields if applicable */}
                  {(extension.id.includes('rate-limit') ||
                    parsedConfig.rate !== undefined ||
                    parsedConfig.default_rate !== undefined) && (
                    <>
                      <div>
                        <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                          Ngưỡng giới hạn mặc định (Rate - req/s)
                        </label>
                        <input
                          type="number"
                          value={parsedConfig.rate ?? parsedConfig.default_rate ?? 100}
                          onChange={(e) =>
                            handleFieldChange('rate', parseInt(e.target.value, 10) || 1)
                          }
                          className="w-full px-3 py-1.5 bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                          Dung lượng bùng phát (Burst)
                        </label>
                        <input
                          type="number"
                          value={parsedConfig.burst ?? parsedConfig.default_burst ?? 200}
                          onChange={(e) =>
                            handleFieldChange('burst', parseInt(e.target.value, 10) || 1)
                          }
                          className="w-full px-3 py-1.5 bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                          Phương thức định danh (Limit By)
                        </label>
                        <select
                          value={parsedConfig.limit_by ?? 'ip'}
                          onChange={(e) => handleFieldChange('limit_by', e.target.value)}
                          className="w-full px-3 py-1.5 bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                          <option value="ip">Địa chỉ IP Khách (Client IP)</option>
                          <option value="header">Request Header</option>
                          <option value="path">Đường dẫn URI (Path)</option>
                          <option value="jwt_claim">JWT Claim / Token Sub</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                          Mã phản hồi từ chối (HTTP Status)
                        </label>
                        <select
                          value={parsedConfig.rejected_code ?? 429}
                          onChange={(e) =>
                            handleFieldChange('rejected_code', parseInt(e.target.value, 10))
                          }
                          className="w-full px-3 py-1.5 bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                          <option value={429}>429 Too Many Requests</option>
                          <option value={403}>403 Forbidden</option>
                          <option value={503}>503 Service Unavailable</option>
                        </select>
                      </div>
                    </>
                  )}

                  {/* Mode Selector if present */}
                  {parsedConfig.mode !== undefined && (
                    <div>
                      <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                        Chế độ hoạt động (Mode)
                      </label>
                      <select
                        value={parsedConfig.mode}
                        onChange={(e) => handleFieldChange('mode', e.target.value)}
                        className="w-full px-3 py-1.5 bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value="enforce">Enforce (Chặn vi phạm)</option>
                        <option value="monitor">Monitor / Log Only (Giám sát)</option>
                        <option value="disabled">Disabled (Vô hiệu hóa)</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* RULES SECTION */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-primary" />
                    <h4 className="font-semibold text-xs text-foreground uppercase tracking-wider">
                      Quy tắc áp dụng (Rules Engine)
                    </h4>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-primary/10 text-primary border border-primary/20">
                      {rules.length} quy tắc
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleOpenAddRule}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-all hover:scale-102 active:scale-95 shadow-xs cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Thêm quy tắc</span>
                    </button>
                  </div>
                </div>

                {/* Inline Rule Creator / Editor */}
                {isAddingRule && (
                  <form
                    onSubmit={handleSaveRule}
                    className="p-4 rounded-lg border-2 border-primary/40 bg-card shadow-md space-y-4 animate-in fade-in zoom-in-98 duration-150"
                  >
                    <div className="flex items-center justify-between pb-2 border-b border-border/80">
                      <span className="font-semibold text-xs text-foreground flex items-center gap-1.5">
                        <SlidersHorizontal className="w-3.5 h-3.5 text-primary" />
                        <span>
                          {editingRuleIndex !== null ? 'Chỉnh sửa quy tắc' : 'Thêm quy tắc mới'}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsAddingRule(false)}
                        className="text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div>
                        <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                          Tên quy tắc *
                        </label>
                        <input
                          type="text"
                          required
                          value={ruleForm.name}
                          onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
                          placeholder="VD: Chặn spam đăng nhập"
                          className="w-full px-3 py-1.5 bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>

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
                          <option value="challenge">Challenge (Xác thực CAPTCHA/JS)</option>
                          <option value="allow">Allow (Bypass / Ưu tiên cho phép)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                          Loại điều kiện (Match Type)
                        </label>
                        <select
                          value={ruleForm.match_type}
                          onChange={(e) => setRuleForm({ ...ruleForm, match_type: e.target.value })}
                          className="w-full px-3 py-1.5 bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                          <option value="path">Đường dẫn URI (Path Prefix / Regex)</option>
                          <option value="ip">Địa chỉ IP / Dải mạng CIDR</option>
                          <option value="header">Tiêu đề HTTP Header</option>
                          <option value="all">Toàn bộ lưu lượng (Global)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                          Giá trị khớp (Match Value)
                        </label>
                        <input
                          type="text"
                          value={ruleForm.match_value || ''}
                          onChange={(e) =>
                            setRuleForm({ ...ruleForm, match_value: e.target.value })
                          }
                          placeholder="/api/v1/login hoặc 192.168.1.0/24"
                          className="w-full px-3 py-1.5 bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                          Tốc độ cho phép (Rate - req/s)
                        </label>
                        <input
                          type="number"
                          value={ruleForm.rate ?? 100}
                          onChange={(e) =>
                            setRuleForm({
                              ...ruleForm,
                              rate: parseInt(e.target.value, 10) || 1,
                            })
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
                            setRuleForm({
                              ...ruleForm,
                              burst: parseInt(e.target.value, 10) || 1,
                            })
                          }
                          className="w-full px-3 py-1.5 bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/80">
                      <button
                        type="button"
                        onClick={() => setIsAddingRule(false)}
                        className="px-3 py-1.5 rounded-sm border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                      >
                        Hủy
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-1.5 rounded-sm bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-all cursor-pointer"
                      >
                        {editingRuleIndex !== null ? 'Cập nhật quy tắc' : 'Lưu quy tắc'}
                      </button>
                    </div>
                  </form>
                )}

                {/* Summary Rule Cards */}
                {rules.length === 0 && !isAddingRule ? (
                  <div className="p-6 text-center border border-dashed border-border rounded-lg bg-muted/5">
                    <p className="text-xs text-muted-foreground">
                      Chưa có quy tắc nào trong extension. Bấm{' '}
                      <span className="font-semibold text-foreground">"+ Thêm quy tắc"</span> để bắt
                      đầu tạo bộ luật kiểm soát.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2.5">
                    {rules.slice(0, 4).map((rule, idx) => (
                      <div
                        key={rule.id}
                        className="p-3 rounded-md border border-border bg-card hover:bg-muted/30 transition-all flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => handleToggleRule(idx)}
                            className="cursor-pointer text-muted-foreground hover:text-foreground shrink-0"
                            title={rule.enabled ? 'Đang bật' : 'Đang tắt'}
                          >
                            {rule.enabled ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            ) : (
                              <XCircle className="w-4 h-4 text-muted-foreground" />
                            )}
                          </button>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground truncate">
                                {rule.name}
                              </span>
                              <span
                                className={`px-1.5 py-0.2 rounded-none text-[10px] font-mono uppercase ${
                                  rule.action === 'block'
                                    ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                                    : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                                }`}
                              >
                                {rule.action || 'block'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                              {rule.match_value && (
                                <span className="font-mono text-[10px] bg-muted px-1 rounded-sm truncate max-w-[200px]">
                                  {rule.match_value}
                                </span>
                              )}
                              {rule.rate && (
                                <span>
                                  {rule.rate} r/s (burst {rule.burst ?? rule.rate})
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleOpenEditRule(rule, idx)}
                            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
                            title="Chỉnh sửa"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteRule(idx)}
                            className="p-1 rounded text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                            title="Xóa"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}

                    {rules.length > 4 && (
                      <button
                        type="button"
                        onClick={() => setIsDrawerOpen(true)}
                        className="w-full py-2 border border-dashed border-border/80 rounded-md text-xs text-primary hover:bg-primary/5 transition-colors cursor-pointer text-center font-medium"
                      >
                        + Xem thêm {rules.length - 4} quy tắc khác trong Drawer
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: RAW JSON CODE EDITOR */}
          {activeTab === 'json' && (
            <div className="space-y-4 animate-in fade-in-50 duration-150">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground tracking-wide uppercase">
                  Cấu hình chi tiết (JSON Config)
                </label>
                <span className="text-[11px] text-muted-foreground">
                  Hỗ trợ đồng bộ trực tiếp với Tab Nhập UI & Rules
                </span>
              </div>

              {/* JSON Textarea Editor */}
              <div className="relative">
                <textarea
                  rows={14}
                  value={configText}
                  onChange={(e) => {
                    setConfigText(e.target.value);
                    if (jsonError) setJsonError(null);
                  }}
                  className="w-full font-mono text-xs bg-muted/20 border border-border/80 rounded-md p-3.5 text-foreground leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-200 resize-y"
                  spellCheck={false}
                />
              </div>

              {/* Syntax Error Alert */}
              {jsonError && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-500/40 rounded-sm flex items-center gap-2 text-xs text-rose-700 dark:text-rose-400 animate-in fade-in slide-in-from-top-1 duration-150">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{jsonError}</span>
                </div>
              )}
            </div>
          )}

          {/* Info note */}
          <div className="p-3 bg-muted/30 border border-border/60 rounded-sm text-[11px] text-muted-foreground space-y-1">
            <span className="font-semibold text-foreground">Declarative Cluster Sync:</span>
            <p>
              Các thay đổi cấu hình được lưu vào SQLite authority và biên dịch tự động thành NodeSpec
              YAML manifest gửi tới các NGINX Dataplane Node trong chu kỳ tiếp theo.
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 border-t border-border bg-muted/20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {saveSuccess && (
              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium animate-in fade-in zoom-in-95 duration-200">
                <span className="p-0.5 rounded-full bg-emerald-500/10 text-emerald-500">
                  <Check className="w-3.5 h-3.5" />
                </span>
                <span>Đã lưu cấu hình thành công</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-sm border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150 active:scale-95 cursor-pointer"
            >
              Đóng
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSave}
              className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-sm text-xs font-semibold transition-all duration-200 shadow-xs cursor-pointer disabled:opacity-50 active:scale-95 ${
                saveSuccess
                  ? 'bg-emerald-600 text-white scale-102'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90 hover:scale-102'
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
          </div>
        </div>
      </div>

      {/* Slide-over Rules Drawer */}
      <ExtensionRulesDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        rules={rules}
        onAddRule={() => {
          setIsDrawerOpen(false);
          handleOpenAddRule();
        }}
        onEditRule={handleOpenEditRule}
        onDeleteRule={handleDeleteRule}
        onToggleRule={handleToggleRule}
      />
    </div>
  );
}
