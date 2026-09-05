import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { PoliciesStats } from './sections/PoliciesStats';
import { PoliciesTable, PolicyItem } from './sections/PoliciesTable';
import { PolicyDetail } from './sections/PolicyDetail';

const initialPolicies: PolicyItem[] = [
  {
    id: '1',
    name: 'Default Web Policy',
    scope: 'example.com',
    mode: 'Mixed',
    ruleSetsCount: 8,
    lastUpdated: '2026-08-28 14:21 UTC',
    status: 'Active',
    description: 'Standard security rules for general web traffic.',
    priority: 'Medium',
    ruleGroups: [
      'SQL Injection',
      'XSS',
      'Path Traversal',
      'Bad Bot Protection',
      'Rate Limiting',
    ],
  },
  {
    id: '2',
    name: 'Public API Policy',
    scope: 'api.example.com',
    mode: 'Block',
    ruleSetsCount: 6,
    lastUpdated: '2026-08-30 19:03 UTC',
    status: 'Active',
    description: 'Strict enforcement for public customer-facing APIs.',
    priority: 'High',
    ruleGroups: [
      'SQL Injection',
      'Command Injection',
      'Rate Limiting',
      'Sensitive Endpoint Protection',
    ],
  },
  {
    id: '3',
    name: 'Admin Console Strict',
    scope: 'admin.aurora.local',
    mode: 'Block',
    ruleSetsCount: 10,
    lastUpdated: '2026-09-05 07:42 UTC',
    status: 'Active',
    description: 'High security policy for administrative interfaces.',
    priority: 'High',
    ruleGroups: [
      'SQL Injection',
      'XSS',
      'Path Traversal',
      'Command Injection',
      'Bad Bot Protection',
      'Rate Limiting',
      'Sensitive Endpoint Protection',
    ],
  },
  {
    id: '4',
    name: 'Staging Observation Mode',
    scope: 'staging.example.com',
    mode: 'Detect',
    ruleSetsCount: 6,
    lastUpdated: '2026-08-26 11:18 UTC',
    status: 'Active',
    description: 'Passive audit mode to evaluate rules before production enforcement.',
    priority: 'Low',
    ruleGroups: [
      'SQL Injection',
      'XSS',
      'Path Traversal',
      'Bad Bot Protection',
    ],
  },
  {
    id: '5',
    name: 'Authentication Protection',
    scope: 'auth.example.com',
    mode: 'Block',
    ruleSetsCount: 7,
    lastUpdated: '2026-09-01 16:34 UTC',
    status: 'Draft',
    description: 'Targeted defenses for login and token issuing endpoints.',
    priority: 'High',
    ruleGroups: [
      'Bad Bot Protection',
      'Rate Limiting',
      'Sensitive Endpoint Protection',
    ],
  },
  {
    id: '6',
    name: 'Static Assets Light Policy',
    scope: 'static.example.com',
    mode: 'Detect',
    ruleSetsCount: 4,
    lastUpdated: '2026-08-20 09:12 UTC',
    status: 'Disabled',
    description: 'Lightweight observation policy for static media storage and CDN.',
    priority: 'Low',
    ruleGroups: ['Bad Bot Protection'],
  },
];

export default function PoliciesPage() {
  const [policies] = useState<PolicyItem[]>(initialPolicies);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string>('3');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All Statuses');

  const selectedPolicy =
    policies.find((p) => p.id === selectedPolicyId) || policies[2];

  const filteredPolicies = policies.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.scope.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus =
      statusFilter === 'All Statuses' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="p-6 space-y-4 font-sans selection:bg-emerald-500/30 selection:text-emerald-200">
      {/* Header & Create Policy Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-[#152030]">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white tracking-tight font-sans">
              Policies
            </h1>
            <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-700 uppercase">
              ACTIVE ENFORCEMENT
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5 font-mono">
            Manage WAF policies, assign rule groups, and configure response behaviors.
          </p>
        </div>

        <Link
          to="/policies/create"
          className="bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-semibold px-3.5 py-2 flex items-center gap-1.5 transition-colors cursor-pointer uppercase tracking-wider font-sans w-fit"
        >
          <Plus className="w-4 h-4" />
          <span>Create Policy</span>
        </Link>
      </div>

      {/* 4 Summary Stat Cards Section */}
      <PoliciesStats />

      {/* Table + Details Grid Section */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <PoliciesTable
          policies={filteredPolicies}
          selectedId={selectedPolicyId}
          onSelect={setSelectedPolicyId}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
        />

        <PolicyDetail policy={selectedPolicy} />
      </div>
    </div>
  );
}
