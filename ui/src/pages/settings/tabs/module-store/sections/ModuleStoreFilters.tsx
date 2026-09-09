import React from 'react';
import { Search, List, LayoutGrid } from 'lucide-react';
import type { ModuleCategory } from './moduleCatalog';

export interface ModuleStoreFiltersProps {
  selectedCategory: ModuleCategory;
  onSelectCategory: (category: ModuleCategory) => void;
  statusFilter: 'all' | 'loaded' | 'available';
  onChangeStatusFilter: (status: 'all' | 'loaded' | 'available') => void;
  searchQuery: string;
  onChangeSearchQuery: (query: string) => void;
  viewMode: 'table' | 'cards';
  onChangeViewMode: (mode: 'table' | 'cards') => void;
}

const CATEGORIES: Array<{ key: ModuleCategory; label: string }> = [
  { key: 'all', label: 'Tất cả' },
  { key: 'performance', label: 'HTTP/3 & Tối ưu nén' },
  { key: 'security', label: 'Bảo mật & WAF' },
  { key: 'observability', label: 'Giám sát & Traffic' },
  { key: 'routing', label: 'Định tuyến L4 Proxy' },
  { key: 'utilities', label: 'Tiện ích & Media' },
];

export function ModuleStoreFilters({
  selectedCategory,
  onSelectCategory,
  statusFilter,
  onChangeStatusFilter,
  searchQuery,
  onChangeSearchQuery,
  viewMode,
  onChangeViewMode,
}: ModuleStoreFiltersProps) {
  return (
    <div className="bg-card border border-border rounded-sm p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-xs">
      {/* Category Pills */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            type="button"
            onClick={() => onSelectCategory(cat.key)}
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
          onChange={(e) => onChangeStatusFilter(e.target.value as 'all' | 'loaded' | 'available')}
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
            onChange={(e) => onChangeSearchQuery(e.target.value)}
            placeholder="Tìm kiếm module (HTTP/3, Brotli, GeoIP2...)..."
            className="w-full bg-background border border-input pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground rounded-xs focus:outline-none focus:border-primary font-sans"
          />
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center border border-input rounded-xs overflow-hidden bg-background p-0.5 shrink-0">
          <button
            type="button"
            onClick={() => onChangeViewMode('table')}
            title="Chế độ Bảng danh sách (Table)"
            className={`p-1.5 rounded-xs transition-colors cursor-pointer ${
              viewMode === 'table'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <List className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onChangeViewMode('cards')}
            title="Chế độ Thẻ (Cards)"
            className={`p-1.5 rounded-xs transition-colors cursor-pointer ${
              viewMode === 'cards'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
