import React from 'react';
import { Package, Server, RotateCw, Terminal } from 'lucide-react';
import type { DependencyNode } from './types';

export interface ModuleStoreHeaderProps {
  nodes: DependencyNode[];
  selectedNodeId: string;
  onSelectNodeId: (nodeId: string) => void;
  currentNode: DependencyNode | null;
  isNodeBusy: boolean;
  isRefreshing: boolean;
  onScanNode: () => void;
  onOpenTaskDrawer: () => void;
}

export function ModuleStoreHeader({
  nodes,
  selectedNodeId,
  onSelectNodeId,
  currentNode,
  isNodeBusy,
  isRefreshing,
  onScanNode,
  onOpenTaskDrawer,
}: ModuleStoreHeaderProps) {
  return (
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
                onChange={(e) => onSelectNodeId(e.target.value)}
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
              onClick={onScanNode}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-xs bg-muted/40 hover:bg-muted text-foreground transition-colors rounded-xs cursor-pointer disabled:opacity-50"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-primary' : ''}`} />
              <span>Quét lại Node</span>
            </button>
          )}

          {currentNode && currentNode.job_id > 0 && (
            <button
              type="button"
              onClick={onOpenTaskDrawer}
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
  );
}
