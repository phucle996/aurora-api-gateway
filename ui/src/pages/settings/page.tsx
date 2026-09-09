import React, { useState } from 'react';
import { SettingsHeader, type SettingsTab } from './components/SettingsHeader';
import { GeneralTab } from './tabs/general/GeneralTab';
import { ModuleStoreTab } from './tabs/module-store/ModuleStoreTab';
import { SecurityTab } from './tabs/security/SecurityTab';
import { NotificationsTab } from './tabs/notifications/NotificationsTab';
import { IntegrationsTab } from './tabs/integrations/IntegrationsTab';
import { LoggingTab } from './tabs/logging/LoggingTab';
import { BackupRestoreTab } from './tabs/backup-restore/BackupRestoreTab';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('General');

  return (
    <div className="p-6 w-full space-y-6">
      {/* Header & Tabs */}
      <SettingsHeader
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab)}
      />

      {/* Tab Contents */}
      {activeTab === 'General' && <GeneralTab />}
      {activeTab === 'Dependencies' && <ModuleStoreTab />}
      {activeTab === 'Security' && <SecurityTab />}
      {activeTab === 'Notifications' && <NotificationsTab />}
      {activeTab === 'Integrations' && <IntegrationsTab />}
      {activeTab === 'Logging' && <LoggingTab />}
      {activeTab === 'Backup & Restore' && <BackupRestoreTab />}
    </div>
  );
}
