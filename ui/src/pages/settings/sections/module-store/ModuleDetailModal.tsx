import React, { useState } from 'react';
import {
  X,
  Copy,
  Check,
  Zap,
  Minimize2,
  Radio,
  Globe,
  ShieldCheck,
  BarChart3,
  Cpu,
  FolderTree,
  Code2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import type { CatalogModule } from './moduleCatalog';

interface ModuleDetailModalProps {
  module: CatalogModule;
  isLoaded: boolean;
  evidenceSource?: string;
  onClose: () => void;
  onInstall?: () => void;
  isBusy?: boolean;
  canInstall?: boolean;
}

const ICONS: Record<string, React.ReactNode> = {
  Zap: <Zap className="w-6 h-6 text-amber-500" />,
  Minimize2: <Minimize2 className="w-6 h-6 text-blue-500" />,
  Radio: <Radio className="w-6 h-6 text-emerald-500" />,
  Globe: <Globe className="w-6 h-6 text-cyan-500" />,
  ShieldCheck: <ShieldCheck className="w-6 h-6 text-emerald-400" />,
  BarChart3: <BarChart3 className="w-6 h-6 text-purple-500" />,
  Cpu: <Cpu className="w-6 h-6 text-rose-500" />,
  FolderTree: <FolderTree className="w-6 h-6 text-indigo-400" />,
  Code2: <Code2 className="w-6 h-6 text-teal-400" />,
};

export function ModuleDetailModal({
  module,
  isLoaded,
  evidenceSource,
  onClose,
  onInstall,
  isBusy,
  canInstall,
}: ModuleDetailModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(module.directivesExample);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-xs">
      <div className="bg-card border border-border w-full max-w-xl shadow-2xl rounded-sm overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-border flex items-start justify-between gap-4 bg-muted/20">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xs border border-border bg-background flex items-center justify-center shrink-0">
              {ICONS[module.iconName] || <Zap className="w-6 h-6 text-primary" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-base text-foreground">{module.name}</h3>
                <span className="px-2 py-0.5 text-[10px] font-mono border border-border rounded-xs bg-muted text-muted-foreground uppercase font-semibold">
                  {module.category}
                </span>
              </div>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                {module.packageName} · v{module.version} · {module.author}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer rounded-xs"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto font-sans text-xs">
          {/* Status Banner */}
          <div
            className={`p-3 border rounded-xs flex items-center justify-between gap-3 ${
              isLoaded
                ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-400'
                : 'bg-muted/40 border-border text-muted-foreground'
            }`}
          >
            <div className="flex items-center gap-2">
              {isLoaded ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
              <span className="font-medium">
                {isLoaded ? 'Module đang hoạt động trên NGINX runtime' : 'Module chưa được kích hoạt hoặc chưa nạp'}
              </span>
            </div>
            {evidenceSource && (
              <span className="font-mono text-[11px] opacity-80">
                Nguồn: {evidenceSource}
              </span>
            )}
          </div>

          {/* Description */}
          <div>
            <h4 className="font-semibold text-foreground text-xs uppercase tracking-wider mb-1 text-slate-400">
              Mô tả &amp; Lợi ích
            </h4>
            <p className="text-muted-foreground leading-relaxed">
              {module.description}
            </p>
          </div>

          {/* Example Directives */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <h4 className="font-semibold text-foreground text-xs uppercase tracking-wider text-slate-400">
                Cấu hình NGINX mẫu
              </h4>
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="text-emerald-500 font-medium">Đã sao chép</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Sao chép</span>
                  </>
                )}
              </button>
            </div>
            <pre className="p-3 bg-muted/40 border border-border rounded-xs font-mono text-[11px] text-foreground overflow-x-auto leading-relaxed">
              {module.directivesExample}
            </pre>
          </div>

          {/* Compatibility & Architecture info */}
          <div className="p-3 border border-border bg-background/50 rounded-xs space-y-1.5 font-mono text-[11px]">
            <div className="flex justify-between text-muted-foreground">
              <span>Loại module:</span>
              <span className="text-foreground font-medium">{module.isDynamic ? 'Dynamic Shared Object (.so)' : 'Static Core Module'}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Phương thức nạp:</span>
              <span className="text-foreground font-medium">{module.isDynamic ? 'Atomic symlink & SIGHUP Reload' : 'Compiled into binary'}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Kiểm tra tính toàn vẹn:</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">SHA256 Checksum Verified</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex items-center justify-between bg-muted/20">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 border border-border text-xs text-foreground hover:bg-muted transition-colors cursor-pointer rounded-xs"
          >
            Đóng
          </button>

          {canInstall && !isLoaded && onInstall && (
            <button
              type="button"
              disabled={isBusy}
              onClick={onInstall}
              className="px-4 py-1.5 bg-primary text-primary-foreground font-medium text-xs rounded-xs hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50"
            >
              {isBusy ? 'Đang gửi lệnh...' : 'Cài đặt vào Node'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
