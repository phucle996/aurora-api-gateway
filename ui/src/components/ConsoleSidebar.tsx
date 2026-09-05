import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import logoImg from '../assets/image.png';
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
import { logout, getAuthUser } from '../lib/fetcher';

export function ConsoleSidebar() {
  const user = getAuthUser();
  const location = useLocation();
  const currentPath = location.pathname;

  const isNavActive = (path: string, aliases: string[] = []) => {
    if (path === '/dashboard') {
      return currentPath === '/' || currentPath === '/dashboard';
    }
    if (currentPath.startsWith(path)) {
      return true;
    }
    return aliases.some((alias) => currentPath.startsWith(alias));
  };

  const navItems = [
    {
      label: 'Dashboard',
      path: '/dashboard',
      aliases: ['/'],
      icon: <LayoutDashboard className="w-4 h-4" />,
    },
    {
      label: 'Security Events',
      path: '/events',
      aliases: [],
      icon: <ShieldAlert className="w-4 h-4" />,
    },
    {
      label: 'Rules',
      path: '/rules',
      aliases: ['/create-rule', '/edit-rule'],
      icon: <Shield className="w-4 h-4" />,
    },
    {
      label: 'Policies',
      path: '/policies',
      aliases: ['/create-policy'],
      icon: <Layers className="w-4 h-4" />,
    },
    {
      label: 'IP & Access Control',
      path: '/ip-access',
      aliases: ['/access-control'],
      icon: <GlobeLock className="w-4 h-4" />,
    },
    {
      label: 'Rate Limiting',
      path: '/rate-limits',
      aliases: ['/rate-limiting'],
      icon: <Gauge className="w-4 h-4" />,
    },
    {
      label: 'NGINX / Nodes',
      path: '/nodes',
      aliases: ['/cluster-nodes'],
      icon: <Server className="w-4 h-4" />,
    },
    {
      label: 'Settings',
      path: '/settings',
      aliases: [],
      icon: <Settings className="w-4 h-4" />,
    },
  ];

  return (
    <aside className="w-60 bg-white dark:bg-[#080E18] border-r border-slate-200 dark:border-[#152030] flex flex-col justify-between shrink-0 font-mono select-none h-full min-h-screen">
      <div>
        {/* Brand Header */}
        <Link
          to="/dashboard"
          className="h-14 flex items-center px-4 border-b border-slate-200 dark:border-[#152030] gap-2.5 hover:bg-slate-50 dark:hover:bg-[#0E1726]/50 transition-colors"
        >
          <img src={logoImg} alt="Aurora Logo" className="w-7 h-7 object-contain" />
          <div className="flex flex-col min-w-0">
            <span className="font-bold text-slate-900 dark:text-white text-sm tracking-wider uppercase">
              Aurora WAF
            </span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono tracking-tight">
              Cloud Console
            </span>
          </div>
        </Link>

        {/* Navigation Items */}
        <nav className="p-2 space-y-1">
          {navItems.map((item) => {
            const active = isNavActive(item.path, item.aliases);
            return (
              <Link
                key={item.label}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2 text-xs transition-colors cursor-pointer ${
                  active
                    ? 'bg-cyan-50 text-cyan-700 border-l-2 border-cyan-600 font-semibold dark:bg-[#152030] dark:text-cyan-400 dark:border-cyan-400'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-[#0E1726]'
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
      <div className="p-3 border-t border-slate-200 dark:border-[#152030] bg-slate-50 dark:bg-[#060A10] space-y-2">
        <Link
          to="/settings"
          className="flex items-center gap-2.5 px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-[#0E1726] transition-colors"
        >
          <div className="w-7 h-7 bg-blue-100 dark:bg-blue-900/60 border border-blue-300 dark:border-blue-700/50 flex items-center justify-center text-blue-700 dark:text-cyan-300 text-xs font-bold shrink-0 uppercase">
            {(user?.username || 'A')[0]}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs text-slate-900 dark:text-white font-medium truncate">{user?.username || 'admin'}</span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate capitalize">{user?.role || 'Administrator'}</span>
          </div>
        </Link>

        <button
          type="button"
          onClick={() => logout()}
          className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-600 hover:text-rose-600 hover:bg-rose-50 dark:text-slate-400 dark:hover:text-rose-400 dark:hover:bg-rose-950/20 transition-colors w-full text-left cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}

export default ConsoleSidebar;
