import React, { useEffect, useState } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { ConsoleSidebar } from '../components/ConsoleSidebar';
import { ConsoleHeader } from '../components/ConsoleHeader';
import { getAuthToken, getAuthUser, api } from '../lib/fetcher';

export function ConsoleLayout() {
  const [checking, setChecking] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(true);
  const location = useLocation();

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('aurora_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('aurora_sidebar_collapsed', String(next));
      } catch {
        // ignore storage quota errors
      }
      return next;
    });
  };

  useEffect(() => {
    let isMounted = true;
    const hasLocalSession = getAuthToken() || getAuthUser();
    if (!hasLocalSession) {
      setIsAuthenticated(false);
      return;
    }

    // Verify session with backend (HttpOnly cookie or Authorization header)
    api.get('/api/v1/auth/me')
      .then(() => {
        if (isMounted) {
          setIsAuthenticated(true);
        }
      })
      .catch((err) => {
        if (isMounted && err.status === 401) {
          setIsAuthenticated(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [location.pathname]);

  if (!isAuthenticated && !checking) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden font-sans">
      {/* Sidebar Navigation */}
      <ConsoleSidebar collapsed={sidebarCollapsed} onToggleCollapse={toggleSidebar} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Navbar / Header with sidebar toggle button to the left of search */}
        <ConsoleHeader sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar} />

        {/* Scrollable Page Outlet - Layout centrally governs content width */}
        <main className="flex-1 overflow-y-auto no-scrollbar w-full">
          <div className="w-full min-w-0">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export default ConsoleLayout;
