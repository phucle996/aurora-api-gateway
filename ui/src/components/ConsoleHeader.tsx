import React, { useState, useEffect } from 'react';
import { Search, Terminal, ChevronDown, Moon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getAuthUser } from '../lib/fetcher';

interface ConsoleHeaderProps {
  onSearch?: (query: string) => void;
  title?: string;
}

export function ConsoleHeader({ onSearch, title }: ConsoleHeaderProps) {
  const user = getAuthUser();
  const [searchQuery, setSearchQuery] = useState('');

  // Global keyboard shortcut (Ctrl + K or Cmd + K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const input = document.getElementById('global-search-input') as HTMLInputElement;
        if (input) {
          input.focus();
          input.select();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    if (onSearch) {
      onSearch(e.target.value);
    }
  };

  return (
    <header className="h-14 px-4 sm:px-6 bg-[#080E18] border-b border-[#152030] flex items-center justify-between sticky top-0 z-20 font-mono select-none">
      {/* Global Search & Console Badge */}
      <div className="flex items-center gap-3 flex-1 max-w-lg">
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-[#0E1726] border border-[#1C293D] text-[11px] font-mono text-cyan-400 font-bold shrink-0">
          <Terminal className="w-3.5 h-3.5" />
          <span>CONSOLE</span>
        </div>

        <div className="relative w-full max-w-sm">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="global-search-input"
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="Search IP, rule, policy, node... (Ctrl K)"
            className="w-full bg-[#0E1726] border border-[#1C293D] pl-8 pr-14 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/80 transition-colors font-mono"
          />
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[9px] bg-[#152030] text-slate-400 border border-[#1C293D] select-none">
            Ctrl K
          </kbd>
        </div>
      </div>

      {/* Right Navigation Controls */}
      <div className="flex items-center gap-3 sm:gap-4 shrink-0">
        {/* Cluster Status Indicator */}
        <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-[#0E1726] border border-[#1C293D] text-xs font-mono">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="text-emerald-400 font-semibold">Cluster Healthy</span>
          <span className="text-slate-600">·</span>
          <span className="text-slate-400 text-[11px]">3 controllers · 12 nodes</span>
        </div>

        {/* Theme Indicator */}
        <div
          className="p-1.5 text-slate-400 hover:text-white hover:bg-[#152030] transition-colors cursor-pointer"
          title="Dark Mode"
        >
          <Moon className="w-4 h-4" />
        </div>

        {/* User Profile */}
        <Link
          to="/settings"
          className="flex items-center gap-2.5 pl-3 border-l border-[#152030] hover:opacity-90 transition-opacity"
        >
          <div className="w-7 h-7 bg-blue-900/60 border border-blue-700/60 flex items-center justify-center text-cyan-300 text-[11px] font-mono font-bold uppercase">
            {(user?.username || 'A')[0]}
          </div>
          <div className="hidden sm:flex flex-col text-left">
            <span className="text-xs font-mono text-slate-200 leading-tight capitalize">{user?.username || 'Admin'}</span>
            <span className="text-[9px] text-slate-500 font-mono capitalize">{user?.role || 'Administrator'}</span>
          </div>
          <ChevronDown className="w-3 h-3 text-slate-500 hidden sm:block" />
        </Link>
      </div>
    </header>
  );
}

export default ConsoleHeader;
