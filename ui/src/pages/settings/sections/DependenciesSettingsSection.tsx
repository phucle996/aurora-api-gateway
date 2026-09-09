import React, { useEffect, useRef, useState, useMemo } from 'react';
import { api } from '../../../lib/fetcher';
import {
  Search,
  RotateCw,
  Server,
  Layers,
  CheckCircle2,
  Download,
  Terminal,
  AlertCircle,
  Package,
} from 'lucide-react';
import { MODULE_CATALOG, type CatalogModule, type ModuleCategory } from './module-store/moduleCatalog';
import { ModuleStoreCard } from './module-store/ModuleStoreCard';
import { ModuleDetailModal } from './module-store/ModuleDetailModal';
import { ModuleTaskDrawer } from './module-store/ModuleTaskDrawer';

interface DependencyNode {
  node_id: string;
  checked_at: number;
  nginx_version: string;
  architecture: string;
  fresh: boolean;
  installable: boolean;
  error: string;
  modules: Array<{ name: string; available: boolean; loaded: boolean; source: string }>;
  job_id: number;
  job_action: string;
  job_state: string;
  job_message: string;
}

function checkIsModuleLoaded(mod: CatalogModule, nodeModules?: Array<{ name: string; loaded: boolean }>): boolean {
  if (!nodeModules) return false;
  return nodeModules.some((m) => {
    if (!m.loaded) return false;
    if (m.name === mod.id || m.name === mod.packageName) return true;
    if (mod.aliases && mod.aliases.includes(m.name)) return true;
    return false;
  });
}

function getModuleEvidence(mod: CatalogModule, nodeModules?: Array<{ name: string; loaded: boolean; source: string }>): string | undefined {
  if (!nodeModules) return undefined;
  const match = nodeModules.find((m) => {
    if (m.name === mod.id || m.name === mod.packageName) return true;
    if (mod.aliases && mod.aliases.includes(m.name)) return true;
    return false;
  });
  return match?.source;
}

