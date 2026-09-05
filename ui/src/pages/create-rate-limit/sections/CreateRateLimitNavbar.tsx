import React from 'react';
import { Search, Bell, Moon } from 'lucide-react';

export function CreateRateLimitNavbar() {
  return (
    <header className="h-14 bg-[#080E18] border-b border-[#152030] flex items-center justify-between px-6 shrink-0 font-mono">
      {/* Search Input with shortcut */}
      <div className="flex items-center w-96 relative">
        <Search className="w-4 h-4 text-slate-500 absolute left-3 pointer-events-none" />
        <input
          type="text"
          placeholder="Search IP, rule, policy, node..."
          className="w-full bg-[#0E1726] border border-[#1C293D] pl-9 pr-16 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
        />
        <kbd className="absolute right-2 px-1.5 py-0.5 text-[10px] bg-[#152030] text-slate-400 border border-[#1C293D] select-none">
          Ctrl K
        </kbd>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-4">
        {/* Cluster Status */}
        <div className="flex items-center gap-2 px-3 py-1 bg-[#0E1726] border border-[#1C293D] text-xs">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <div className="flex flex-col text-left font-mono">
            <span className="text-[11px] font-semibold text-white">Cluster Healthy</span>
            <span className="text-[9px] text-slate-400">3 controllers · 12 nodes</span>
          </div>
        </div>

        {/* Notifications */}
        <button
          type="button"
          className="p-2 text-slate-400 hover:text-white hover:bg-[#152030] transition-colors relative cursor-pointer"
          title="Notifications"
        >
          <Bell className="w-4 h-4" />
          <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-blue-500" />
        </button>

        {/* Theme toggle indicator */}
        <div className="p-2 text-slate-400 hover:text-white hover:bg-[#152030] transition-colors cursor-pointer">
          <Moon className="w-4 h-4" />
        </div>
      </div>
    </header>
  );
}
