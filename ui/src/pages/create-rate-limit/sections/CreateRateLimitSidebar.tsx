import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import logoImg from '../../../assets/image.png';
import {
  LayoutDashboard,
  ShieldAlert,
  Shield,
  Layers,
  GlobeLock,
  Gauge,
  Server,
  Settings,
  LogOut,
} from 'lucide-react';

export function CreateRateLimitSidebar() {
  const location = useLocation();

  const navItems = [
    { label: 'Dashboard', path: '/dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
    { label: 'Security Events', path: '/events', icon: <ShieldAlert className="w-4 h-4" /> },
    { label: 'Rules', path: '/rules', icon: <Shield className="w-4 h-4" /> },
    { label: 'Policies', path: '/policies', icon: <Layers className="w-4 h-4" /> },
    { label: 'IP & Access Control', path: '/ip-access', icon: <GlobeLock className="w-4 h-4" /> },
    { label: 'Rate Limiting', path: '/rate-limits', icon: <Gauge className="w-4 h-4" />, active: true },
    { label: 'NGINX / Nodes', path: '/nodes', icon: <Server className="w-4 h-4" /> },
    { label: 'Settings', path: '/settings', icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <aside className="w-60 bg-[#080E18] border-r border-[#152030] flex flex-col justify-between shrink-0 font-mono select-none">
      <div>
        {/* Brand Header */}
        <div className="h-14 flex items-center px-4 border-b border-[#152030] gap-2.5">
          <img src={logoImg} alt="Aurora Logo" className="w-7 h-7 object-contain" />
          <div className="flex flex-col">
            <span className="font-bold text-white text-sm tracking-wider uppercase">
              Aurora WAF
            </span>
            <span className="text-[10px] text-slate-400 font-mono tracking-tight">
              Cloud Console
            </span>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="p-2 space-y-1">
          {navItems.map((item) => {
            const isActive = item.active || location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.label}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2 text-xs transition-colors ${
                  isActive
                    ? 'bg-[#152030] text-cyan-400 border-l-2 border-cyan-400 font-semibold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-[#0E1726]'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* User Footer */}
      <div className="p-3 border-t border-[#152030] bg-[#060A10] space-y-2">
        <div className="flex items-center gap-2.5 px-2 py-1">
          <div className="w-7 h-7 bg-blue-900/60 border border-blue-700/50 flex items-center justify-center text-cyan-300 text-xs font-bold">
            A
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs text-white font-medium truncate">admin</span>
            <span className="text-[10px] text-slate-400 truncate">Administrator</span>
          </div>
        </div>

        <Link
          to="/login"
          className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-400 hover:text-rose-400 hover:bg-rose-950/20 transition-colors w-full"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Logout</span>
        </Link>
      </div>
    </aside>
  );
}