export function DependenciesSettingsSection() {
  const [nodes, setNodes] = useState<DependencyNode[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string>('');
  const [error, setError] = useState('');
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ModuleCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'loaded' | 'available'>('all');

  // Modals & Drawers
  const [detailModule, setDetailModule] = useState<CatalogModule | null>(null);
  const [showTaskDrawer, setShowTaskDrawer] = useState(false);

  const sequence = useRef(0);

  async function refresh(isManual = false) {
    const current = ++sequence.current;
    if (isManual) setIsRefreshing(true);
    try {
      const result = await api.get<DependencyNode[]>('/api/v1/settings/dependencies');
      if (sequence.current === current) {
        setNodes(result);
        if (result.length > 0 && !selectedNodeId) {
          setSelectedNodeId(result[0].node_id);
        }
        setError('');
      }
    } catch (e) {
      if (sequence.current === current) {
        setError(e instanceof Error ? e.message : 'Không tải được báo cáo dependencies');
      }
    } finally {
      if (sequence.current === current) {
        setLoading(false);
        if (isManual) setIsRefreshing(false);
      }
    }
  }

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      clearInterval(timer);
      sequence.current++;
    };
  }, []);

  const currentNode = useMemo(() => {
    return nodes.find((n) => n.node_id === selectedNodeId) || nodes[0] || null;
  }, [nodes, selectedNodeId]);

  // Merge reported modules from node with static catalog
  const allModules = useMemo(() => {
    const catalog = [...MODULE_CATALOG];
    if (!currentNode) return catalog;

    // Check if there are extra modules reported by NGINX not in predefined catalog
    currentNode.modules.forEach((mod) => {
      const exists = catalog.some(
        (c) => c.id === mod.name || c.packageName === mod.name || (c.aliases && c.aliases.includes(mod.name))
      );
      if (!exists && !mod.name.startsWith('mail_') && !mod.name.startsWith('stream_realip') && !mod.name.startsWith('stream_ssl_module')) {
        const cleanName = mod.name.replace(/^ngx_http_/, '').replace(/^http_/, '').replace(/_module$/, '');
        catalog.push({
          id: mod.name,
          name: `NGINX ${cleanName.charAt(0).toUpperCase() + cleanName.slice(1)}`,
          packageName: mod.name,
          aliases: [mod.name],
          category: 'utilities',
          version: 'Built-in',
          author: 'NGINX Core',
          summary: `Module ${mod.name} nạp từ cấu hình runtime NGINX.`,
          description: `Module NGINX được phát hiện và báo cáo tự động từ node ${currentNode.node_id}. Nguồn: ${mod.source}`,
          iconName: 'Layers',
          directivesExample: `# Module được biên dịch và nạp tự động qua runtime NGINX`,
          isDynamic: mod.source !== 'nginx build',
        });
      }
    });

    return catalog;
  }, [currentNode]);

  const filteredModules = useMemo(() => {
    return allModules.filter((mod) => {
      // Category filter
      if (selectedCategory !== 'all' && mod.category !== selectedCategory) {
        return false;
      }

      // Determine if loaded
      const isLoaded = checkIsModuleLoaded(mod, currentNode?.modules);

      // Status filter
      if (statusFilter === 'loaded' && !isLoaded) return false;
      if (statusFilter === 'available' && isLoaded) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = mod.name.toLowerCase().includes(q);
        const matchDesc = mod.description.toLowerCase().includes(q);
        const matchPkg = mod.packageName.toLowerCase().includes(q);
        const matchAuthor = mod.author.toLowerCase().includes(q);
        const matchAlias = mod.aliases?.some((a) => a.toLowerCase().includes(q));
        if (!matchName && !matchDesc && !matchPkg && !matchAuthor && !matchAlias) return false;
      }

      return true;
    });
  }, [allModules, selectedCategory, statusFilter, searchQuery, currentNode]);

  // Statistics
  const stats = useMemo(() => {
    if (!currentNode) {
      return { total: allModules.length, loaded: 0, available: allModules.length };
    }
    const loadedCount = allModules.filter((mod) => checkIsModuleLoaded(mod, currentNode.modules)).length;

    return {
      total: allModules.length,
      loaded: loadedCount,
      available: Math.max(0, allModules.length - loadedCount),
    };
  }, [allModules, currentNode]);

  async function handleQueueJob(nodeId: string, action: 'check' | 'install_brotli') {
    setPendingAction(action);
    setShowTaskDrawer(true);
    try {
      await api.post(`/api/v1/settings/dependencies/${encodeURIComponent(nodeId)}/jobs`, { action });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không gửi được yêu cầu cài đặt');
    } finally {
      setPendingAction(null);
    }
  }

  const isNodeBusy = Boolean(
    pendingAction ||
      (currentNode && (currentNode.job_state === 'pending' || currentNode.job_state === 'running'))
  );

  return (
    <section className="space-y-5 font-sans">
      {/* Top Banner / Hero */}
      <div className="bg-card border border-border rounded-sm p-5 shadow-xs relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2">
              <Package className="w-5 h-5 text-primary" />
              <h2 className="text-base font-semibold text-foreground tracking-tight">
                NGINX Module Store (Kho ứng dụng Module)
              </h2>
            </div>
            <p className="text-xs text-muted-foreground mt-1 max-w-2xl leading-relaxed">
              Hệ thống quản lý module NGINX toàn diện: từ giao thức <strong>HTTP/3 QUIC (UDP)</strong>, HTTP/2, bộ nén Brotli/Zstd, cho đến các module bảo mật GeoIP2, Headers More và L4 Stream Proxy theo phong cách aaPanel.
            </p>
          </div>

          {/* Node Selector & Check Button */}
          <div className="flex flex-wrap items-center gap-2.5">
            {nodes.length > 1 && (
              <div className="flex items-center gap-1.5 bg-muted/50 border border-border px-2.5 py-1.5 rounded-xs text-xs">
                <Server className="w-3.5 h-3.5 text-muted-foreground" />
                <select
                  value={selectedNodeId}
                  onChange={(e) => setSelectedNodeId(e.target.value)}
                  className="bg-transparent border-none text-foreground font-mono focus:outline-none cursor-pointer"
                >
                  {nodes.map((node) => (
                    <option key={node.node_id} value={node.node_id} className="bg-card">
                      {node.node_id}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {currentNode && (
              <button
                type="button"
                disabled={isNodeBusy || isRefreshing}
                onClick={() => void handleQueueJob(currentNode.node_id, 'check')}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-xs bg-muted/40 hover:bg-muted text-foreground transition-colors rounded-xs cursor-pointer disabled:opacity-50"
              >
                <RotateCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-primary' : ''}`} />
                <span>Quét lại Node</span>
              </button>
            )}

            {currentNode && currentNode.job_id > 0 && (
              <button
                type="button"
                onClick={() => setShowTaskDrawer(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 border border-primary/30 text-primary text-xs font-semibold rounded-xs hover:bg-primary/20 transition-colors cursor-pointer"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>Nhật ký Job #{currentNode.job_id}</span>
              </button>
            )}
          </div>
        </div>

        {/* Node Telemetry Quick Info */}
        {currentNode && (
          <div className="mt-4 pt-3 border-t border-border/60 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs font-mono text-muted-foreground">
            <div>
              <span>Node ID: </span>
              <span className="text-foreground font-semibold">{currentNode.node_id}</span>
            </div>
            <div>
              <span>Phiên bản: </span>
              <span className="text-foreground font-semibold">
                {currentNode.nginx_version ? `NGINX ${currentNode.nginx_version}` : 'Đang chờ báo cáo...'}
              </span>
            </div>
            <div>
              <span>Kiến trúc: </span>
              <span className="text-foreground font-semibold">{currentNode.architecture || 'x86_64'}</span>
            </div>
            <div>
              <span>Trạng thái kiểm tra: </span>
              <span className={currentNode.fresh ? 'text-emerald-500 font-semibold' : 'text-amber-500 font-semibold'}>
                {currentNode.fresh ? 'Mới nhất (Online)' : 'Hết hạn (Stale)'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* KPI Stats Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-card border border-border p-3.5 rounded-sm shadow-xs flex items-center justify-between">
          <div>
            <div className="text-[11px] text-muted-foreground uppercase font-mono tracking-wider">
              Tổng Module trong Store
            </div>
            <div className="text-xl font-bold text-foreground font-mono mt-0.5">{stats.total}</div>
          </div>
          <div className="w-9 h-9 rounded-xs bg-muted/60 border border-border flex items-center justify-center">
            <Layers className="w-4 h-4 text-primary" />
          </div>
        </div>

        <div className="bg-card border border-border p-3.5 rounded-sm shadow-xs flex items-center justify-between">
          <div>
            <div className="text-[11px] text-muted-foreground uppercase font-mono tracking-wider">
              Đang hoạt động (Active)
            </div>
            <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">
              {stats.loaded}
            </div>
          </div>
          <div className="w-9 h-9 rounded-xs bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-500/30 flex items-center justify-center">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
        </div>

        <div className="bg-card border border-border p-3.5 rounded-sm shadow-xs flex items-center justify-between">
          <div>
            <div className="text-[11px] text-muted-foreground uppercase font-mono tracking-wider">
              Khả dụng để cài đặt
            </div>
            <div className="text-xl font-bold text-blue-600 dark:text-blue-400 font-mono mt-0.5">
              {stats.available}
            </div>
          </div>
          <div className="w-9 h-9 rounded-xs bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-500/30 flex items-center justify-center">
            <Download className="w-4 h-4 text-blue-500" />
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-card border border-border rounded-sm p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-xs">
        {/* Category Pills */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {[
            { key: 'all', label: 'Tất cả' },
            { key: 'performance', label: 'HTTP/3 & Tối ưu nén' },
            { key: 'security', label: 'Bảo mật & WAF' },
            { key: 'observability', label: 'Giám sát & Traffic' },
            { key: 'routing', label: 'Định tuyến L4 Proxy' },
            { key: 'utilities', label: 'Tiện ích & Media' },
          ].map((cat) => (
            <button
              key={cat.key}
              type="button"
              onClick={() => setSelectedCategory(cat.key as ModuleCategory)}
              className={`px-3 py-1.5 rounded-xs transition-colors cursor-pointer font-medium ${
                selectedCategory === cat.key
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Search & Status Filter */}
        <div className="flex items-center gap-2.5 flex-1 min-w-[280px] justify-end">
          {/* Status filter dropdown */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'loaded' | 'available')}
            className="bg-background border border-input px-2.5 py-1.5 text-xs text-foreground rounded-xs focus:outline-none focus:border-primary cursor-pointer"
          >
            <option value="all">Tất cả trạng thái</option>
            <option value="loaded">Đã nạp / Hoạt động</option>
            <option value="available">Chưa cài đặt</option>
          </select>

          {/* Search Input */}
          <div className="relative w-full max-w-xs">
            <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm kiếm module (HTTP/3, Brotli, GeoIP2...)..."
              className="w-full bg-background border border-input pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground rounded-xs focus:outline-none focus:border-primary font-sans"
            />
          </div>
        </div>
      </div>

      {/* Error Alert if any */}
      {error && (
        <div className="p-3.5 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-500/40 rounded-sm flex items-center justify-between text-xs text-rose-700 dark:text-rose-400">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => void refresh(true)}
            className="underline hover:no-underline font-medium cursor-pointer"
          >
            Thử lại
          </button>
        </div>
      )}

      {/* Modules Cards Grid */}
      {loading ? (
        <div className="py-16 text-center text-muted-foreground flex flex-col items-center justify-center gap-2">
          <RotateCw className="w-6 h-6 animate-spin text-primary" />
          <span className="text-xs">Đang tải danh mục Module Store...</span>
        </div>
      ) : filteredModules.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground border border-border border-dashed rounded-sm bg-muted/10 p-8 space-y-2">
          <Package className="w-8 h-8 mx-auto text-muted-foreground opacity-50" />
          <p className="text-sm font-medium">Không tìm thấy module nào phù hợp</p>
          <p className="text-xs text-muted-foreground/80">
            Thử thay đổi bộ lọc danh mục hoặc từ khóa tìm kiếm của bạn.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredModules.map((module) => {
            const isLoaded = checkIsModuleLoaded(module, currentNode?.modules);
            const evidence = getModuleEvidence(module, currentNode?.modules);

            const isAvailable = Boolean(
              module.action === 'install_brotli' ? currentNode?.installable && currentNode?.fresh : true
            );

            const isBusy =
              isNodeBusy &&
              (pendingAction === module.action ||
                (currentNode?.job_action === module.action &&
                  (currentNode?.job_state === 'pending' || currentNode?.job_state === 'running')));

            return (
              <ModuleStoreCard
                key={module.id}
                module={module}
                isLoaded={isLoaded}
                isAvailable={isAvailable}
                isBusy={isBusy}
                evidenceSource={evidence}
                onInstall={
                  module.action && currentNode
                    ? () => void handleQueueJob(currentNode.node_id, module.action as 'install_brotli')
                    : undefined
                }
                onViewDetails={() => setDetailModule(module)}
              />
            );
          })}
        </div>
      )}

      {/* Detail Modal */}
      {detailModule && (
        <ModuleDetailModal
          module={detailModule}
          isLoaded={checkIsModuleLoaded(detailModule, currentNode?.modules)}
          evidenceSource={getModuleEvidence(detailModule, currentNode?.modules)}
          onClose={() => setDetailModule(null)}
          onInstall={
            detailModule.action && currentNode
              ? () => {
                  const act = detailModule.action as 'install_brotli';
                  setDetailModule(null);
                  void handleQueueJob(currentNode.node_id, act);
                }
              : undefined
          }
          isBusy={isNodeBusy}
          canInstall={Boolean(
            detailModule.action === 'install_brotli' ? currentNode?.installable && currentNode?.fresh : true
          )}
        />
      )}

      {/* Task Drawer */}
      {showTaskDrawer && currentNode && (
        <ModuleTaskDrawer
          nodeId={currentNode.node_id}
          jobId={currentNode.job_id}
          jobAction={currentNode.job_action}
          jobState={currentNode.job_state}
          jobMessage={currentNode.job_message}
          onClose={() => setShowTaskDrawer(false)}
          onRetry={() => {
            if (currentNode.job_action === 'install_brotli') {
              void handleQueueJob(currentNode.node_id, 'install_brotli');
            } else {
              void handleQueueJob(currentNode.node_id, 'check');
            }
          }}
        />
      )}
    </section>
  );
}
