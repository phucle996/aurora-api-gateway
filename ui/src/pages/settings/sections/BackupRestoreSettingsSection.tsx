import React, { useState, useEffect, useRef } from 'react';
import {
  Database,
  Download,
  Upload,
  Cloud,
  HardDrive,
  Clock,
  Check,
  CheckCircle2,
  AlertCircle,
  X,
  FileText,
  Trash2,
  Loader2,
  ShieldAlert,
  Sliders,
  Eye,
  EyeOff,
  Calendar,
} from 'lucide-react';
import {
  backupApi,
  BackupConfig,
  BackupHistoryItem,
} from '../../../lib/api';

export function BackupRestoreSettingsSection() {
  const [loading, setLoading] = useState(true);
  const [errorBanner, setErrorBanner] = useState('');
  const [successBanner, setSuccessBanner] = useState('');

  // Configuration state
  const [config, setConfig] = useState<BackupConfig>({
    auto_backup_enabled: true,
    cron_expression: '0 2 * * *',
    s3_enabled: false,
    s3_endpoint: '',
    s3_bucket: 'aurora-waf-backups',
    s3_region: 'ap-southeast-1',
    s3_access_key: '',
    s3_secret_key: '',
    s3_prefix: 'backups/',
    s3_retention_days: 30,
    last_backup_at: '',
    last_backup_status: '',
    last_backup_destination: '',
    updated_at: '',
  });

  const [history, setHistory] = useState<BackupHistoryItem[]>([]);
  const [savingConfig, setSavingConfig] = useState(false);
  const [showSecretKey, setShowSecretKey] = useState(false);

  // Backup actions state
  const [downloadingLocal, setDownloadingLocal] = useState(false);
  const [pushingS3, setPushingS3] = useState(false);

  // Drag & Drop Restore state
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      const token = localStorage.getItem('aurora_auth_token') || sessionStorage.getItem('aurora_auth_token') || '';
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

  // Drag & Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      validateAndSelectFile(file);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      validateAndSelectFile(file);
    }
  };

  const validateAndSelectFile = (file: File) => {
    const validExts = ['.db', '.sqlite', '.sqlite3', '.sql', '.gz', '.tar.gz'];
    const fileName = file.name.toLowerCase();
    const isValid = validExts.some((ext) => fileName.endsWith(ext));

    if (!isValid) {
      setErrorBanner('Định dạng file không hỗ trợ. Vui lòng chọn file database (.db, .sqlite, .sql, .tar.gz)');
      return;
    }

    setSelectedFile(file);
    setConfirmRestore(false);
    setErrorBanner('');
  };

  // Restore Execution Action
  const handleExecuteRestore = async () => {
    if (!selectedFile) return;
    if (!confirmRestore) {
      setErrorBanner('Vui lòng tích xác nhận ghi đè cơ sở dữ liệu trước khi phục hồi.');
      return;
    }

    setRestoring(true);
    setErrorBanner('');

    try {
      const res = await backupApi.restoreSnapshot(selectedFile);
      setSuccessBanner(res.message || 'Phục hồi cơ sở dữ liệu thành công!');
      setSelectedFile(null);
      setConfirmRestore(false);
      loadOverview();
    } catch (err: any) {
      setErrorBanner(err?.message || 'Lỗi phục hồi snapshot database');
    } finally {
      setRestoring(false);
    }
  };

  // Helper for human-readable cron expression description
  const describeCron = (cron: string) => {
    const trimmed = cron.trim();
    if (trimmed === '0 2 * * *') return 'At 02:00 AM UTC every day';
    if (trimmed === '0 */6 * * *') return 'Every 6 hours (00:00, 06:00, 12:00, 18:00 UTC)';
    if (trimmed === '0 0 * * *') return 'Every day at midnight (00:00 UTC)';
    if (trimmed === '0 2 * * 0') return 'At 02:00 AM UTC every Sunday';
    if (trimmed === '0 2 1 * *') return 'At 02:00 AM UTC on the 1st of every month';
    return `Cron Schedule: ${trimmed}`;
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center gap-2 text-muted-foreground text-xs bg-card border border-border">
        <Loader2 className="w-4 h-4 animate-spin text-primary" />
        <span>Đang tải cấu hình sao lưu và khôi phục...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
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

        {/* 1. IMMEDIATE BACKUP ACTIONS (Local Download vs S3 Upload) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">
              Immediate Snapshot Generation & Export
            </span>
            <span className="text-[11px] text-muted-foreground">
              Save snapshot locally or push directly to remote cloud storage
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Card A: Local Backup Download */}
            <div className="p-4 border border-border rounded-lg bg-background flex flex-col justify-between space-y-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-primary" />
                    Download Local Backup
                  </span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded font-medium bg-muted text-muted-foreground font-mono">
                    .db format
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Generates an instant, atomic SQLite database snapshot and downloads the file directly to your workstation.
                </p>
              </div>

              <div className="pt-2 border-t border-border/50 flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">
                  Saved directly to your machine
                </span>
                <button
                  type="button"
                  disabled={downloadingLocal}
                  onClick={handleDownloadLocal}
                  className="px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  {downloadingLocal ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Exporting Snapshot...</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-3.5 h-3.5" />
                      <span>Download File (.db)</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Card B: Push Backup to S3 */}
            <div className="p-4 border border-border rounded-lg bg-background flex flex-col justify-between space-y-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground flex items-center gap-1.5">
                    <Cloud className="w-3.5 h-3.5 text-cyan-500" />
                    Upload Backup to S3
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
                      config.s3_enabled
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {config.s3_enabled ? 'Configured' : 'Optional'}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Immediately captures current cluster state and pushes the snapshot object directly to your configured S3 bucket.
                </p>
              </div>

              <div className="pt-2 border-t border-border/50 flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[200px]">
                  {config.s3_bucket ? `s3://${config.s3_bucket}` : 'Bucket not set'}
                </span>
                <button
                  type="button"
                  disabled={pushingS3}
                  onClick={handlePushS3}
                  className="px-3 py-1.5 rounded bg-muted hover:bg-muted/80 text-foreground border border-border text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  {pushingS3 ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                      <span>Uploading to S3...</span>
                    </>
                  ) : (
                    <>
                      <Cloud className="w-3.5 h-3.5 text-cyan-500" />
                      <span>Backup to S3 Now</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 2. AUTOMATED BACKUP SCHEDULING (CRON JOB) */}
        <div className="pt-2 border-t border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              <span className="text-xs font-semibold text-foreground">
                Automated Backup Scheduling (Cron Job)
              </span>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-[11px] text-muted-foreground">Auto-Backup Scheduler</span>
              <input
                type="checkbox"
                checked={config.auto_backup_enabled}
                onChange={(e) => setConfig({ ...config, auto_backup_enabled: e.target.checked })}
                className="h-4 w-4 rounded border-input text-primary focus:ring-ring cursor-pointer"
              />
            </label>
          </div>

          <div className="p-3.5 border border-border rounded-lg bg-background space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="font-medium text-foreground text-xs flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-primary" />
                  Backup Interval (Cron Expression)
                </label>
                <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-mono">
                  {describeCron(config.cron_expression)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={config.cron_expression}
                  onChange={(e) => setConfig({ ...config, cron_expression: e.target.value })}
                  placeholder="0 2 * * *"
                  className="w-48 bg-card border border-input rounded px-3 py-1.5 text-foreground font-mono text-xs focus:outline-none focus:border-primary"
                />

                <div className="flex items-center gap-1.5 overflow-x-auto text-[11px]">
                  <span className="text-muted-foreground text-[10px]">Presets:</span>
                  <button
                    type="button"
                    onClick={() => setConfig({ ...config, cron_expression: '0 */6 * * *' })}
                    className="px-2 py-0.8 rounded bg-muted hover:bg-muted/80 text-foreground border border-border cursor-pointer"
                  >
                    Every 6h
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfig({ ...config, cron_expression: '0 2 * * *' })}
                    className="px-2 py-0.8 rounded bg-muted hover:bg-muted/80 text-foreground border border-border cursor-pointer"
                  >
                    Daily (02:00)
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfig({ ...config, cron_expression: '0 2 * * 0' })}
                    className="px-2 py-0.8 rounded bg-muted hover:bg-muted/80 text-foreground border border-border cursor-pointer"
                  >
                    Weekly (Sun)
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfig({ ...config, cron_expression: '0 2 1 * *' })}
                    className="px-2 py-0.8 rounded bg-muted hover:bg-muted/80 text-foreground border border-border cursor-pointer"
                  >
                    Monthly (1st)
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Standard 5-field cron syntax: <code>minute hour day-of-month month day-of-week</code>.
              </p>
            </div>
          </div>
        </div>

        {/* 3. S3 STORAGE SETTINGS & S3 RETENTION POLICY */}
        <div className="pt-2 border-t border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cloud className="w-4 h-4 text-cyan-500" />
              <span className="text-xs font-semibold text-foreground">
                Amazon S3 & Compatible Cloud Storage
              </span>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-[11px] text-muted-foreground">Enable Remote S3 Sync</span>
              <input
                type="checkbox"
                checked={config.s3_enabled}
                onChange={(e) => setConfig({ ...config, s3_enabled: e.target.checked })}
                className="h-4 w-4 rounded border-input text-primary focus:ring-ring cursor-pointer"
              />
            </label>
          </div>

          <div className="p-3.5 border border-border rounded-lg bg-background space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="font-medium text-foreground">S3 Endpoint URL (Optional)</label>
                <input
                  type="text"
                  value={config.s3_endpoint}
                  onChange={(e) => setConfig({ ...config, s3_endpoint: e.target.value })}
                  placeholder="https://s3.amazonaws.com (or MinIO/R2)"
                  className="w-full bg-card border border-input rounded px-3 py-1.5 text-foreground font-mono text-[11px] focus:outline-none focus:border-primary"
                />
              </div>

              <div className="space-y-1">
                <label className="font-medium text-foreground">S3 Bucket Name</label>
                <input
                  type="text"
                  value={config.s3_bucket}
                  onChange={(e) => setConfig({ ...config, s3_bucket: e.target.value })}
                  placeholder="aurora-waf-backups"
                  className="w-full bg-card border border-input rounded px-3 py-1.5 text-foreground font-mono text-[11px] focus:outline-none focus:border-primary"
                />
              </div>

              <div className="space-y-1">
                <label className="font-medium text-foreground">Region</label>
                <input
                  type="text"
                  value={config.s3_region}
                  onChange={(e) => setConfig({ ...config, s3_region: e.target.value })}
                  placeholder="ap-southeast-1"
                  className="w-full bg-card border border-input rounded px-3 py-1.5 text-foreground font-mono text-[11px] focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="font-medium text-foreground">Access Key ID</label>
                <input
                  type="text"
                  value={config.s3_access_key}
                  onChange={(e) => setConfig({ ...config, s3_access_key: e.target.value })}
                  placeholder="AKIAIOSFODNN7EXAMPLE"
                  className="w-full bg-card border border-input rounded px-3 py-1.5 text-foreground font-mono text-[11px] focus:outline-none focus:border-primary"
                />
              </div>

              <div className="space-y-1">
                <label className="font-medium text-foreground">Secret Access Key</label>
                <div className="relative">
                  <input
                    type={showSecretKey ? 'text' : 'password'}
                    value={config.s3_secret_key}
                    onChange={(e) => setConfig({ ...config, s3_secret_key: e.target.value })}
                    placeholder="••••••••••••••••••••••••••••••••"
                    className="w-full bg-card border border-input rounded px-3 py-1.5 text-foreground font-mono text-[11px] focus:outline-none focus:border-primary pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecretKey(!showSecretKey)}
                    className="absolute right-2.5 top-2 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    {showSecretKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* S3 Storage Retention Policy */}
              <div className="space-y-1">
                <label className="font-medium text-foreground flex items-center justify-between">
                  <span>S3 Storage Retention Policy</span>
                  <span className="text-[10px] text-primary font-mono">For S3 Only</span>
                </label>
                <select
                  value={config.s3_retention_days}
                  onChange={(e) => setConfig({ ...config, s3_retention_days: parseInt(e.target.value, 10) || 30 })}
                  className="w-full bg-card border border-input rounded px-3 py-1.5 text-foreground text-xs focus:outline-none focus:border-primary cursor-pointer"
                >
                  <option value={7}>7 days retention</option>
                  <option value={14}>14 days retention</option>
                  <option value={30}>30 days retention (Standard)</option>
                  <option value={60}>60 days retention</option>
                  <option value={90}>90 days retention (Quarterly)</option>
                  <option value={180}>180 days retention</option>
                  <option value={365}>365 days retention (Annual)</option>
                </select>
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground pt-1">
              Note: The retention lifecycle policy applies strictly to remote S3 bucket storage. Locally downloaded files are retained permanently on your own computer.
            </p>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                disabled={savingConfig}
                onClick={handleSaveConfig}
                className="px-3.5 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                {savingConfig ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving Settings...</span>
                  </>
                ) : (
                  <span>Save Backup & S3 Settings</span>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* 4. RESTORE DATABASE (DRAG & DROP + UPLOAD) */}
        <div className="pt-2 border-t border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Upload className="w-4 h-4 text-primary" />
              <span className="text-xs font-semibold text-foreground">
                Restore Database Snapshot (Drag & Drop or Upload)
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground">
              Supports .db, .sqlite, .sql, .tar.gz snapshots
            </span>
          </div>

          {/* Hidden native input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".db,.sqlite,.sqlite3,.sql,.gz,.tar.gz"
            onChange={handleFileInputChange}
            className="hidden"
          />

          {/* Dropzone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-all cursor-pointer ${
              dragActive
                ? 'border-primary bg-primary/10 shadow-md scale-[1.01]'
                : selectedFile
                ? 'border-emerald-500/50 bg-emerald-500/5'
                : 'border-border hover:border-primary/50 hover:bg-muted/30 bg-background'
            }`}
          >
            <div className="flex flex-col items-center justify-center space-y-2">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <Upload className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-foreground">
                  Drag & drop your backup database file here, or{' '}
                  <span className="text-primary underline">browse from your computer</span>
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Valid SQLite snapshots (.db, .sqlite) will be inspected for schema integrity before applying.
                </p>
              </div>
            </div>
          </div>

          {/* Selected File Card & Confirmation */}
          {selectedFile && (
            <div className="p-3.5 border border-border rounded-lg bg-background space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <FileText className="w-4 h-4 text-primary" />
                  <div>
                    <div className="font-semibold text-foreground text-xs flex items-center gap-2">
                      <span>{selectedFile.name}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded font-medium bg-muted text-muted-foreground font-mono">
                        {(selectedFile.size / 1024).toFixed(1)} KB
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">Ready for integrity verification & restore</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedFile(null)}
                  className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors cursor-pointer"
                  title="Remove selected file"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="pt-2 border-t border-border flex items-center justify-between gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmRestore}
                    onChange={(e) => setConfirmRestore(e.target.checked)}
                    className="h-4 w-4 rounded border-input text-destructive focus:ring-destructive cursor-pointer"
                  />
                  <span className="text-[11px] text-destructive font-medium">
                    I confirm that restoring this snapshot will reload current system configuration.
                  </span>
                </label>

                <button
                  type="button"
                  disabled={restoring || !confirmRestore}
                  onClick={handleExecuteRestore}
                  className={`px-3.5 py-1.5 rounded text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shrink-0 ${
                    confirmRestore
                      ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-xs'
                      : 'bg-muted text-muted-foreground cursor-not-allowed'
                  }`}
                >
                  {restoring ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Restoring Database...</span>
                    </>
                  ) : (
                    <>
                      <Database className="w-3.5 h-3.5" />
                      <span>Execute Restore</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
