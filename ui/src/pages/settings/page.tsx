import React, { useState } from 'react';
import { SettingsHeader, type SettingsTab } from './sections/SettingsHeader';
import { GeneralSettingsSection } from './sections/GeneralSettingsSection';
import { SecuritySettingsSection } from './sections/SecuritySettingsSection';
import { NotificationsSettingsSection } from './sections/NotificationsSettingsSection';
import { LoggingSettingsSection } from './sections/LoggingSettingsSection';
import { BackupRestoreSettingsSection } from './sections/BackupRestoreSettingsSection';
import { DangerZoneSection } from './sections/DangerZoneSection';
import { IntegrationsSettingsSection } from './sections/IntegrationsSettingsSection';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('General');

  return (
    <div className="p-6 w-full space-y-6">
      {/* Header & Tabs */}
      <SettingsHeader
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab)}
      />

      {/* Settings Grid Content */}
      {activeTab === 'General' && (
        <div className="space-y-6 w-full">
          <GeneralSettingsSection />
        </div>
      )}

      {activeTab === 'Security' && (
        <div className="space-y-6 w-full">
          <SecuritySettingsSection />
          <DangerZoneSection />
        </div>
      )}

      {activeTab === 'Notifications' && (
        <div className="space-y-6 w-full">
          <NotificationsSettingsSection />
        </div>
      )}

      {activeTab === 'Integrations' && <IntegrationsSettingsSection />}

      {activeTab === 'Cluster' && (
        <div className="p-6 bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#152030] font-mono text-xs space-y-3 shadow-xs w-full">
          <div className="text-sm font-semibold text-slate-900 dark:text-white">Cluster Architecture & High Availability</div>
          <p className="text-slate-500 dark:text-slate-400">
            HA Load Balancer: <code className="px-1.5 py-0.5 bg-slate-100 dark:bg-[#080E18] text-slate-800 dark:text-slate-200">aurora-lb:8090</code>, Data Plane Heartbeat Interval: <code className="px-1.5 py-0.5 bg-slate-100 dark:bg-[#080E18] text-slate-800 dark:text-slate-200">1000ms</code>.
          </p>
          <div className="p-3 bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#1C293D] text-cyan-700 dark:text-cyan-400">
            ● Auto-Registration & Dynamic Rolling Reload: Active
          </div>
        </div>
      )}

      {activeTab === 'Logging' && (
        <div className="space-y-6 w-full">
          <LoggingSettingsSection />
        </div>
      )}

      {activeTab === 'Backup & Restore' && (
        <div className="space-y-6 w-full">
          <BackupRestoreSettingsSection />
          <DangerZoneSection />
        </div>
      )}
    </div>
  );
}
