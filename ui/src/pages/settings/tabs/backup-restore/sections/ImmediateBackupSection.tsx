import React from 'react';
import { HardDrive, Cloud, Download, Loader2 } from 'lucide-react';
import type { BackupConfig } from '../../../../../lib/api';

interface ImmediateBackupSectionProps {
  config: BackupConfig;
  downloadingLocal: boolean;
  onDownloadLocal: () => Promise<void>;
  pushingS3: boolean;
  onPushS3: () => Promise<void>;
}

export function ImmediateBackupSection({
  config,
  downloadingLocal,
  onDownloadLocal,
  pushingS3,
  onPushS3,
}: ImmediateBackupSectionProps) {
  return (
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
              onClick={onDownloadLocal}
              className="px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60"
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
              onClick={onPushS3}
              className="px-3 py-1.5 rounded bg-muted hover:bg-muted/80 text-foreground border border-border text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
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
  );
}
