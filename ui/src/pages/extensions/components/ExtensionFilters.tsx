import React from 'react';
import { ExtensionCategory } from '../types';
import {
  Search,
  X,
  LayoutGrid,
  List,
  ShieldAlert,
  ShieldCheck,
  Lock,
  Sliders,
  ArrowRightLeft,
  Sparkles,
  Activity,
  HeartPulse,
  Database,
  Cpu,
  Bot,
  Layers,
} from 'lucide-react';

interface ExtensionFiltersProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedCategory: ExtensionCategory;
  onCategoryChange: (cat: ExtensionCategory) => void;
  statusFilter: 'all' | 'enabled' | 'disabled';
  onStatusFilterChange: (st: 'all' | 'enabled' | 'disabled') => void;
  viewMode: 'grid' | 'table';
  onViewModeChange: (mode: 'grid' | 'table') => void;
  categoryCounts: Record<string, number>;
}

export function ExtensionFilters({
  searchQuery,
  onSearchChange,
  selectedCategory,
  onCategoryChange,
  statusFilter,
  onStatusFilterChange,
  viewMode,
  onViewModeChange,
  categoryCounts,
}: ExtensionFiltersProps) {
  const categories: { id: ExtensionCategory; label: string; icon: React.ReactNode }[] = [
    { id: 'all', label: 'All', icon: <Layers className="w-3.5 h-3.5" /> },
    {
      id: 'security_engine',
      label: 'Security Engine',
      icon: <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />,
    },
    {
      id: 'authentication',
      label: 'Authentication',
      icon: <Lock className="w-3.5 h-3.5 text-indigo-500" />,
    },
    {
      id: 'authorization_security',
      label: 'Authz & Security',
      icon: <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />,
    },
    {
      id: 'traffic_control',
      label: 'Traffic Control',
      icon: <Sliders className="w-3.5 h-3.5 text-amber-500" />,
    },
    {
      id: 'request_transformation',
      label: 'Request Transform',
      icon: <ArrowRightLeft className="w-3.5 h-3.5 text-violet-500" />,
    },
    {
      id: 'response_transformation',
      label: 'Response Transform',
      icon: <Sparkles className="w-3.5 h-3.5 text-fuchsia-500" />,
    },
    {
      id: 'observability',
      label: 'Observability',
      icon: <Activity className="w-3.5 h-3.5 text-cyan-500" />,
    },
    {
      id: 'resilience_upstream',
      label: 'Resilience',
      icon: <HeartPulse className="w-3.5 h-3.5 text-yellow-500" />,
    },
    {
      id: 'cache_content',
      label: 'Cache & Content',
      icon: <Database className="w-3.5 h-3.5 text-sky-500" />,
    },
    {
      id: 'integration_runtime',
      label: 'Integration & Runtime',
      icon: <Cpu className="w-3.5 h-3.5 text-purple-500" />,
    },
    {
      id: 'ai_gateway',
      label: 'AI Gateway',
      icon: <Bot className="w-3.5 h-3.5 text-teal-500" />,
    },
  ];

  return (
    <div className="space-y-3.5">
      {/* Top search & status & view mode row */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Search input */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
          <input
            type="text"
            placeholder="Search by plugin name, ID, category, or tag (#jwt, #waf, #ai)..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-9 pr-8 py-2 bg-card border border-border/80 rounded-md text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-200 shadow-2xs"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer p-0.5 hover:scale-110 active:scale-90 transition-transform duration-150"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Status Filter & View Toggle */}
        <div className="flex items-center gap-2 self-end sm:self-auto">
          {/* Status Filter Segment */}
          <div className="inline-flex rounded-md border border-border/80 bg-muted/30 p-0.5 text-xs shadow-2xs">
            <button
              type="button"
              onClick={() => onStatusFilterChange('all')}
              className={`px-2.5 py-1 rounded-sm transition-all duration-200 active:scale-95 cursor-pointer font-medium ${
                statusFilter === 'all'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => onStatusFilterChange('enabled')}
              className={`px-2.5 py-1 rounded-sm transition-all duration-200 active:scale-95 cursor-pointer font-medium ${
                statusFilter === 'enabled'
                  ? 'bg-card text-emerald-600 dark:text-emerald-400 shadow-xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Enabled
            </button>
            <button
              type="button"
              onClick={() => onStatusFilterChange('disabled')}
              className={`px-2.5 py-1 rounded-sm transition-all duration-200 active:scale-95 cursor-pointer font-medium ${
                statusFilter === 'disabled'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Disabled
            </button>
          </div>

          {/* View Mode Toggle */}
          <div className="inline-flex rounded-md border border-border/80 bg-muted/30 p-0.5 text-xs shadow-2xs">
            <button
              type="button"
              title="Card Grid View"
              onClick={() => onViewModeChange('grid')}
              className={`p-1.5 rounded-sm transition-all duration-200 active:scale-90 cursor-pointer ${
                viewMode === 'grid'
                  ? 'bg-card text-primary shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Table View"
              onClick={() => onViewModeChange('table')}
              className={`p-1.5 rounded-sm transition-all duration-200 active:scale-90 cursor-pointer ${
                viewMode === 'table'
                  ? 'bg-card text-primary shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Category Pills Navigation (Horizontal scroll) */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
        {categories.map((cat) => {
          const isSelected = selectedCategory === cat.id;
          const count =
            cat.id === 'all'
              ? Object.values(categoryCounts).reduce((acc, c) => acc + c, 0)
              : categoryCounts[cat.id] || 0;

          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => onCategoryChange(cat.id)}
              className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-full border whitespace-nowrap transition-all duration-200 cursor-pointer hover:scale-105 active:scale-95 ${
                isSelected
                  ? 'border-primary bg-primary/10 text-primary font-semibold shadow-xs ring-1 ring-primary/20 scale-102'
                  : 'border-border/70 bg-card/70 text-muted-foreground hover:text-foreground hover:border-border'
              }`}
            >
              <span className="transition-transform duration-200 group-hover:scale-110">
                {cat.icon}
              </span>
              <span>{cat.label}</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono transition-colors duration-200 ${
                  isSelected
                    ? 'bg-primary text-primary-foreground font-bold'
                    : 'bg-muted text-muted-foreground group-hover:bg-muted/80'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
