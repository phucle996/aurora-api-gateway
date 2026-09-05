import React from 'react';

export function LoginFooter() {
  return (
    <footer className="w-full px-8 py-5 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-4 z-10">
      <div className="flex items-center gap-2">
        <span>Aurora WAF Console</span>
        <span className="text-slate-600">v2024.11.3</span>
      </div>

      <div className="flex items-center gap-5 sm:gap-6 flex-wrap justify-center">
        <div className="flex items-center gap-3 text-slate-400">
          <a href="#documentation" className="hover:text-slate-200 transition-colors">
            Documentation
          </a>
          <span className="text-slate-700">|</span>
          <a href="#support" className="hover:text-slate-200 transition-colors">
            Support
          </a>
          <span className="text-slate-700">|</span>
          <a href="#status" className="hover:text-slate-200 transition-colors">
            Status
          </a>
        </div>

        <div className="flex items-center gap-2 pl-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="text-emerald-400 font-medium text-xs select-none">
            All Systems Operational
          </span>
        </div>
      </div>
    </footer>
  );
}
