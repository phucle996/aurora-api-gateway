import React from 'react';
import { SchemaField } from './types';
import { TagListInput } from './TagListInput';
import { KeyValueMapInput } from './KeyValueMapInput';
import { SlidersHorizontal, Eye, EyeOff } from 'lucide-react';

interface ExtensionVisualFormProps {
  fields: SchemaField[];
  parsedConfig: Record<string, any>;
  onFieldChange: (key: string, value: any) => void;
  showPasswords: Record<string, boolean>;
  onToggleShowPassword: (key: string) => void;
}

export function ExtensionVisualForm({
  fields,
  parsedConfig,
  onFieldChange,
  showPasswords,
  onToggleShowPassword,
}: ExtensionVisualFormProps) {
  if (!fields || fields.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-xs space-y-4">
      <div className="border-b border-border pb-3">
        <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-primary" />
          <span>Extension Parameters & Authentication</span>
        </h4>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Native parameters enforced directly by the Gateway dataplane for this extension.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {fields.map((f) => {
          const val = parsedConfig[f.key];
          const isFullWidth =
            f.type === 'textarea_code' ||
            f.type === 'list_string' ||
            f.type === 'key_value_map';

          return (
            <div
              key={f.key}
              className={isFullWidth ? 'col-span-1 md:col-span-2' : 'col-span-1'}
            >
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <span>{f.label}</span>
                  {f.required && <span className="text-rose-500 font-bold">*</span>}
                </label>
                {f.type === 'password' && (
                  <button
                    type="button"
                    onClick={() => onToggleShowPassword(f.key)}
                    className="text-muted-foreground hover:text-foreground cursor-pointer text-[10px] inline-flex items-center gap-1"
                  >
                    {showPasswords[f.key] ? (
                      <>
                        <EyeOff className="w-3 h-3" />
                        <span>Hide</span>
                      </>
                    ) : (
                      <>
                        <Eye className="w-3 h-3" />
                        <span>Reveal</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Render based on field type */}
              {f.type === 'boolean' ? (
                <label className="flex items-center gap-3 p-2.5 bg-muted/20 border border-border rounded-lg cursor-pointer hover:bg-muted/40 transition-colors">
                  <input
                    type="checkbox"
                    checked={Boolean(val)}
                    onChange={(e) => onFieldChange(f.key, e.target.checked)}
                    className="w-4 h-4 rounded text-primary focus:ring-primary"
                  />
                  <span className="text-xs text-foreground font-medium">
                    {val ? 'Enabled' : 'Disabled'}
                  </span>
                </label>
              ) : f.type === 'number' ? (
                <input
                  type="number"
                  value={val ?? ''}
                  onChange={(e) =>
                    onFieldChange(
                      f.key,
                      e.target.value ? Number(e.target.value) : undefined
                    )
                  }
                  className="w-full px-3.5 py-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono shadow-2xs"
                />
              ) : f.type === 'password' ? (
                <input
                  type={showPasswords[f.key] ? 'text' : 'password'}
                  value={val ?? ''}
                  onChange={(e) => onFieldChange(f.key, e.target.value)}
                  className="w-full px-3.5 py-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono shadow-2xs"
                />
              ) : f.type === 'textarea_code' ? (
                <textarea
                  rows={4}
                  value={val ?? ''}
                  onChange={(e) => onFieldChange(f.key, e.target.value)}
                  className="w-full px-3.5 py-2 text-xs bg-background border border-border rounded-lg text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary shadow-2xs resize-y"
                  spellCheck={false}
                />
              ) : f.type === 'list_string' ? (
                <TagListInput
                  values={Array.isArray(val) ? val : []}
                  onChange={(newVals) => onFieldChange(f.key, newVals)}
                />
              ) : f.type === 'key_value_map' ? (
                <KeyValueMapInput
                  value={typeof val === 'object' && val !== null ? val : {}}
                  onChange={(newMap) => onFieldChange(f.key, newMap)}
                />
              ) : f.type === 'select' ? (
                <select
                  value={val ?? ''}
                  onChange={(e) => onFieldChange(f.key, e.target.value)}
                  className="w-full px-3.5 py-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-2xs"
                >
                  {(f.options || []).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={val ?? ''}
                  onChange={(e) => onFieldChange(f.key, e.target.value)}
                  className="w-full px-3.5 py-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-2xs"
                />
              )}

              {f.description && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  {f.description}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
