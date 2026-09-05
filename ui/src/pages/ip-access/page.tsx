import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ChevronDown } from 'lucide-react';
import { IpAccessStats } from './sections/IpAccessStats';
import { IpAccessTable, AccessRuleItem } from './sections/IpAccessTable';

const initialAccessRules: AccessRuleItem[] = [
  {
    id: '1',
    type: 'BLOCK',
    value: '203.0.113.10',
    countryOrAsn: 'US',
    countryFlag: '🇺🇸',
    scope: 'Global',
    reason: 'SQL injection attempts',
    status: 'Active',
  },
  {
    id: '2',
    type: 'ALLOW',
    value: '198.51.100.0/24',
    scope: 'API',
    reason: 'Trusted partner network',
    status: 'Active',
  },
  {
    id: '3',
    type: 'BLOCK',
    value: '45.142.212.0/23',
    countryOrAsn: 'RU',
    countryFlag: '🇷🇺',
    scope: 'Global',
    reason: 'Known malicious network',
    status: 'Active',
  },
  {
    id: '4',
    type: 'TEMP BAN',
    value: '185.220.101.45',
    countryOrAsn: 'DE',
    countryFlag: '🇩🇪',
    scope: 'Global',
    reason: 'Brute force login',
    status: 'Active',
    expiresAt: '2026-06-20 14:30',
  },
  {
    id: '5',
    type: 'ALLOW',
    value: '192.0.2.15',
    scope: 'Admin',
    reason: 'Office IP',
    status: 'Active',
  },
  {
    id: '6',
    type: 'BLOCK',
    value: '2606:4700:4700::1111',
    scope: 'Global',
    reason: 'Bad bot (Cloudflare)',
    status: 'Active',
  },
  {
    id: '7',
    type: 'GEO BLOCK',
    value: 'CN',
    countryOrAsn: 'China',
    countryFlag: '🇨🇳',
    scope: 'Global',
    reason: 'High risk country',
    status: 'Active',
  },
  {
    id: '8',
    type: 'ASN BLOCK',
    value: 'AS14061',
    countryOrAsn: 'DigitalOcean',
    scope: 'Global',
    reason: 'Frequent abuse',
    status: 'Active',
  },
  {
    id: '9',
    type: 'TEMP BAN',
    value: '104.21.16.89',
    countryOrAsn: 'US',
    countryFlag: '🇺🇸',
    scope: 'Login',
    reason: 'Too many requests',
    status: 'Active',
    expiresAt: '2026-06-20 16:10',
  },
  {
    id: '10',
    type: 'ALLOW',
    value: '2001:db8::/32',
    scope: 'Global',
    reason: 'Internal network',
    status: 'Active',
  },
];

export default function IpAccessPage() {
  const [rules] = useState<AccessRuleItem[]>(initialAccessRules);
  const [activeTab, setActiveTab] = useState('All Rules');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('All Types');
  const [statusFilter, setStatusFilter] = useState('All Status');

  const filteredRules = rules.filter((rule) => {
    // Tab filter
    if (activeTab === 'Allowlist' && rule.type !== 'ALLOW') return false;
    if (activeTab === 'Blocklist' && rule.type !== 'BLOCK') return false;
    if (activeTab === 'Temporary Bans' && rule.type !== 'TEMP BAN') return false;
    if (activeTab === 'Geo Rules' && rule.type !== 'GEO BLOCK') return false;
    if (activeTab === 'ASN Rules' && rule.type !== 'ASN BLOCK') return false;

    // Search query
    const matchesSearch =
      rule.value.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rule.reason.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (rule.countryOrAsn &&
        rule.countryOrAsn.toLowerCase().includes(searchQuery.toLowerCase())) ||
      rule.scope.toLowerCase().includes(searchQuery.toLowerCase());

    // Type filter
    const matchesType =
      typeFilter === 'All Types' || rule.type === typeFilter;

    // Status filter
    const matchesStatus =
      statusFilter === 'All Status' || rule.status === statusFilter;

    return matchesSearch && matchesType && matchesStatus;
  });

  const handleResetFilters = () => {
    setSearchQuery('');
    setTypeFilter('All Types');
    setStatusFilter('All Status');
    setActiveTab('All Rules');
  };

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-[#152030]">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white tracking-tight font-sans">
              IP & Access Control
            </h1>
            <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-700 uppercase">
              ACTIVE FIREWALL
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5 font-mono">
            Manage allowlist, blocklist and access rules for your infrastructure.
          </p>
        </div>

        <Link
          to="/ip-access/create"
          className="bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-semibold px-3.5 py-2 flex items-center gap-1.5 transition-colors cursor-pointer uppercase tracking-wider font-sans w-fit"
        >
          <Plus className="w-4 h-4" />
          <span>Add Rule</span>
          <ChevronDown className="w-3.5 h-3.5 opacity-80" />
        </Link>
      </div>

      {/* 4 Summary Stat Cards Section */}
      <IpAccessStats />

      {/* Table Section */}
      <IpAccessTable
        rules={filteredRules}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        onResetFilters={handleResetFilters}
      />
    </div>
  );
}
