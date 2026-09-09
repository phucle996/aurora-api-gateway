import React from 'react';
import { Key } from 'lucide-react';

export interface TwoFactorAuthSectionProps {
  enable2FA: boolean;
  disabling2FA: boolean;
  onStart2FA: () => void;
  onDisable2FA: () => void;
}

export function TwoFactorAuthSection({
  enable2FA,
  disabling2FA,
  onStart2FA,
  onDisable2FA,
}: TwoFactorAuthSectionProps) {
  return (
    <div className="p-4 border border-border rounded-lg bg-background flex flex-col justify-between space-y-3">
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-foreground flex items-center gap-1.5 text-xs">
            <Key className="w-3.5 h-3.5 text-primary" />
            Two-Factor Authentication (2FA)
          </span>
          <span
            className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
              enable2FA
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {enable2FA ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Enforce TOTP authenticator verification code upon logging into the console.
        </p>
      </div>

      <div className="flex items-center justify-between pt-1">
        <span className="text-[11px] text-muted-foreground">
          {enable2FA ? 'Authenticator configured' : 'Not configured'}
        </span>
        <div className="flex items-center gap-2">
          {enable2FA && (
            <button
              type="button"
              disabled={disabling2FA}
              onClick={onDisable2FA}
              className="px-2.5 py-1.5 rounded text-xs font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20 transition-colors cursor-pointer disabled:opacity-50"
            >
              {disabling2FA ? 'Disabling...' : 'Disable 2FA'}
            </button>
          )}
          <button
            type="button"
            onClick={onStart2FA}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer ${
              enable2FA
                ? 'bg-muted text-foreground hover:bg-muted/80 border border-border'
                : 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs'
            }`}
          >
            {enable2FA ? 'Reconfigure 2FA' : 'Setup 2FA with QR'}
          </button>
        </div>
      </div>
    </div>
  );
}
