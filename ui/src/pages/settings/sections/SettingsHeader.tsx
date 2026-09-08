import React from 'react';

export type SettingsTab =
  | 'Dependencies'
  | 'General'
  | 'Security'
  | 'Notifications'
  | 'Integrations'
  | 'Logging'
  | 'Backup & Restore';

interface SettingsHeaderProps {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}

export function SettingsHeader({ activeTab, onTabChange }: SettingsHeaderProps) {
  const tabs: SettingsTab[] = [
    'General',
    'Dependencies',
    'Security',
    'Notifications',
    'Integrations',
    'Logging',
    'Backup & Restore',
  ];

  return (
    <div className="space-y-4">
      {/* Title & Description */}
      <div>
        <h1 className="text-xl font-semibold text-foreground tracking-tight">
          Settings
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Configure system settings, integrations and cluster preferences.
        </p>
      </div>

      {/* Tabs Navigation */}
      <div className="flex border-b border-border bg-muted/30 text-xs overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => onTabChange(tab)}
            className={`px-5 py-2.5 transition-colors whitespace-nowrap cursor-pointer ${activeTab === tab
                ? 'text-primary border-b-2 border-primary font-semibold bg-card'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
          >
            {tab}
          </button>
        ))}
      </div>
    </div>
  );
}
