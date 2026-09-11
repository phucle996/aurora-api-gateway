import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import DashboardPage from './pages/dashboard/page';
import LoginPage from './pages/login/page';
import AnalyticsPage from './pages/analytics/page';
import NodesPage from './pages/nodes/page';
import ExtensionsPage from './pages/extensions/page';
import SettingsPage from './pages/settings/page';
import RoutesPage from './pages/routes/page';
import CertificatesPage from './pages/certificates/page';
import UpstreamsPage from './pages/upstreams/page';
import CreateUpstreamPage from './pages/upstreams/create/page';
import EditUpstreamPage from './pages/upstreams/edit/page';
import ConsoleLayout from './layouts/ConsoleLayout';
import { ThemeProvider } from './components/theme-provider';
import './style.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="aurora_theme">
      <BrowserRouter>
      <Routes>
        {/* Unauthenticated / Standalone Pages */}
        <Route path="/login" element={<LoginPage />} />

        {/* Authenticated Console Layout Routes */}
        <Route element={<ConsoleLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          
          {/* Traffic / Routing & Certificates */}
          <Route path="/routes" element={<RoutesPage />} />
          <Route path="/certificates" element={<CertificatesPage />} />
          <Route path="/domains/*" element={<Navigate to="/routes" replace />} />
          <Route path="/domains" element={<Navigate to="/routes" replace />} />
          <Route path="/create-domain" element={<Navigate to="/routes" replace />} />
          <Route path="/upstreams" element={<UpstreamsPage />} />
          <Route path="/upstreams/create" element={<CreateUpstreamPage />} />
          <Route path="/upstreams/add" element={<CreateUpstreamPage />} />
          <Route path="/upstreams/:id/edit" element={<EditUpstreamPage />} />
          <Route path="/upstreams/edit/:id" element={<EditUpstreamPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/telemetry" element={<AnalyticsPage />} />

          {/* Cluster & Nodes */}
          <Route path="/nodes" element={<NodesPage />} />
          <Route path="/cluster-nodes" element={<NodesPage />} />

          {/* Dynamic Extensions */}
          <Route path="/extensions" element={<ExtensionsPage />} />

          {/* Settings */}
          <Route path="/settings" element={<SettingsPage />} />
        </Route>

        {/* Fallback Redirect */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
    </ThemeProvider>
  </StrictMode>
);
