import React, { useEffect, useRef, useState, useMemo } from 'react';
import { api } from '../../../../lib/fetcher';
import { RotateCw, AlertCircle, Package } from 'lucide-react';
import { MODULE_CATALOG, type CatalogModule, type ModuleCategory } from './sections/moduleCatalog';
import { ModuleStoreNode, checkIsModuleLoaded, getModuleEvidence } from './sections/types';
import { ModuleStoreHeader } from './sections/ModuleStoreHeader';
import { ModuleStoreStats } from './sections/ModuleStoreStats';
import { ModuleStoreFilters } from './sections/ModuleStoreFilters';
import { ModuleStoreCard } from './sections/ModuleStoreCard';
import { ModuleStoreTable } from './sections/ModuleStoreTable';
import { ModuleDetailModal } from './sections/ModuleDetailModal';
import { ModuleTaskDrawer } from './sections/ModuleTaskDrawer';
import { SyncOverviewCard } from './sections/SyncOverviewCard';
import type { ModuleSyncItem } from './sections/types';

export function ModuleStoreTab() {
  const [nodes, setNodes] = useState<ModuleStoreNode[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string>('');
  const [error, setError] = useState('');
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Sync Overview State (ArgoCD Style)
  const [syncItems, setSyncItems] = useState<ModuleSyncItem[]>([]);
  const [syncLoading, setSyncLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ModuleCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'loaded' | 'available'>('all');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');

  // Modals & Drawers
  const [detailModule, setDetailModule] = useState<CatalogModule | null>(null);
  const [showTaskDrawer, setShowTaskDrawer] = useState(false);

  const sequence = useRef(0);

  async function fetchSyncOverview() {
    try {
      const result = await api.get<ModuleSyncItem[]>('/api/v1/settings/modules/sync-overview');
      setSyncItems(result);
    } catch {
      // Ignored non-critical sync overview fetch error
    } finally {
      setSyncLoading(false);
    }
  }

  async function refresh(isManual = false) {
    const current = ++sequence.current;
    if (isManual) setIsRefreshing(true);
    try {
      const [nodesResult] = await Promise.all([
        api.get<ModuleStoreNode[]>('/api/v1/settings/modules'),
        fetchSyncOverview(),
      ]);
      if (sequence.current === current) {
        setNodes(nodesResult);
        if (nodesResult.length > 0 && !selectedNodeId) {
          setSelectedNodeId(nodesResult[0].node_id);
        }
        setError('');
      }
    } catch (e) {
      if (sequence.current === current) {
        setError(e instanceof Error ? e.message : 'Không tải được báo cáo module store');
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
      if (
        !exists &&
        !mod.name.startsWith('mail_') &&
        !mod.name.startsWith('stream_realip') &&
        !mod.name.startsWith('stream_ssl_module')
      ) {
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
        const matchAlias = mod.aliases?.some((a: string) => a.toLowerCase().includes(q));
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

  async function handleQueueJob(nodeId: string, action: string) {
    setPendingAction(action);
    setShowTaskDrawer(true);
    try {
      await api.post(`/api/v1/settings/modules/${encodeURIComponent(nodeId)}/jobs`, { action });
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
      <ModuleStoreHeader
        nodes={nodes}
        selectedNodeId={selectedNodeId}
        onSelectNodeId={setSelectedNodeId}
        currentNode={currentNode}
        isNodeBusy={isNodeBusy}
        isRefreshing={isRefreshing}
        onScanNode={() => {
          if (currentNode) {
            void handleQueueJob(currentNode.node_id, 'check');
          }
        }}
        onOpenTaskDrawer={() => setShowTaskDrawer(true)}
      />

      {/* Sync Overview (ArgoCD Style: Desired vs Live Actual State) */}
      <SyncOverviewCard
        items={syncItems}
        loading={syncLoading}
        onRefresh={fetchSyncOverview}
      />

      {/* KPI Stats Bar */}
      <ModuleStoreStats
        total={stats.total}
        loaded={stats.loaded}
        available={stats.available}
      />


      {/* Filter and Search Bar */}
      <ModuleStoreFilters
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
        statusFilter={statusFilter}
        onChangeStatusFilter={setStatusFilter}
        searchQuery={searchQuery}
        onChangeSearchQuery={setSearchQuery}
        viewMode={viewMode}
        onChangeViewMode={setViewMode}
      />

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

      {/* Modules List / Table / Grid */}
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
      ) : viewMode === 'table' ? (
        <ModuleStoreTable
          modules={filteredModules}
          currentNode={currentNode}
          isNodeBusy={isNodeBusy}
          pendingAction={pendingAction}
          checkIsModuleLoaded={checkIsModuleLoaded}
          getModuleEvidence={getModuleEvidence}
          onInstall={(module: CatalogModule) => {
            if (module.action && currentNode) {
              void handleQueueJob(currentNode.node_id, module.action);
            }
          }}
          onViewDetails={(module: CatalogModule) => setDetailModule(module)}
        />
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
                    ? () => void handleQueueJob(currentNode.node_id, module.action!)
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
                  const act = detailModule.action!;
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
          jobLogs={currentNode.job_logs}
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
