import React, { useEffect, useState } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { ConsoleSidebar } from '../components/ConsoleSidebar';
import { ConsoleHeader } from '../components/ConsoleHeader';
import { getAuthToken, getAuthUser, api } from '../lib/fetcher';

export function ConsoleLayout() {
  const [checking, setChecking] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(true);
  const location = useLocation();

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
    <div className="flex h-screen bg-[#070B12] text-slate-200 overflow-hidden font-sans select-none">
      {/* Sidebar Navigation */}
      <ConsoleSidebar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Navbar / Header */}
        <ConsoleHeader />

        {/* Scrollable Page Outlet */}
        <div className="flex-1 overflow-y-auto no-scrollbar">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export default ConsoleLayout;
