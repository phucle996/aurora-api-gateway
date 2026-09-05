import React, { useState } from 'react';
import { SettingsHeader, type SettingsTab } from './sections/SettingsHeader';
import { GeneralSettingsSection } from './sections/GeneralSettingsSection';
import { SecuritySettingsSection } from './sections/SecuritySettingsSection';
import { NotificationsSettingsSection } from './sections/NotificationsSettingsSection';
import { LoggingSettingsSection } from './sections/LoggingSettingsSection';
import { BackupRestoreSettingsSection } from './sections/BackupRestoreSettingsSection';
import { DangerZoneSection } from './sections/DangerZoneSection';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('General');

  return (
    <div className="p-6 space-y-6">
      {/* Header & Tabs */}
      <SettingsHeader
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab)}
      />

      {/* Settings Grid Content */}
      {activeTab === 'General' && (
        <div className="space-y-6">
          <GeneralSettingsSection />
        </div>
      )}

      {activeTab === 'Security' && (
        <div className="space-y-6 max-w-3xl">
          <SecuritySettingsSection />
          <DangerZoneSection />
        </div>
      )}

      {activeTab === 'Notifications' && (
        <div className="space-y-6 max-w-3xl">
          <NotificationsSettingsSection />
        </div>
      )}

      {activeTab === 'Integrations' && (
        <div className="p-6 bg-[#0B1320] border border-[#152030] font-mono text-xs space-y-3">
          <div className="text-sm font-semibold text-white">Cluster Integrations & Webhooks</div>
          <p className="text-slate-400">
            Connect your SIEM, Prometheus exporter, Grafana dashboards, and Kubernetes ingress operators.
          </p>
          <div className="p-3 bg-[#080E18] border border-[#1C293D] text-emerald-400">
            ● Prometheus Metrics Endpoint: <code>http://127.0.0.1:8080/metrics</code> (Enabled)
          </div>
        </div>
      )}

      {activeTab === 'Cluster' && (
        <div className="p-6 bg-[#0B1320] border border-[#152030] font-mono text-xs space-y-3">
          <div className="text-sm font-semibold text-white">Raft Consensus & Replication Policy</div>
          <p className="text-slate-400">
            Leader election timeout: <code>1000ms</code>, Heartbeat interval: <code>200ms</code>.
          </p>
          <div className="p-3 bg-[#080E18] border border-[#1C293D] text-cyan-400">
            ● Auto-Sync Ruleset on Quorum: Active
          </div>
        </div>
      )}

      {activeTab === 'Logging' && (
        <div className="space-y-6 max-w-3xl">
          <LoggingSettingsSection />
        </div>
      )}

      {activeTab === 'Backup & Restore' && (
        <div className="space-y-6 max-w-3xl">
          <BackupRestoreSettingsSection />
          <DangerZoneSection />
        </div>
      )}
    </div>
  );
}
