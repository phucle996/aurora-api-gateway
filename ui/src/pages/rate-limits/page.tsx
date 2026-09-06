import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { RateLimitsStats } from './sections/RateLimitsStats';
import { RateLimitsCharts } from './sections/RateLimitsCharts';
import { RateLimitsTable, RateLimitRuleItem } from './sections/RateLimitsTable';

const initialRateLimitRules: RateLimitRuleItem[] = [
  {
    id: '1',
    name: 'Login Protection',
    type: 'Request',
    key: 'IP',
    limit: 10,
    window: '1 minute',
    action: 'BLOCK',
    scope: 'Path: /api/login',
    status: 'Active',
    description: 'Prevent brute force login',
  },
  {
    id: '2',
    name: 'API Request Limit',
    type: 'Request',
    key: 'IP',
    limit: 100,
    window: '1 minute',
    action: 'RATE LIMIT',
    scope: 'Path: /api/',
    status: 'Active',
    description: 'General API rate limit',
  },
  {
    id: '3',
    name: 'Registration Limit',
    type: 'Request',
    key: 'IP',
    limit: 5,
    window: '1 hour',
    action: 'BLOCK',
    scope: 'Path: /api/register',
    status: 'Active',
    description: 'Prevent mass registration',
  },
  {
    id: '4',
    name: 'Search Protection',
    type: 'Request',
    key: 'IP',
    limit: 60,
    window: '1 minute',
    action: 'RATE LIMIT',
    scope: 'Path: /api/search',
    status: 'Active',
    description: 'Prevent search abuse',
  },
  {
    id: '5',
    name: 'Upload Limit',
    type: 'Request',
    key: 'IP',
    limit: 20,
    window: '5 minutes',
    action: 'BLOCK',
    scope: 'Path: /api/upload',
    status: 'Active',
    description: 'Limit file upload requests',
  },
  {
    id: '6',
    name: 'Global API Limit',
    type: 'Request',
    key: 'IP',
    limit: 500,
    window: '1 minute',
    action: 'RATE LIMIT',
    scope: 'Global',
    status: 'Active',
    description: 'Global API protection',
  },
  {
    id: '7',
    name: 'GraphQL Limit',
    type: 'Request',
    key: 'IP',
    limit: 100,
    window: '1 minute',
    action: 'RATE LIMIT',
    scope: 'Path: /graphql',
    status: 'Active',
    description: 'Protect GraphQL endpoint',
  },
];

export default function RateLimitsPage() {
  const [rules] = useState<RateLimitRuleItem[]>(initialRateLimitRules);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All Status');
  const [typeFilter, setTypeFilter] = useState('All Types');
  const [hostFilter, setHostFilter] = useState('All Hosts');

  const filteredRules = rules.filter((rule) => {
    const matchesSearch =
      rule.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rule.scope.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rule.description.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus =
      statusFilter === 'All Status' || rule.status === statusFilter;

    const matchesType =
      typeFilter === 'All Types' || rule.type === typeFilter;

    return matchesSearch && matchesStatus && matchesType;
  });

  const handleResetFilters = () => {
    setSearchQuery('');
    setStatusFilter('All Status');
    setTypeFilter('All Types');
    setHostFilter('All Hosts');
  };

  return (
    <div className="p-6 w-full space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-foreground tracking-tight font-sans">
              Rate Limiting
            </h1>
            <span className="px-2 py-0.5 text-[10px] font-sans font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 uppercase rounded-xs">
              ACTIVE THROTTLING
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 font-sans">
            Configure and manage rate limiting rules to protect your services from abuse and overuse.
          </p>
        </div>

        <Link
          to="/rate-limits/create"
          className="bg-primary hover:bg-primary/90 active:bg-primary/80 text-primary-foreground text-xs font-semibold px-3.5 py-2 flex items-center gap-1.5 transition-colors cursor-pointer uppercase tracking-wider font-sans w-fit rounded-sm shadow-xs"
        >
          <Plus className="w-4 h-4" />
          <span>Create Rate Limit Rule</span>
        </Link>
      </div>

      {/* 4 Summary Stat Cards Section */}
      <RateLimitsStats />

      {/* Analytics Charts Section */}
      <RateLimitsCharts />

      {/* Rate Limits Table */}
      <RateLimitsTable
        rules={filteredRules}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        hostFilter={hostFilter}
        onHostFilterChange={setHostFilter}
        onResetFilters={handleResetFilters}
      />
    </div>
  );
}
