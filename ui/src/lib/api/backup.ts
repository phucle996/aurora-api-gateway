import { api } from '../fetcher';

export interface BackupConfig {
  auto_backup_enabled: boolean;
  cron_expression: string;
  s3_enabled: boolean;
  s3_endpoint: string;
  s3_bucket: string;
  s3_region: string;
  s3_access_key: string;
  s3_secret_key: string;
  s3_prefix: string;
  s3_retention_days: number;
  last_backup_at: string;
  last_backup_status: string;
  last_backup_destination: string;
  updated_at: string;
}

export interface BackupHistoryItem {
  id: string;
  filename: string;
  destination: 'local' | 's3';
  size_bytes: number;
  status: 'success' | 'failed';
  error_message: string;
  created_at: string;
}

export interface BackupOverview {
  config: BackupConfig;
  history: BackupHistoryItem[];
}

export interface RestoreResult {
  success: boolean;
  message: string;
  restored_tables: number;
}

export const backupApi = {
  getOverview: () => api.get<BackupOverview>('/api/v1/settings/backup'),
  updateConfig: (cfg: Partial<BackupConfig>) =>
    api.put<{ message: string }>('/api/v1/settings/backup/config', cfg),
  triggerS3Backup: () =>
    api.post<BackupHistoryItem>('/api/v1/settings/backup/s3/upload', {}),
  restoreSnapshot: async (file: File): Promise<RestoreResult> => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<RestoreResult>('/api/v1/settings/backup/restore', formData);
  },
  getDownloadUrl: () => '/api/v1/settings/backup/download',
};
