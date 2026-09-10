import React from 'react';
import { SchemaField } from './types';
import { TagListInput } from './TagListInput';
import { KeyValueMapInput } from './KeyValueMapInput';
import { ArrowLeft } from 'lucide-react';

interface ExtensionRuleEditFormProps {
  editingIndex: number | null;
  ruleForm: Record<string, any>;
  setRuleForm: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  rowFields: SchemaField[];
  onCancel: () => void;
  onSaveRule: () => void;
}

export function ExtensionRuleEditForm({
  editingIndex,
  ruleForm,
  setRuleForm,
  rowFields,
  onCancel,
  onSaveRule,
}: ExtensionRuleEditFormProps) {
  const fields = rowFields.filter((f) => f.key !== 'name' && f.key !== 'id');

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="flex items-center justify-between bg-muted/20 border border-border p-3.5 rounded-xl">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted border border-border/80 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Policy Table</span>
          </button>
          <div className="h-4 w-px bg-border" />
          <div>
            <h4 className="font-semibold text-sm text-foreground">
              {editingIndex !== null ? 'Edit Policy Entry' : 'Add New Policy Entry'}
            </h4>
            <p className="text-[11px] text-muted-foreground">
              Configure match criteria and actions for this specific rule entry.
            </p>
          </div>
        </div>
      </div>

      {/* Rule Form Fields */}
      <div className="bg-card border border-border rounded-xl p-6 shadow-xs space-y-4 text-xs">
        <div>
          <label className="block text-xs font-semibold text-foreground mb-1.5">
            Rule Name <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            required
            value={ruleForm.name || ''}
            onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
            className="w-full px-3.5 py-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-2xs"
          />
        </div>

        {fields.map((f) => (
          <div key={f.key}>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-foreground">
                {f.label}
              </label>
              {f.type === 'boolean' && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={ruleForm[f.key] !== false}
                  onClick={() =>
                    setRuleForm({ ...ruleForm, [f.key]: !ruleForm[f.key] })
                  }
                  className={`w-9 h-5 flex items-center rounded-full p-1 transition-colors cursor-pointer ${ruleForm[f.key] !== false
                      ? 'bg-primary'
                      : 'bg-muted border border-border'
                    }`}
                >
                  <div
                    className={`bg-white w-3.5 h-3.5 rounded-full shadow-md transform transition-transform ${ruleForm[f.key] !== false ? 'translate-x-4' : 'translate-x-0'
                      }`}
                  />
                </button>
              )}
            </div>

            {f.description && (
              <p className="text-[11px] text-muted-foreground mb-1.5 leading-normal">
                {f.description}
              </p>
            )}

            {f.type === 'select' ? (
              <select
                value={ruleForm[f.key] ?? ''}
                onChange={(e) =>
                  setRuleForm({ ...ruleForm, [f.key]: e.target.value })
                }
                className="w-full px-3.5 py-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-2xs"
              >
                {(f.options || []).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : f.type === 'number' ? (
              <input
                type="number"
                value={ruleForm[f.key] ?? ''}
                onChange={(e) =>
                  setRuleForm({
                    ...ruleForm,
                    [f.key]: e.target.value ? Number(e.target.value) : '',
                  })
                }
                className="w-full px-3.5 py-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono shadow-2xs"
              />
            ) : f.type === 'list_string' ? (
              <TagListInput
                values={Array.isArray(ruleForm[f.key]) ? ruleForm[f.key] : []}
                onChange={(items: string[]) =>
                  setRuleForm({ ...ruleForm, [f.key]: items })
                }
              />
            ) : f.type === 'textarea_code' ? (
              <textarea
                rows={4}
                value={ruleForm[f.key] ?? ''}
                onChange={(e) =>
                  setRuleForm({ ...ruleForm, [f.key]: e.target.value })
                }
                className="w-full px-3.5 py-2 text-xs font-mono bg-muted/20 border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-2xs leading-relaxed resize-y"
                spellCheck={false}
              />
            ) : f.type === 'key_value_map' ? (
              <KeyValueMapInput
                value={
                  typeof ruleForm[f.key] === 'object' && ruleForm[f.key] !== null
                    ? ruleForm[f.key]
                    : {}
                }
                onChange={(newMap) =>
                  setRuleForm({ ...ruleForm, [f.key]: newMap })
                }
              />
            ) : f.type !== 'boolean' ? (
              <input
                type="text"
                value={ruleForm[f.key] ?? ''}
                onChange={(e) =>
                  setRuleForm({ ...ruleForm, [f.key]: e.target.value })
                }
                className="w-full px-3.5 py-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono shadow-2xs"
              />
            ) : null}
          </div>
        ))}

        <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-border">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted border border-border/80 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSaveRule}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs transition-colors cursor-pointer"
          >
            Save Rule Entry
          </button>
        </div>
      </div>
    </div>
  );
}
