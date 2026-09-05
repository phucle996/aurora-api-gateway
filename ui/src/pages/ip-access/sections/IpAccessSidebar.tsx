import React from 'react';
import { Link } from 'react-router-dom';
import auroraLogo from '@/assets/image.png';
import {
  LayoutDashboard,
  ShieldAlert,
  FileText,
  FileCode,
  Globe2,
  Activity,
  Server,
  Settings,
  LogOut,
} from 'lucide-react';

export function IpAccessSidebar() {
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
          <Link
            to="/dashboard"
            className="flex items-center gap-3 px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-[#0E1726] transition-colors"
          >
            <LayoutDashboard className="w-4 h-4 text-slate-400" />
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

          {/* Active Link: IP & Access Control */}
          <Link
            to="/ip-access"
            className="flex items-center gap-3 px-3 py-2 text-xs font-semibold text-emerald-400 bg-emerald-950/30 border-l-2 border-emerald-400 transition-colors"
          >
            <Globe2 className="w-4 h-4 text-emerald-400" />
            <span>IP & Access Control</span>
          </Link>

          <Link
            to="/rate-limits"
            className="flex items-center gap-3 px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-[#0E1726] transition-colors"
          >
            <Activity className="w-4 h-4 text-slate-400" />
            <span>Rate Limiting</span>
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

      {/* Sidebar Footer with Admin and Logout */}
      <div className="border-t border-[#152030] p-3 space-y-2">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <div className="w-7 h-7 bg-[#152030] border border-[#233550] flex items-center justify-center text-white text-[11px] font-mono font-bold">
            A
          </div>
          <div className="min-w-0">
            <div className="text-xs font-mono font-bold text-white truncate">admin</div>
            <div className="text-[10px] text-slate-500 font-mono">Administrator</div>
          </div>
        </div>

        <Link
          to="/login"
          className="flex items-center gap-2.5 px-2 py-1.5 text-xs text-slate-400 hover:text-rose-400 hover:bg-[#152030] transition-colors font-mono"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Logout</span>
        </Link>
      </div>
    </aside>
  );
}
