import React from 'react';
import { Link } from 'react-router-dom';
import auroraLogo from '@/assets/image.png';
import {
  LayoutDashboard,
  ShieldAlert,
  FileText,
  FileCode,
  ShieldCheck,
  Activity,
  Server,
  Settings,
} from 'lucide-react';

export function DashboardSidebar() {
  return (
    <aside className="w-60 bg-[#080E18] border-r border-[#152030] flex flex-col justify-between shrink-0 select-none">
      <div>
        {/* Brand Logo Header */}
        <div className="h-14 px-5 flex items-center border-b border-[#152030]">
          <Link to="/" className="flex items-center gap-2.5">
            <img
              src={auroraLogo}
              alt="Aurora"
              className="h-6 w-auto object-contain"
            />
          </Link>
        </div>

        {/* Nav Items */}
        <nav className="p-2 space-y-0.5">
          {/* Active Link: Dashboard */}
          <Link
            to="/dashboard"
            className="flex items-center gap-3 px-3 py-2 text-xs font-semibold text-emerald-400 bg-emerald-950/30 border-l-2 border-emerald-400 transition-colors"
          >
            <LayoutDashboard className="w-4 h-4 text-emerald-400" />
            <span>Dashboard</span>
          </Link>

          <Link
            to="/events"
            className="flex items-center gap-3 px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-[#0E1726] transition-colors"
          >
            <ShieldAlert className="w-4 h-4 text-slate-400" />
            <span>Security Events</span>
          </Link>

          <Link
            to="/rules"
            className="flex items-center gap-3 px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-[#0E1726] transition-colors"
          >
            <FileText className="w-4 h-4 text-slate-400" />
            <span>Rules</span>
          </Link>

          <Link
            to="/policies"
            className="flex items-center gap-3 px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-[#0E1726] transition-colors"
          >
            <FileCode className="w-4 h-4 text-slate-400" />
            <span>Policies</span>
          </Link>

          <Link
            to="/ip-access"
            className="flex items-center gap-3 px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-[#0E1726] transition-colors"
          >
            <ShieldCheck className="w-4 h-4 text-slate-400" />
            <span>IP Access</span>
          </Link>

          <Link
            to="/rate-limits"
            className="flex items-center gap-3 px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-[#0E1726] transition-colors"
          >
            <Activity className="w-4 h-4 text-slate-400" />
            <span>Rate Limits</span>
          </Link>

          <Link
            to="/nodes"
            className="flex items-center gap-3 px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-[#0E1726] transition-colors"
          >
            <Server className="w-4 h-4 text-slate-400" />
            <span>Nodes</span>
          </Link>

          <Link
            to="/settings"
            className="flex items-center gap-3 px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-[#0E1726] transition-colors"
          >
            <Settings className="w-4 h-4 text-slate-400" />
            <span>Settings</span>
          </Link>
        </nav>
      </div>

      {/* Sidebar Footer */}
      <div className="p-4 border-t border-[#152030] text-[11px] text-slate-500 font-mono">
        <div>Aurora WAF Console</div>
        <div className="text-slate-600 mt-0.5">v2024.11.3</div>
      </div>
    </aside>
  );
}
