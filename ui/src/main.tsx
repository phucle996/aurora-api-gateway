import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import DashboardPage from './pages/dashboard/page';
import LoginPage from './pages/login/page';
import PoliciesPage from './pages/policies/page';
import CreatePolicyPage from './pages/create-policy/page';
import RulesPage from './pages/rules/page';
import CreateRulePage from './pages/create-rule/page';
import EditRulePage from './pages/edit-rule/page';
import RuleHistoryPage from './pages/rule-history/page';
import CreateIpRulePage from './pages/create-ip-rule/page';
import CreateRateLimitPage from './pages/create-rate-limit/page';
import SecurityEventsPage from './pages/events/page';
import IpAccessPage from './pages/ip-access/page';
import DatasetEntriesPage from './pages/dataset-entries/page';
import AddDatasetPage from './pages/add-dataset/page';
import RateLimitsPage from './pages/rate-limits/page';
import NodesPage from './pages/nodes/page';
import SettingsPage from './pages/settings/page';
import DomainsPage from './pages/domains/page';
import CreateDomainPage from './pages/create-domain/page';
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
          <Route path="/domains" element={<DomainsPage />} />
          <Route path="/domains/create" element={<CreateDomainPage />} />
          <Route path="/domains/add" element={<CreateDomainPage />} />
          <Route path="/create-domain" element={<CreateDomainPage />} />
          <Route path="/events" element={<SecurityEventsPage />} />

          {/* Rules Management */}
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/rules/create" element={<CreateRulePage />} />
          <Route path="/create-rule" element={<CreateRulePage />} />
          <Route path="/rules/:id/edit" element={<EditRulePage />} />
          <Route path="/rules/edit/:id" element={<EditRulePage />} />
          <Route path="/rules/edit" element={<EditRulePage />} />
          <Route path="/edit-rule" element={<EditRulePage />} />
          <Route path="/rules/history" element={<RuleHistoryPage />} />
          <Route path="/rules/:id/history" element={<RuleHistoryPage />} />
          <Route path="/rules/history/:id" element={<RuleHistoryPage />} />
          <Route path="/rule-history" element={<RuleHistoryPage />} />

          {/* Policies */}
          <Route path="/policies" element={<PoliciesPage />} />
          <Route path="/policies/create" element={<CreatePolicyPage />} />
          <Route path="/create-policy" element={<CreatePolicyPage />} />

          {/* IP & Access Control */}
          <Route path="/ip-access" element={<IpAccessPage />} />
          <Route path="/access-control" element={<IpAccessPage />} />
          <Route path="/ip-access/create" element={<CreateIpRulePage />} />
          <Route path="/access-control/create" element={<CreateIpRulePage />} />
          <Route path="/ip-access/add" element={<CreateIpRulePage />} />
          <Route path="/ip-access/datasets/new" element={<AddDatasetPage />} />
          <Route path="/ip-access/datasets/:id" element={<DatasetEntriesPage />} />
          <Route path="/ip-access/dataset/:id" element={<DatasetEntriesPage />} />
          <Route path="/access-control/datasets/:id" element={<DatasetEntriesPage />} />

          {/* Rate Limiting */}
          <Route path="/rate-limits" element={<RateLimitsPage />} />
          <Route path="/rate-limiting" element={<RateLimitsPage />} />
          <Route path="/rate-limits/create" element={<CreateRateLimitPage />} />
          <Route path="/rate-limiting/create" element={<CreateRateLimitPage />} />
          <Route path="/rate-limits/add" element={<CreateRateLimitPage />} />

          {/* Cluster & Nodes */}
          <Route path="/nodes" element={<NodesPage />} />
          <Route path="/cluster-nodes" element={<NodesPage />} />

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




