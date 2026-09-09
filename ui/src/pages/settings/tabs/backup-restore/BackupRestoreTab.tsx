import React, { useState, useEffect } from 'react';
import {
  Database,
  CheckCircle2,
  AlertCircle,
  X,
  Loader2,
} from 'lucide-react';
import {
  backupApi,
  BackupConfig,
  BackupHistoryItem,
} from '../../../../lib/api';
import { getAuthToken } from '../../../../lib/fetcher';
import { ImmediateBackupSection } from './sections/ImmediateBackupSection';
import { BackupScheduleSection } from './sections/BackupScheduleSection';
import { S3StorageSection } from './sections/S3StorageSection';
import { RestoreDatabaseSection } from './sections/RestoreDatabaseSection';

export function BackupRestoreTab() {
  const [loading, setLoading] = useState(true);
  const [errorBanner, setErrorBanner] = useState('');
  const [successBanner, setSuccessBanner] = useState('');

  // Configuration state
  const [config, setConfig] = useState<BackupConfig>({
    auto_backup_enabled: true,
    cron_expression: '0 2 * * *',
    s3_enabled: false,
    s3_endpoint: '',
    s3_bucket: '',
    s3_region: '',
    s3_access_key: '',
    s3_secret_key: '',
    s3_prefix: '',
    s3_retention_days: 30,
    last_backup_at: '',
    last_backup_status: '',
    last_backup_destination: '',
    updated_at: '',
  });

  const [history, setHistory] = useState<BackupHistoryItem[]>([]);
  const [savingConfig, setSavingConfig] = useState(false);

  // Backup actions state
  const [downloadingLocal, setDownloadingLocal] = useState(false);
  const [pushingS3, setPushingS3] = useState(false);

  // Load overview from backend
  const loadOverview = async () => {
    try {
      setLoading(true);
      setErrorBanner('');
      const data = await backupApi.getOverview();
      if (data.config) {
        setConfig(data.config);
      }
      setHistory(data.history || []);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Không thể tải cấu hình sao lưu từ máy chủ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  // Save Configuration (Cron, S3, Retention)
  const handleSaveConfig = async () => {
    setSavingConfig(true);
    setErrorBanner('');

    try {
      await backupApi.updateConfig(config);
      setSuccessBanner('Đã lưu cấu hình sao lưu và lịch trình Cron thành công');
      setTimeout(() => setSuccessBanner(''), 3000);
      loadOverview();
    } catch (err: any) {
      setErrorBanner(err?.message || 'Không thể lưu cấu hình sao lưu');
    } finally {
      setSavingConfig(false);
    }
  };

  // Local Backup Download Action
  const handleDownloadLocal = async () => {
    setDownloadingLocal(true);
    setErrorBanner('');

    try {
      const token = getAuthToken();
      const response = await fetch(backupApi.getDownloadUrl(), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        throw new Error(`Tải bản sao lưu thất bại (HTTP ${response.status})`);
      }

      const blob = await response.blob();
      const filenameHeader = response.headers.get('Content-Disposition');
      let filename = `aurora-waf-backup-${new Date().toISOString().slice(0, 10)}.db`;
      if (filenameHeader && filenameHeader.includes('filename=')) {
        const match = filenameHeader.match(/filename="?([^";]+)"?/);
        if (match && match[1]) filename = match[1];
      }

      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);

      setSuccessBanner(`Đã xuất và tải thành công bản sao lưu: ${filename}`);
      setTimeout(() => setSuccessBanner(''), 4000);
      loadOverview();
    } catch (err: any) {
      setErrorBanner(err?.message || 'Lỗi xuất file snapshot database');
    } finally {
      setDownloadingLocal(false);
    }
  };

  // Direct Push to S3 Action
  const handlePushS3 = async () => {
    setPushingS3(true);
    setErrorBanner('');

    try {
      const res = await backupApi.triggerS3Backup();
      setSuccessBanner(`Đã tạo snapshot và tải lên S3 thành công: ${res.filename} (${(res.size_bytes / 1024).toFixed(1)} KB)`);
      setTimeout(() => setSuccessBanner(''), 4000);
      loadOverview();
    } catch (err: any) {
      setErrorBanner(err?.message || 'Lỗi đẩy bản sao lưu lên S3 bucket');
    } finally {
      setPushingS3(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center gap-2 text-muted-foreground text-xs bg-card border border-border font-sans">
        <Loader2 className="w-4 h-4 animate-spin text-primary" />
        <span>Đang tải cấu hình sao lưu và khôi phục...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 font-sans">
      {/* Top Banner Alerts */}
      {errorBanner && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-xs rounded flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorBanner('')}
            className="text-destructive/80 hover:text-destructive cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successBanner && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs rounded flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessBanner('')}
            className="hover:opacity-80 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Container */}
      <div className="bg-card border border-border p-4 text-xs space-y-6 shadow-xs">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">
              Backup & Restore
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">
              Cron: {config.cron_expression}
            </span>
            {config.s3_enabled ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-medium">
                S3 Sync Active
              </span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                S3 Disabled
              </span>
            )}
          </div>
        </div>

        {/* 1. Immediate Backup Actions (Local Download & S3 Upload) */}
        <ImmediateBackupSection
          config={config}
          downloadingLocal={downloadingLocal}
          onDownloadLocal={handleDownloadLocal}
          pushingS3={pushingS3}
          onPushS3={handlePushS3}
        />

        {/* 2. Automated Backup Scheduling (Cron Job) */}
        <BackupScheduleSection
          config={config}
          onChange={(updated) => setConfig(updated)}
        />

        {/* 3. Amazon S3 & Compatible Cloud Storage */}
        <S3StorageSection
          config={config}
          onChange={(updated) => setConfig(updated)}
          savingConfig={savingConfig}
          onSaveConfig={handleSaveConfig}
        />

        {/* 4. Restore Database Snapshot (Drag & Drop + Upload) */}
        <RestoreDatabaseSection
          onError={(msg) => setErrorBanner(msg)}
          onSuccess={(msg) => {
            setSuccessBanner(msg);
            setTimeout(() => setSuccessBanner(''), 4000);
          }}
          onRestoreCompleted={loadOverview}
        />
      </div>
    </div>
  );
}
