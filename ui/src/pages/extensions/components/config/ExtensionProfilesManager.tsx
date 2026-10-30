import { useState } from 'react';
import { Layers, Plus, Trash2, Edit2, Check, X, Sparkles } from 'lucide-react';
import {
  findDataplaneExtensionMeta,
  resolveExtensionProfiles,
  ExtensionProfileOption,
} from '../../data/extensionProfiles';

interface ExtensionProfilesManagerProps {
  extensionKey: string;
  parsedConfig: Record<string, any>;
  onUpdateProfiles: (nextProfiles: Record<string, any>) => void;
}

export function ExtensionProfilesManager({
  extensionKey,
  parsedConfig,
  onUpdateProfiles,
}: ExtensionProfilesManagerProps) {
  const meta = findDataplaneExtensionMeta(extensionKey);
  const profiles = resolveExtensionProfiles(extensionKey, parsedConfig);
  const customProfilesMap: Record<string, any> =
    parsedConfig.profiles && typeof parsedConfig.profiles === 'object'
      ? { ...parsedConfig.profiles }
      : {};

  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [profId, setProfId] = useState('');
  const [profLabel, setProfLabel] = useState('');
  const [profSummary, setProfSummary] = useState('');
  const [profParams, setProfParams] = useState<Record<string, any>>({});

  const openCreate = () => {
    const defaults: Record<string, any> = {};
    for (const f of meta?.profileFields ?? []) {
      defaults[f.key] = f.defaultValue;
    }
    setEditingId(null);
    setProfId('');
    setProfLabel('');
    setProfSummary('');
    setProfParams(defaults);
    setIsAdding(true);
  };

  const openEdit = (p: ExtensionProfileOption) => {
    setEditingId(p.id);
    setProfId(p.id);
    setProfLabel(p.label);
    setProfSummary(p.summary);
    setProfParams({ ...p.params });
    setIsAdding(true);
  };

  const handleSaveProfile = () => {
    const cleanId = profId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_');
    if (!cleanId) return;

    const entry: Record<string, any> = {
      ...profParams,
      label: profLabel.trim() || cleanId,
    };
    if (profSummary.trim()) {
      entry.summary = profSummary.trim();
    }

    const next = { ...customProfilesMap, [cleanId]: entry };
    onUpdateProfiles(next);
    setIsAdding(false);
    setEditingId(null);
  };

  const handleDeleteProfile = (id: string) => {
    const next = { ...customProfilesMap };
    delete next[id];
    onUpdateProfiles(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between bg-muted/20 border border-border rounded-xl p-4">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-primary" />
            <h4 className="text-sm font-semibold text-foreground">
              Danh sách Profile của Extension ({profiles.length})
            </h4>
          </div>
          <p className="text-xs text-muted-foreground">
            Mỗi Route sẽ chọn <strong>1 Profile</strong> dưới đây (hoặc Tắt). Control Worker sẽ tự
            động biên dịch path của Route cùng thông số của Profile đó vào bộ nhớ SHM.
          </p>
        </div>
        {!isAdding && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Tạo Profile mới</span>
          </button>
        )}
      </div>

      {isAdding && (
        <div className="border border-primary/40 bg-primary/5 rounded-xl p-4 space-y-4 animate-in fade-in duration-150">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
              {editingId ? `Chỉnh sửa Profile: ${editingId}` : 'Tạo Profile mới cho Extension'}
            </span>
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                Mã Profile (ID) *
              </label>
              <input
                type="text"
                disabled={Boolean(editingId)}
                value={profId}
                onChange={(e) => setProfId(e.target.value)}
                placeholder="vd: vip_cache, partner_tier"
                className="w-full px-3 py-1.5 bg-background border border-border rounded-lg text-xs font-mono text-foreground disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                Tên hiển thị (Label) *
              </label>
              <input
                type="text"
                value={profLabel}
                onChange={(e) => setProfLabel(e.target.value)}
                placeholder="vd: VIP Cache (600s)"
                className="w-full px-3 py-1.5 bg-background border border-border rounded-lg text-xs text-foreground"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                Mô tả ngắn (Summary)
              </label>
              <input
                type="text"
                value={profSummary}
                onChange={(e) => setProfSummary(e.target.value)}
                placeholder="vd: Dành cho API đối tác B2B"
                className="w-full px-3 py-1.5 bg-background border border-border rounded-lg text-xs text-foreground"
              />
            </div>
          </div>

          {meta && meta.profileFields.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-border/60">
              {meta.profileFields.map((field) => (
                <div key={field.key}>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                    {field.label}
                  </label>
                  {field.type === 'select' ? (
                    <select
                      value={profParams[field.key] ?? field.defaultValue}
                      onChange={(e) =>
                        setProfParams((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      className="w-full px-3 py-1.5 bg-background border border-border rounded-lg text-xs text-foreground"
                    >
                      {field.options?.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type === 'number' ? 'number' : 'text'}
                      value={profParams[field.key] ?? field.defaultValue}
                      onChange={(e) =>
                        setProfParams((prev) => ({
                          ...prev,
                          [field.key]:
                            field.type === 'number'
                              ? Math.max(1, parseInt(e.target.value, 10) || 1)
                              : e.target.value,
                        }))
                      }
                      className="w-full px-3 py-1.5 bg-background border border-border rounded-lg text-xs font-mono text-foreground"
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground cursor-pointer"
            >
              Huỷ
            </button>
            <button
              type="button"
              onClick={handleSaveProfile}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Lưu Profile</span>
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {profiles.map((prof) => {
          const isCustomOverride = Boolean(customProfilesMap[prof.id]);
          return (
            <div
              key={prof.id}
              className="flex items-start justify-between gap-3 p-3.5 rounded-xl border border-border bg-card hover:border-primary/30 transition-all"
            >
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary font-mono text-xs font-semibold">
                    {prof.id}
                  </span>
                  <span className="text-xs font-semibold text-foreground">{prof.label}</span>
                  {prof.builtin && !isCustomOverride ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground">
                      <Sparkles className="w-2.5 h-2.5" />
                      Built-in
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/15 text-emerald-500 font-medium">
                      Custom
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{prof.summary}</p>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => openEdit(prof)}
                  title="Tuỳ chỉnh thông số Profile này"
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                {isCustomOverride && (
                  <button
                    type="button"
                    onClick={() => handleDeleteProfile(prof.id)}
                    title="Xoá Profile tuỳ chỉnh"
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
