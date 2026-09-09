import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import logoImg from '../assets/logo.png';
import {
  LayoutDashboard,
  Globe,
  ShieldAlert,
  Shield,
  Layers,
  GlobeLock,
  Gauge,
  Server,
  Settings,
  Blocks,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { logout, getAuthUser } from '../lib/fetcher';

interface ConsoleSidebarProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function ConsoleSidebar({
  collapsed: controlledCollapsed,
  onToggleCollapse,
}: ConsoleSidebarProps = {}) {
  const user = getAuthUser();
  const location = useLocation();
  const currentPath = location.pathname;

  const [internalCollapsed, setInternalCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('aurora_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const collapsed = controlledCollapsed !== undefined ? controlledCollapsed : internalCollapsed;

  const toggleCollapsed = () => {
    if (onToggleCollapse) {
      onToggleCollapse();
    } else {
      setInternalCollapsed((prev) => {
        const next = !prev;
        try {
          localStorage.setItem('aurora_sidebar_collapsed', String(next));
        } catch {
          // ignore storage quota errors
        }
        return next;
      });
    }
  };

  // Keyboard shortcut: Ctrl + B or Cmd + B to toggle sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
      icon: <LayoutDashboard className="w-4 h-4 shrink-0" />,
    },
    {
      label: 'Domains',
      path: '/domains',
      aliases: ['/domains/create', '/domains/add'],
      icon: <Globe className="w-4 h-4 shrink-0" />,
    },
    {
      label: 'Upstreams',
      path: '/upstreams',
      aliases: ['/upstreams/create', '/upstreams/add'],
      icon: <Server className="w-4 h-4 shrink-0" />,
    },
    {
      label: 'Security Events',
      path: '/events',
      aliases: [],
      icon: <ShieldAlert className="w-4 h-4 shrink-0" />,
    },
    {
      label: 'Rules',
      path: '/rules',
      aliases: ['/create-rule', '/edit-rule'],
      icon: <Shield className="w-4 h-4 shrink-0" />,
    },
    {
      label: 'Policies',
      path: '/policies',
      aliases: ['/create-policy', '/policies/create'],
      icon: <Layers className="w-4 h-4 shrink-0" />,
    },
    {
      label: 'IP & Access Control',
      path: '/ip-access',
      aliases: ['/access-control'],
      icon: <GlobeLock className="w-4 h-4 shrink-0" />,
    },
    {
      label: 'Rate Limiting',
      path: '/rate-limits',
      aliases: ['/rate-limiting'],
      icon: <Gauge className="w-4 h-4 shrink-0" />,
    },
    {
      label: 'NGINX / Nodes',
      path: '/nodes',
      aliases: ['/cluster-nodes'],
      icon: <Server className="w-4 h-4 shrink-0" />,
    },
    {
      label: 'Extensions',
      path: '/extensions',
      aliases: ['/extensions/'],
      icon: <Blocks className="w-4 h-4 shrink-0" />,
    },
    {
      label: 'Settings',
      path: '/settings',
      aliases: [],
      icon: <Settings className="w-4 h-4 shrink-0" />,
    },
  ];

  return (
    <aside
      className={`bg-card border-r border-border flex flex-col justify-between shrink-0 font-sans select-none h-full min-h-screen transition-all duration-300 ease-in-out ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      <div>
        {/* Brand Header */}
        <div className="h-14 flex items-center px-3 border-b border-border overflow-hidden">
          <Link
            to="/dashboard"
            className={`flex items-center gap-2.5 transition-colors min-w-0 ${
              collapsed ? 'w-full justify-center' : ''
            }`}
            title="Aurora WAF Cloud Console"
          >
            <img src={logoImg} alt="Aurora Logo" className="w-8 h-8 object-contain shrink-0" />
            {!collapsed && (
              <div className="flex flex-col min-w-0">
                <span className="font-bold text-foreground text-sm tracking-wider uppercase truncate">
                  Aurora WAF
                </span>
                <span className="text-[10px] text-muted-foreground font-sans tracking-wide uppercase truncate">
                  Cloud Console
                </span>
              </div>
            )}
          </Link>
        </div>

        {/* Navigation Items */}
        <nav className="p-2 space-y-1">
          {navItems.map((item) => {
            const active = isNavActive(item.path, item.aliases);
            return (
              <Link
                key={item.label}
                to={item.path}
                title={item.label}
                className={`flex items-center text-xs transition-colors cursor-pointer rounded-xs ${
                  collapsed
                    ? 'justify-center px-0 py-2.5'
                    : 'gap-3 px-3 py-2'
                } ${
                  active
                    ? 'bg-primary/10 text-primary border-l-2 border-primary font-semibold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                }`}
              >
                {item.icon}
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* User Footer */}
      <div className={`border-t border-border bg-muted/20 ${
        collapsed ? 'p-2 space-y-2' : 'p-3 space-y-2'
      }`}>
        <Link
          to="/settings"
          title={`${user?.username || 'admin'} (${user?.role || 'Administrator'})`}
          className={`flex items-center hover:bg-muted transition-colors rounded-sm ${
            collapsed ? 'justify-center p-1.5' : 'gap-2.5 px-2 py-1.5'
          }`}
        >
          <div className="w-7 h-7 bg-primary/15 border border-primary/30 flex items-center justify-center text-primary text-xs font-bold shrink-0 uppercase rounded-sm">
            {(user?.username || 'A')[0]}
          </div>
          {!collapsed && (
            <div className="flex flex-col min-w-0">
              <span className="text-xs text-foreground font-medium truncate">{user?.username || 'admin'}</span>
              <span className="text-[10px] text-muted-foreground truncate capitalize">{user?.role || 'Administrator'}</span>
            </div>
          )}
        </Link>

        <button
          type="button"
          onClick={() => logout()}
          title="Logout"
          className={`flex items-center text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer rounded-sm ${
            collapsed ? 'justify-center p-1.5 w-full' : 'gap-2 px-2 py-1.5 w-full text-left'
          }`}
        >
          <LogOut className="w-3.5 h-3.5 shrink-0" />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </aside>
  );
}

export default ConsoleSidebar;

