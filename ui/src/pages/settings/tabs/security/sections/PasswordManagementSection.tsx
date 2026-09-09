import React from 'react';
import { Key } from 'lucide-react';

export interface PasswordManagementSectionProps {
  adminUsername: string;
  passwordLastUpdated: string;
  onOpenChangePasswordModal: () => void;
}

export function PasswordManagementSection({
  adminUsername,
  passwordLastUpdated,
  onOpenChangePasswordModal,
}: PasswordManagementSectionProps) {
  return (
    <div className="p-4 border border-border rounded-lg bg-background flex flex-col justify-between space-y-3">
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-foreground flex items-center gap-1.5 text-xs">
            <Key className="w-3.5 h-3.5 text-primary" />
            Change Password
          </span>
          <span className="text-[10px] px-1.5 py-0.2 rounded font-medium bg-muted text-muted-foreground font-mono">
            {adminUsername}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Update master login credentials for the primary administrator account with Argon2id hashing.
        </p>
      </div>

      <div className="flex items-center justify-between pt-1">
        <span className="text-[11px] text-muted-foreground">
          Password updated: {passwordLastUpdated}
        </span>
        <button
          type="button"
          onClick={onOpenChangePasswordModal}
          className="px-3 py-1.5 rounded bg-muted hover:bg-muted/80 text-foreground border border-border text-xs font-medium transition-colors cursor-pointer"
        >
          Change Password
        </button>
      </div>
    </div>
  );
}
