import React from 'react';

export type SettingsTab =
  | 'General'
  | 'Security'
  | 'Notifications'
  | 'Integrations'
  | 'Cluster'
  | 'Logging'
  | 'Backup & Restore';

interface SettingsHeaderProps {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}

export function SettingsHeader({ activeTab, onTabChange }: SettingsHeaderProps) {
  const tabs: SettingsTab[] = [
    'General',
    'Security',
    'Notifications',
    'Integrations',
    'Cluster',
    'Logging',
    'Backup & Restore',
  ];

  return (
    <div className="space-y-4">
      {/* Title & Description */}
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white tracking-tight">
          Settings
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">
          Configure system settings, integrations and cluster preferences.
        </p>
      </div>

      {/* Tabs Navigation */}
      <div className="flex border-b border-slate-200 dark:border-[#152030] bg-slate-100 dark:bg-[#080E18] text-xs font-mono overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => onTabChange(tab)}
            className={`px-5 py-2.5 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === tab
                ? 'text-emerald-700 dark:text-emerald-400 border-b-2 border-emerald-600 dark:border-emerald-400 font-semibold bg-white dark:bg-[#0B1320]'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-[#0E1726]'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>
    </div>
  );
}
