import { useState, useEffect, useMemo } from 'react';
import { ExtensionConfigModalProps, ExtensionRenderContext, SchemaField } from './config/types';
import { ExtensionConfigHeader } from './config/ExtensionConfigHeader';
import { ExtensionVisualForm } from './config/ExtensionVisualForm';
import { ExtensionRulesTable } from './config/ExtensionRulesTable';
import { ExtensionRuleEditForm } from './config/ExtensionRuleEditForm';
import { ExtensionRawJson } from './config/ExtensionRawJson';
import { ExtensionConfigFooter } from './config/ExtensionConfigFooter';
import { Table as TableIcon, SlidersHorizontal } from 'lucide-react';

export function ExtensionConfigModal({
  extension,
  onClose,
  onSave,
  onToggleStatus,
}: ExtensionConfigModalProps) {
  if (!extension) return null;

  // Render Context from Database Source of Truth
  const schema: ExtensionRenderContext = useMemo(() => {
    try {
      if (extension.ui_schema_json && extension.ui_schema_json.trim() !== '{}') {
        return JSON.parse(extension.ui_schema_json);
      }
    } catch (e) {
      console.error('Failed to parse extension ui_schema_json:', e);
    }
    return {
      title: extension.name,
      description: extension.description,
      layout_type: 'form',
      fields: [],
    };
  }, [extension.ui_schema_json, extension.name, extension.description]);

  const [workspaceMode, setWorkspaceMode] = useState<'visual' | 'json'>('visual');
  const [configText, setConfigText] = useState<string>('');
  const [parsedConfig, setParsedConfig] = useState<Record<string, any>>({});
  const [rules, setRules] = useState<any[]>([]);

  // Inline Rule editing state
  const [isEditingRule, setIsEditingRule] = useState<boolean>(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [ruleForm, setRuleForm] = useState<Record<string, any>>({});

  const [jsonError, setJsonError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

  const hasTable = useMemo(() => {
    return (
      schema.layout_type === 'table' ||
      Boolean(schema.table_columns && schema.table_columns.length > 0) ||
      rules.length > 0
    );
  }, [schema.layout_type, schema.table_columns, rules.length]);

  const hasFields = useMemo(() => {
    return Boolean(schema.fields && schema.fields.length > 0);
  }, [schema.fields]);

  const [visualTab, setVisualTab] = useState<'rules' | 'parameters'>('rules');

  // Initialize data on modal open
  useEffect(() => {
    try {
      const parsed = JSON.parse(extension.config_json || '{}');
      setParsedConfig(parsed);
      setConfigText(JSON.stringify(parsed, null, 2));

      if (Array.isArray(parsed.rules)) {
        setRules(parsed.rules);
      } else {
        setRules([]);
      }
    } catch {
      setConfigText(extension.config_json || '{}');
      setParsedConfig({});
      setRules([]);
    }

    setJsonError(null);
    setSaveSuccess(false);
    setIsEditingRule(false);
    setEditingIndex(null);
    setWorkspaceMode('visual');

    // Default to 'rules' if table is supported, else 'parameters'
    const isTableType =
      schema.layout_type === 'table' ||
      Boolean(schema.table_columns && schema.table_columns.length > 0);
    setVisualTab(isTableType ? 'rules' : 'parameters');
  }, [extension, schema.layout_type, schema.table_columns]);

  // Sync state between Visual and JSON
  const syncToJSON = (updatedConfig: Record<string, any>, updatedRules: any[]) => {
    const nextConfig = { ...updatedConfig };
    if (updatedRules.length > 0) {
      nextConfig.rules = updatedRules;
    } else {
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

  const handleModeChange = (mode: 'visual' | 'json') => {
    if (mode === 'visual') {
      const ok = syncFromJSON(configText);
      if (!ok) return;
    } else {
      syncToJSON(parsedConfig, rules);
    }
    setWorkspaceMode(mode);
  };

  // Field change in Visual Config
  const handleFieldChange = (key: string, value: any) => {
    const next = { ...parsedConfig, [key]: value };
    setParsedConfig(next);
    syncToJSON(next, rules);
  };

  // Effective fields for Rule Row editing (derived from schema.row_fields or schema.table_columns)
  const effectiveRowFields: SchemaField[] = useMemo(() => {
    if (schema.row_fields && schema.row_fields.length > 0) {
      return schema.row_fields;
    }
    if (schema.table_columns && schema.table_columns.length > 0) {
      return schema.table_columns.map((col) => {
        let type: SchemaField['type'] = 'text';
        let options: { label: string; value: any }[] | undefined = undefined;
        if (col.key === 'action') {
          type = 'select';
          options = [
            { label: 'Block (403 Forbidden)', value: 'block' },
            { label: 'Throttle (429 Too Many Requests)', value: 'throttle' },
            { label: 'Allow (Bypass / Pass)', value: 'allow' },
            { label: 'Challenge (CAPTCHA)', value: 'challenge' },
          ];
        } else if (col.key === 'enabled') {
          type = 'boolean';
        } else if (
          ['rate', 'burst', 'period_secs', 'status_code', 'timeout_ms', 'max_body_bytes'].includes(
            col.key
          )
        ) {
          type = 'number';
        }
        return {
          key: col.key,
          label: col.label,
          type,
          options,
          description: `Configure ${col.label}`,
        };
      });
    }
    return [
      { key: 'name', label: 'Rule Name', type: 'text' },
      {
        key: 'match_value',
        label: 'Route Path / Match Value',
        type: 'text',
        description: 'Target path prefix or pattern (e.g. /api/*)',
      },
      {
        key: 'action',
        label: 'Policy Action',
        type: 'select',
        options: [
          { label: 'Block (403 Forbidden)', value: 'block' },
          { label: 'Throttle (429 Too Many Requests)', value: 'throttle' },
          { label: 'Allow (Bypass / Pass)', value: 'allow' },
        ],
      },
    ];
  }, [schema.row_fields, schema.table_columns]);

  // Rule operations
  const handleOpenAddRule = () => {
    const initialRule: Record<string, any> = {
      id: `${extension.id}-rule-${Date.now()}`,
      name: '',
      enabled: true,
    };
    for (const f of effectiveRowFields) {
      if (initialRule[f.key] === undefined) {
        if (f.type === 'boolean') {
          initialRule[f.key] = true;
        } else if (f.type === 'number') {
          initialRule[f.key] = f.key === 'period_secs' ? 1 : f.key === 'rate' ? 100 : 0;
        } else if (f.type === 'select' && f.options && f.options.length > 0) {
          initialRule[f.key] = f.options[0].value;
        } else if (f.type === 'list_string') {
          initialRule[f.key] = [];
        } else {
          initialRule[f.key] = '';
        }
      }
    }
    setRuleForm(initialRule);
    setEditingIndex(null);
    setIsEditingRule(true);
  };

  const handleOpenEditRule = (rule: any, index: number) => {
    setRuleForm({ ...rule });
    setEditingIndex(index);
    setIsEditingRule(true);
  };

  const handleSaveRuleEntry = () => {
    if (!ruleForm.name?.trim() && !ruleForm.pattern?.trim() && !ruleForm.id?.trim()) return;

    let updatedRules: any[];
    if (editingIndex !== null) {
      updatedRules = [...rules];
      updatedRules[editingIndex] = { ...ruleForm };
    } else {
      updatedRules = [...rules, { ...ruleForm }];
    }

    setRules(updatedRules);
    syncToJSON(parsedConfig, updatedRules);
    setIsEditingRule(false);
    setEditingIndex(null);
  };

  const handleDeleteRule = (index: number) => {
    const updated = rules.filter((_, i) => i !== index);
    setRules(updated);
    syncToJSON(parsedConfig, updated);
  };

  const handleToggleRule = (index: number) => {
    const updated = [...rules];
    updated[index] = { ...updated[index], enabled: !updated[index].enabled };
    setRules(updated);
    syncToJSON(parsedConfig, updated);
  };

  // Save to backend
  const handleApplyConfig = async () => {
    try {
      let finalJson = configText;
      if (workspaceMode === 'visual') {
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
        }, 600);
      }
    } catch (e) {
      setJsonError('Invalid JSON syntax: ' + (e as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        style={{ height: '82vh' }}
        className="bg-card border-t border-x border-border rounded-t-2xl shadow-2xl w-full flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300 ease-out"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <ExtensionConfigHeader
          extension={extension}
          workspaceMode={workspaceMode}
          onModeChange={handleModeChange}
          isSaving={isSaving}
          saveSuccess={saveSuccess}
          onApplyConfig={handleApplyConfig}
          onClose={onClose}
          onToggleStatus={onToggleStatus}
        />

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {workspaceMode === 'visual' ? (
            isEditingRule ? (
              <ExtensionRuleEditForm
                editingIndex={editingIndex}
                ruleForm={ruleForm}
                setRuleForm={setRuleForm}
                rowFields={effectiveRowFields}
                onCancel={() => {
                  setIsEditingRule(false);
                  setEditingIndex(null);
                }}
                onSaveRule={handleSaveRuleEntry}
              />
            ) : (
              <div className="space-y-5 animate-in fade-in duration-200">
                {/* Sub-tab navigation if both Parameters and Policy Rules exist */}
                {hasTable && hasFields && (
                  <div className="flex items-center justify-between border-b border-border/80 pb-2.5">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setVisualTab('rules')}
                        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${visualTab === 'rules'
                            ? 'bg-primary/15 text-primary border border-primary/30 font-semibold shadow-2xs'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent'
                          }`}
                      >
                        <TableIcon className="w-3.5 h-3.5" />
                        <span>Policy Rules & Exceptions</span>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-primary/20 text-primary font-mono font-bold">
                          {rules.length}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setVisualTab('parameters')}
                        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${visualTab === 'parameters'
                            ? 'bg-primary/15 text-primary border border-primary/30 font-semibold shadow-2xs'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent'
                          }`}
                      >
                        <SlidersHorizontal className="w-3.5 h-3.5" />
                        <span>Global Parameters</span>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-muted text-muted-foreground font-mono">
                          {schema.fields?.length || 0}
                        </span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Rules Table Tab */}
                {(visualTab === 'rules' || (!hasFields && hasTable)) && hasTable && (
                  <ExtensionRulesTable
                    rules={rules}
                    tableColumns={schema.table_columns}
                    onOpenAddRule={handleOpenAddRule}
                    onOpenEditRule={handleOpenEditRule}
                    onDeleteRule={handleDeleteRule}
                    onToggleRule={handleToggleRule}
                  />
                )}

                {/* Parameters Form Tab */}
                {(visualTab === 'parameters' || (!hasTable && hasFields)) && hasFields && (
                  <ExtensionVisualForm
                    fields={schema.fields || []}
                    parsedConfig={parsedConfig}
                    onFieldChange={handleFieldChange}
                    showPasswords={showPasswords}
                    onToggleShowPassword={(key) =>
                      setShowPasswords((prev) => ({ ...prev, [key]: !prev[key] }))
                    }
                  />
                )}
              </div>
            )
          ) : (
            <ExtensionRawJson
              configText={configText}
              setConfigText={setConfigText}
              jsonError={jsonError}
              setJsonError={setJsonError}
            />
          )}
        </div>

        {/* Footer info strip */}
        <ExtensionConfigFooter onClose={onClose} />
      </div>
    </div>
  );
}
