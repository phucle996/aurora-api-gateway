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
} from 'lucide-react';
import type { CatalogModule } from './moduleCatalog';

interface ModuleStoreCardProps {
  module: CatalogModule;
  isLoaded: boolean;
  isAvailable: boolean;
  isBusy: boolean;
  evidenceSource?: string;
  onInstall?: () => void;
  onViewDetails: () => void;
}

const ICONS: Record<string, React.ReactNode> = {
  Zap: <Zap className="w-5 h-5 text-amber-500" />,
  Minimize2: <Minimize2 className="w-5 h-5 text-blue-500" />,
  Radio: <Radio className="w-5 h-5 text-emerald-500" />,
  Globe: <Globe className="w-5 h-5 text-cyan-500" />,
  ShieldCheck: <ShieldCheck className="w-5 h-5 text-emerald-400" />,
  BarChart3: <BarChart3 className="w-5 h-5 text-purple-500" />,
  Cpu: <Cpu className="w-5 h-5 text-rose-500" />,
  FolderTree: <FolderTree className="w-5 h-5 text-indigo-400" />,
  Code2: <Code2 className="w-5 h-5 text-teal-400" />,
  Network: <Network className="w-5 h-5 text-sky-500" />,
  Lock: <Lock className="w-5 h-5 text-emerald-500" />,
  Layers: <Layers className="w-5 h-5 text-amber-500" />,
  Sparkles: <Sparkles className="w-5 h-5 text-purple-400" />,
  Share2: <Share2 className="w-5 h-5 text-cyan-400" />,
  KeyRound: <KeyRound className="w-5 h-5 text-amber-400" />,
  Activity: <Activity className="w-5 h-5 text-rose-400" />,
  FileText: <FileText className="w-5 h-5 text-blue-400" />,
  FileVideo: <FileVideo className="w-5 h-5 text-indigo-400" />,
  RefreshCw: <RefreshCw className="w-5 h-5 text-teal-400" />,
  Film: <Film className="w-5 h-5 text-amber-500" />,
};

const CATEGORY_NAMES: Record<string, string> = {
  performance: 'HTTP/3 & Tối ưu',
  security: 'Bảo mật & WAF',
  observability: 'Giám sát & Traffic',
  routing: 'Định tuyến & L4 Proxy',
  utilities: 'Tiện ích & Media',
};

export function ModuleStoreCard({
  module,
  isLoaded,
  isAvailable,
  isBusy,
  evidenceSource,
  onInstall,
  onViewDetails,
}: ModuleStoreCardProps) {
  return (
    <div className="bg-card border border-border rounded-sm p-4 flex flex-col justify-between hover:border-primary/50 transition-all duration-200 shadow-xs group">
      {/* Top Header */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xs border border-border bg-muted/40 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform duration-200">
              {ICONS[module.iconName] || <Zap className="w-5 h-5 text-primary" />}
            </div>
            <div>
              <h3 className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors">
                {module.name}
              </h3>
              <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground font-mono">
                <span>v{module.version}</span>
                <span>·</span>
                <span>{module.author}</span>
              </div>
            </div>
          </div>

          {/* Status Badge */}
          <div>
            {isBusy ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-500/40 text-blue-600 dark:text-blue-400 text-[10px] font-mono font-medium rounded-xs">
                <RotateCw className="w-3 h-3 animate-spin" />
                <span>Đang xử lý</span>
              </span>
            ) : isLoaded ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-400 text-[10px] font-mono font-bold rounded-xs">
                <CheckCircle2 className="w-3 h-3" />
                <span>Đã nạp</span>
              </span>
            ) : !module.isDynamic ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-500/30 text-sky-700 dark:text-sky-400 text-[10px] font-mono rounded-xs">
                Core Built-in
              </span>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 bg-muted text-muted-foreground border border-border text-[10px] font-mono rounded-xs">
                Chưa cài đặt
              </span>
            )}
          </div>
        </div>

        {/* Category Tag & Feature */}
        <div className="flex items-center gap-2 mt-3">
          <span className="px-1.5 py-0.5 bg-muted/60 text-muted-foreground border border-border text-[10px] font-mono rounded-xs">
            {CATEGORY_NAMES[module.category] || module.category}
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">
            {module.isDynamic ? 'Dynamic Module' : 'Static Builtin'}
          </span>
        </div>

        {/* Short Summary Description */}
        <p className="text-xs text-muted-foreground mt-2.5 line-clamp-2 leading-relaxed">
          {module.summary}
        </p>
      </div>

      {/* Card Action Footer */}
      <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onViewDetails}
          className="flex items-center gap-1 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded-xs cursor-pointer"
        >
          <Info className="w-3.5 h-3.5" />
          <span>Chi tiết</span>
        </button>

        <div>
          {isBusy ? (
            <button
              type="button"
              disabled
              className="flex items-center gap-1.5 px-3 py-1 bg-muted text-muted-foreground text-xs font-medium rounded-xs cursor-not-allowed opacity-70"
            >
              <RotateCw className="w-3.5 h-3.5 animate-spin" />
              <span>Đang cài...</span>
            </button>
          ) : isLoaded ? (
            <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 font-medium px-2 py-1">
              ✓ Đang hoạt động
            </span>
          ) : module.action && onInstall ? (
            <button
              type="button"
              onClick={onInstall}
              disabled={!isAvailable}
              className="flex items-center gap-1.5 px-3 py-1 bg-primary text-primary-foreground text-xs font-medium rounded-xs hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Cài đặt</span>
            </button>
          ) : (
            <span className="text-[11px] font-mono text-muted-foreground px-2 py-1">
              Tích hợp sẵn
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
