import React, { useState } from 'react';
import { Cloud, Eye, EyeOff, Loader2 } from 'lucide-react';
import type { BackupConfig } from '../../../../../lib/api';

interface S3StorageSectionProps {
  config: BackupConfig;
  onChange: (updated: BackupConfig) => void;
  savingConfig: boolean;
  onSaveConfig: () => Promise<void>;
}

export function S3StorageSection({
  config,
  onChange,
  savingConfig,
  onSaveConfig,
}: S3StorageSectionProps) {
  const [showSecretKey, setShowSecretKey] = useState(false);

  return (
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
            onChange={(e) => onChange({ ...config, s3_enabled: e.target.checked })}
            className="h-4 w-4 rounded border-input text-primary focus:ring-ring cursor-pointer"
          />
        </label>
      </div>

      <div className="p-3.5 border border-border rounded-lg bg-background space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="font-medium text-foreground text-xs">S3 Endpoint URL (Optional)</label>
            <input
              type="text"
              value={config.s3_endpoint}
              onChange={(e) => onChange({ ...config, s3_endpoint: e.target.value })}
              placeholder="https://s3.amazonaws.com (or MinIO/R2)"
              className="w-full bg-card border border-input rounded px-3 py-1.5 text-foreground font-mono text-[11px] focus:outline-none focus:border-primary"
            />
          </div>

          <div className="space-y-1">
            <label className="font-medium text-foreground text-xs">S3 Bucket Name</label>
            <input
              type="text"
              value={config.s3_bucket}
              onChange={(e) => onChange({ ...config, s3_bucket: e.target.value })}
              placeholder="aurora-waf-backups"
              className="w-full bg-card border border-input rounded px-3 py-1.5 text-foreground font-mono text-[11px] focus:outline-none focus:border-primary"
            />
          </div>

          <div className="space-y-1">
            <label className="font-medium text-foreground text-xs">Region</label>
            <input
              type="text"
              value={config.s3_region}
              onChange={(e) => onChange({ ...config, s3_region: e.target.value })}
              placeholder="ap-southeast-1"
              className="w-full bg-card border border-input rounded px-3 py-1.5 text-foreground font-mono text-[11px] focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="font-medium text-foreground text-xs">Access Key ID</label>
            <input
              type="text"
              value={config.s3_access_key}
              onChange={(e) => onChange({ ...config, s3_access_key: e.target.value })}
              placeholder="AKIAIOSFODNN7EXAMPLE"
              className="w-full bg-card border border-input rounded px-3 py-1.5 text-foreground font-mono text-[11px] focus:outline-none focus:border-primary"
            />
          </div>

          <div className="space-y-1">
            <label className="font-medium text-foreground text-xs">Secret Access Key</label>
            <div className="relative">
              <input
                type={showSecretKey ? 'text' : 'password'}
                value={config.s3_secret_key}
                onChange={(e) => onChange({ ...config, s3_secret_key: e.target.value })}
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
            <label className="font-medium text-foreground text-xs flex items-center justify-between">
              <span>S3 Storage Retention Policy</span>
              <span className="text-[10px] text-primary font-mono">For S3 Only</span>
            </label>
            <select
              value={config.s3_retention_days}
              onChange={(e) => onChange({ ...config, s3_retention_days: parseInt(e.target.value, 10) || 30 })}
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
            onClick={onSaveConfig}
            className="px-3.5 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60"
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
  );
}
