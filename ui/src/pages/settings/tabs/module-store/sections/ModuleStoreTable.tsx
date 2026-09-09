import React from 'react';
import {
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
  Download,
  RotateCw,
  Info,
  Network,
  Lock,
  Layers,
  Sparkles,
  Share2,
  KeyRound,
  Activity,
  FileText,
  FileVideo,
  RefreshCw,
  Film,
  ExternalLink,
} from 'lucide-react';
import type { CatalogModule } from './moduleCatalog';
import type { DependencyNode } from './types';

interface ModuleStoreTableProps {
  modules: CatalogModule[];
  currentNode: DependencyNode | null;
  isNodeBusy: boolean;
  pendingAction: string | null;
  checkIsModuleLoaded: (mod: CatalogModule, nodeModules?: Array<{ name: string; loaded: boolean }>) => boolean;
  getModuleEvidence: (mod: CatalogModule, nodeModules?: Array<{ name: string; loaded: boolean; source: string }>) => string | undefined;
  onInstall: (module: CatalogModule) => void;
  onViewDetails: (module: CatalogModule) => void;
}

const ICONS: Record<string, React.ReactNode> = {
  Zap: <Zap className="w-4 h-4 text-amber-500" />,
  Minimize2: <Minimize2 className="w-4 h-4 text-blue-500" />,
  Radio: <Radio className="w-4 h-4 text-emerald-500" />,
  Globe: <Globe className="w-4 h-4 text-cyan-500" />,
  ShieldCheck: <ShieldCheck className="w-4 h-4 text-emerald-400" />,
  BarChart3: <BarChart3 className="w-4 h-4 text-purple-500" />,
  Cpu: <Cpu className="w-4 h-4 text-rose-500" />,
  FolderTree: <FolderTree className="w-4 h-4 text-indigo-400" />,
  Code2: <Code2 className="w-4 h-4 text-teal-400" />,
  Network: <Network className="w-4 h-4 text-sky-500" />,
  Lock: <Lock className="w-4 h-4 text-emerald-500" />,
  Layers: <Layers className="w-4 h-4 text-amber-500" />,
  Sparkles: <Sparkles className="w-4 h-4 text-purple-400" />,
  Share2: <Share2 className="w-4 h-4 text-cyan-400" />,
  KeyRound: <KeyRound className="w-4 h-4 text-amber-400" />,
  Activity: <Activity className="w-4 h-4 text-rose-400" />,
  FileText: <FileText className="w-4 h-4 text-blue-400" />,
  FileVideo: <FileVideo className="w-4 h-4 text-indigo-400" />,
  RefreshCw: <RefreshCw className="w-4 h-4 text-teal-400" />,
  Film: <Film className="w-4 h-4 text-amber-500" />,
};

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  performance: {
    label: 'HTTP/3 & Tối ưu',
    color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  },
  security: {
    label: 'Bảo mật & WAF',
    color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  },
  observability: {
    label: 'Giám sát & Traffic',
    color: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
  },
  routing: {
    label: 'Định tuyến L4 Proxy',
    color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  },
  utilities: {
    label: 'Tiện ích & Media',
    color: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20',
  },
};

