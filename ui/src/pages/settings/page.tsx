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
        <div className="p-6 bg-card border border-border text-xs space-y-3 shadow-xs w-full">
          <div className="text-sm font-semibold text-foreground">Cluster Architecture & High Availability</div>
          <p className="text-muted-foreground">
            HA Load Balancer: <code className="px-1.5 py-0.5 bg-muted text-foreground">aurora-lb:8090</code>, Data Plane Heartbeat Interval: <code className="px-1.5 py-0.5 bg-muted text-foreground">1000ms</code>.
          </p>
          <div className="p-3 bg-muted/40 border border-border text-cyan-700 dark:text-cyan-400">
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
