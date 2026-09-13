import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import DashboardPage from './pages/dashboard/page';
import LoginPage from './pages/login/page';
import AnalyticsPage from './pages/analytics/page';
import ExtensionsPage from './pages/extensions/page';
import SettingsPage from './pages/settings/page';
import RoutesPage from './pages/routes/page';
import CertificatesPage from './pages/certificates/page';
import UpstreamsPage from './pages/upstreams/page';
import CreateUpstreamPage from './pages/upstreams/create/page';
import EditUpstreamPage from './pages/upstreams/edit/page';
import L4GatewayPage from './pages/l4/page';
import CreateL4ServicePage from './pages/l4/create/page';
import EditL4ServicePage from './pages/l4/edit/page';
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
          <Route path="/l4" element={<L4GatewayPage />} />
          <Route path="/l4/create" element={<CreateL4ServicePage />} />
          <Route path="/l4/add" element={<CreateL4ServicePage />} />
          <Route path="/l4/:id/edit" element={<EditL4ServicePage />} />
          <Route path="/l4/edit/:id" element={<EditL4ServicePage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />

          <Route path="/telemetry" element={<AnalyticsPage />} />

          {/* Cluster / Nodes deprecated -> redirect to Dashboard */}
          <Route path="/nodes" element={<Navigate to="/dashboard" replace />} />
          <Route path="/cluster-nodes" element={<Navigate to="/dashboard" replace />} />

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
