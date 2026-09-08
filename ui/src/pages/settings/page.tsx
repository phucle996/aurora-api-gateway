import { DependenciesSettingsSection } from './sections/DependenciesSettingsSection';
import React, { useState } from 'react';
import { SettingsHeader, type SettingsTab } from './sections/SettingsHeader';
import { GeneralSettingsSection } from './sections/GeneralSettingsSection';
import { SecuritySettingsSection } from './sections/SecuritySettingsSection';
import { NotificationsSettingsSection } from './sections/NotificationsSettingsSection';
import { LoggingSettingsSection } from './sections/LoggingSettingsSection';
import { BackupRestoreSettingsSection } from './sections/BackupRestoreSettingsSection';
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
        </div>
      )}

      {activeTab === 'Notifications' && (
        <div className="space-y-6 w-full">
          <NotificationsSettingsSection />
        </div>
      )}

      {activeTab === 'Dependencies' && <DependenciesSettingsSection />}

      {activeTab === 'Integrations' && <IntegrationsSettingsSection />}

      {activeTab === 'Logging' && (
        <div className="space-y-6 w-full">
          <LoggingSettingsSection />
        </div>
      )}

      {activeTab === 'Backup & Restore' && (
        <div className="space-y-6 w-full">
          <BackupRestoreSettingsSection />
        </div>
      )}
    </div>
  );
}