export function ModuleStoreTable({
  modules,
  currentNode,
  isNodeBusy,
  pendingAction,
  checkIsModuleLoaded,
  getModuleEvidence,
  onInstall,
  onViewDetails,
}: ModuleStoreTableProps) {
  return (
    <div className="bg-card border border-border rounded-sm shadow-xs overflow-hidden font-sans">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-muted/40 border-b border-border text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              <th className="py-3 px-4 w-[38%] min-w-[280px]">Module & Gói NGINX</th>
              <th className="py-3 px-4 w-[16%] min-w-[140px]">Danh mục</th>
              <th className="py-3 px-4 w-[13%] min-w-[110px]">Kiểu Module</th>
              <th className="py-3 px-4 w-[14%] min-w-[120px]">Phiên bản</th>
              <th className="py-3 px-4 w-[11%] min-w-[100px]">Trạng thái</th>
              <th className="py-3 px-4 w-[8%] min-w-[110px] text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {modules.map((module) => {
              const isLoaded = checkIsModuleLoaded(module, currentNode?.modules);
              const evidence = getModuleEvidence(module, currentNode?.modules);

              const isAvailable = Boolean(
                module.action === 'install_brotli'
                  ? currentNode?.installable && currentNode?.fresh
                  : true
              );

              const isBusy =
                isNodeBusy &&
                (pendingAction === module.action ||
                  (currentNode?.job_action === module.action &&
                    (currentNode?.job_state === 'pending' || currentNode?.job_state === 'running')));

              const catInfo = CATEGORY_LABELS[module.category] || {
                label: module.category,
                color: 'bg-muted text-muted-foreground border-border',
              };

              return (
                <tr
                  key={module.id}
                  className="hover:bg-muted/30 transition-colors group"
                >
                  {/* Module Name & Package Info */}
                  <td className="py-3 px-4">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-xs border border-border bg-muted/40 flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
                        {ICONS[module.iconName] || <Zap className="w-4 h-4 text-primary" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => onViewDetails(module)}
                            className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors text-left cursor-pointer"
                          >
                            {module.name}
                          </button>
                          <code className="text-[10px] text-muted-foreground font-mono bg-muted/60 border border-border/60 px-1.5 py-0.2 rounded-xs">
                            {module.packageName}
                          </code>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1 leading-normal max-w-xl">
                          {module.summary}
                        </p>
                      </div>
                    </div>
                  </td>

                  {/* Category */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-xs text-[10px] font-mono border ${catInfo.color}`}
                    >
                      {catInfo.label}
                    </span>
                  </td>

                  {/* Type (Dynamic vs Builtin) */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    {module.isDynamic ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-xs text-[10px] font-mono bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-500/30">
                        Dynamic .so
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-xs text-[10px] font-mono bg-muted/70 text-muted-foreground border border-border">
                        Core Built-in
                      </span>
                    )}
                  </td>

                  {/* Version & Author */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    <div className="font-mono text-xs font-medium text-foreground">
                      v{module.version}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-sans truncate max-w-[120px]">
                      {module.author}
                    </div>
                  </td>

                  {/* Status Badge */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    {isBusy ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-500/40 text-blue-600 dark:text-blue-400 text-[10px] font-mono font-medium rounded-xs">
                        <RotateCw className="w-3 h-3 animate-spin" />
                        <span>Đang xử lý</span>
                      </span>
                    ) : isLoaded ? (
                      <span
                        title={evidence ? `Nguồn xác thực: ${evidence}` : undefined}
                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-400 text-[10px] font-mono font-bold rounded-xs cursor-help"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Đã nạp</span>
                      </span>
                    ) : !module.isDynamic ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-500/30 text-sky-700 dark:text-sky-400 text-[10px] font-mono rounded-xs">
                        Tích hợp sẵn
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 bg-muted text-muted-foreground border border-border text-[10px] font-mono rounded-xs">
                        Chưa cài đặt
                      </span>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="py-3 px-4 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => onViewDetails(module)}
                        title="Xem chi tiết & Cú pháp directive"
                        className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors rounded-xs cursor-pointer border border-transparent hover:border-border"
                      >
                        <Info className="w-3.5 h-3.5" />
                      </button>

                      {isBusy ? (
                        <button
                          type="button"
                          disabled
                          className="flex items-center gap-1 px-2.5 py-1 bg-muted text-muted-foreground text-[11px] font-medium rounded-xs cursor-not-allowed opacity-70"
                        >
                          <RotateCw className="w-3 h-3 animate-spin" />
                          <span>Đang cài...</span>
                        </button>
                      ) : isLoaded ? (
                        <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 font-medium px-2 py-1">
                          ✓ Hoạt động
                        </span>
                      ) : module.isDynamic ? (
                        <button
                          type="button"
                          onClick={() => onInstall(module)}
                          disabled={!isAvailable}
                          className="flex items-center gap-1 px-2.5 py-1 bg-primary text-primary-foreground text-[11px] font-medium rounded-xs hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
                        >
                          <Download className="w-3 h-3" />
                          <span>Cài đặt</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onViewDetails(module)}
                          className="px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted border border-border/80 rounded-xs transition-colors cursor-pointer"
                        >
                          Cấu hình
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Table Footer Stats */}
      <div className="p-3 bg-muted/20 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground font-mono">
        <div>
          Hiển thị <span className="font-semibold text-foreground">{modules.length}</span> module
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            Đã nạp
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-purple-500 inline-block" />
            Dynamic Module
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-slate-400 inline-block" />
            Core Built-in
          </span>
        </div>
      </div>
    </div>
  );
}
