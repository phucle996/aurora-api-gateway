import React, { useState } from 'react';
import {
  X,
  Plus,
  Search,
  Trash2,
  Edit3,
  Shield,
  Gauge,
  CheckCircle2,
  XCircle,
  SlidersHorizontal,
} from 'lucide-react';

export interface ExtensionRuleItem {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  match_type?: string; // 'path' | 'ip' | 'header' | 'query' | 'all'
  match_value?: string;
  method?: string; // 'ALL' | 'GET' | 'POST' | 'PUT' | 'DELETE'
  rate?: number;
  burst?: number;
  period_secs?: number;
  action?: string; // 'block' | 'throttle' | 'challenge' | 'allow'
  custom_code?: number;
  custom_message?: string;
}

interface ExtensionRulesDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  rules: ExtensionRuleItem[];
  onAddRule: () => void;
  onEditRule: (rule: ExtensionRuleItem, index: number) => void;
  onDeleteRule: (index: number) => void;
  onToggleRule: (index: number) => void;
}

export function ExtensionRulesDrawer({
  isOpen,
  onClose,
  rules,
  onAddRule,
  onEditRule,
  onDeleteRule,
  onToggleRule,
}: ExtensionRulesDrawerProps) {
  const [searchQuery, setSearchQuery] = useState('');

  if (!isOpen) return null;

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
    <div className="fixed inset-0 z-60 overflow-hidden bg-black/60 backdrop-blur-xs flex justify-end animate-in fade-in duration-200">
      <div
        className="w-full max-w-md bg-card border-l border-border h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-250 ease-out"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-muted/20">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-md bg-primary/10 text-primary">
              <SlidersHorizontal className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm text-foreground">Danh sách quy tắc</h3>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-primary/10 text-primary border border-primary/20">
                  {rules.length}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Các quy tắc kiểm soát và giới hạn áp dụng
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-all duration-150 hover:rotate-90 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Drawer Toolbar & Search */}
        <div className="p-4 border-b border-border/80 bg-muted/10 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm quy tắc theo tên, path, action..."
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-background border border-border/80 rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
              />
            </div>
            <button
              type="button"
              onClick={onAddRule}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-all hover:scale-102 active:scale-95 shadow-xs cursor-pointer shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Thêm mới</span>
            </button>
          </div>
        </div>

        {/* Drawer Rule List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filteredRules.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-center p-6 border border-dashed border-border rounded-lg bg-muted/5">
              <div className="p-3 rounded-full bg-muted/40 text-muted-foreground mb-3">
                <Shield className="w-6 h-6 opacity-60" />
              </div>
              <h4 className="text-sm font-semibold text-foreground">Không tìm thấy quy tắc</h4>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                {searchQuery
                  ? 'Không có quy tắc nào khớp với bộ lọc tìm kiếm.'
                  : 'Chưa có quy tắc nào được thiết lập. Nhấn "Thêm mới" để tạo quy tắc đầu tiên.'}
              </p>
              {!searchQuery && (
                <button
                  type="button"
                  onClick={onAddRule}
                  className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 text-xs font-medium border border-primary/20 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Tạo quy tắc ngay</span>
                </button>
              )}
            </div>
          ) : (
            filteredRules.map((rule) => {
              const originalIndex = rules.findIndex((r) => r.id === rule.id);
              return (
                <div
                  key={rule.id}
                  className={`p-3.5 rounded-lg border transition-all duration-200 group relative ${
                    rule.enabled
                      ? 'bg-card hover:bg-muted/30 border-border/80 hover:border-primary/40 shadow-xs'
                      : 'bg-muted/10 border-border/50 opacity-60'
                  }`}
                >
                  {/* Top row: Name & Toggle */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-xs text-foreground truncate">
                          {rule.name}
                        </span>
                        <span
                          className={`px-1.5 py-0.2 rounded-none text-[10px] font-mono uppercase tracking-wider ${
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
                      </div>
                      {rule.description && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                          {rule.description}
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => onToggleRule(originalIndex)}
                      title={rule.enabled ? 'Đang bật - Nhấp để tắt' : 'Đang tắt - Nhấp để bật'}
                      className="cursor-pointer transition-transform hover:scale-110 active:scale-95 text-muted-foreground hover:text-foreground shrink-0"
                    >
                      {rule.enabled ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <XCircle className="w-4 h-4 text-muted-foreground" />
                      )}
                    </button>
                  </div>

                  {/* Matching specs tags */}
                  <div className="mt-2.5 flex items-center gap-2 flex-wrap text-[11px]">
                    {rule.method && (
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground border border-border/60">
                        {rule.method}
                      </span>
                    )}
                    {rule.match_value && (
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-sm bg-muted text-foreground border border-border/60 truncate max-w-[200px]">
                        {rule.match_type ? `${rule.match_type}: ` : ''}
                        {rule.match_value}
                      </span>
                    )}
                    {rule.rate && (
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded-sm bg-primary/10 text-primary border border-primary/20">
                        <Gauge className="w-3 h-3" />
                        <span>
                          {rule.rate} r/s (burst {rule.burst ?? rule.rate})
                        </span>
                      </span>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="mt-3 pt-2.5 border-t border-border/50 flex items-center justify-between">
                    <span className="font-mono text-[10px] text-muted-foreground truncate">
                      ID: {rule.id}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onEditRule(rule, originalIndex)}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                      >
                        <Edit3 className="w-3 h-3 text-primary" />
                        <span>Sửa</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteRule(originalIndex)}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-sm text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Xóa</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Drawer Footer */}
        <div className="px-5 py-3 border-t border-border bg-muted/20 flex items-center justify-between text-xs text-muted-foreground">
          <span>Tổng số {filteredRules.length} quy tắc</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-sm border border-border hover:bg-muted text-foreground transition-colors cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
