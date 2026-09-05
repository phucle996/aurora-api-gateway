import React from 'react';
import { Search, ChevronDown, Bell, Terminal } from 'lucide-react';

export function RulesNavbar() {
  return (
    <header className="h-14 px-6 bg-[#080E18] border-b border-[#152030] flex items-center justify-between sticky top-0 z-20">
      {/* Global Search */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#0E1726] border border-[#1C293D] text-[11px] font-mono text-emerald-400">
          <Terminal className="w-3.5 h-3.5" />
          <span>CONSOLE</span>
        </div>
        <div className="relative w-80">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search policies, rules, events..."
            className="w-full bg-[#0E1726] border border-[#1C293D] pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/80 transition-colors font-mono"
          />
        </div>
      </div>

      {/* Right Navigation Controls */}
      <div className="flex items-center gap-3">
        {/* Notification Bell */}
        <button
          type="button"
          className="relative p-2 text-slate-400 hover:text-slate-200 hover:bg-[#0E1726] transition-colors cursor-pointer border border-transparent hover:border-[#1C293D]"
          aria-label="Notifications"
        >
          <Bell className="w-4 h-4" />
          <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-emerald-500" />
        </button>

        {/* User Profile */}
        <div className="flex items-center gap-2.5 pl-3 border-l border-[#152030]">
          <div className="w-6 h-6 bg-emerald-700/80 border border-emerald-500 flex items-center justify-center text-white text-[10px] font-mono font-bold">
            AR
          </div>
          <span className="text-xs font-mono text-slate-200">admin@aurora</span>
          <ChevronDown className="w-3 h-3 text-slate-500 cursor-pointer" />
        </div>
      </div>
    </header>
  );
}
