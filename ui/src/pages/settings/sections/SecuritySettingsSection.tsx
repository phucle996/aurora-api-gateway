import React, { useState } from 'react';
import { ShieldCheck, Key, Lock, Check } from 'lucide-react';

export function SecuritySettingsSection() {
  const [authMethod, setAuthMethod] = useState('Local Users');
  const [sessionTimeout, setSessionTimeout] = useState('30 minutes');
  const [enable2FA, setEnable2FA] = useState(true);
  const [enableApiKeys, setEnableApiKeys] = useState(true);
  const [internalOnly, setInternalOnly] = useState(true);
  const [auditLogAdmin, setAuditLogAdmin] = useState(true);
  const [showPassPolicyModal, setShowPassPolicyModal] = useState(false);

  return (
    <div className="bg-card border border-border p-4 flex flex-col justify-between shadow-xs">
      <div>
        <div className="flex items-center gap-2 pb-3 border-b border-border text-sm font-semibold text-foreground">
          <ShieldCheck className="w-4 h-4 text-primary" />
          <span>Security</span>
        </div>

        <div className="mt-3 space-y-3 text-xs">
          {/* Authentication */}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Authentication</span>
            <select
              value={authMethod}
              onChange={(e) => setAuthMethod(e.target.value)}
              className="bg-background border border-input px-2.5 py-1 text-foreground text-xs focus:outline-none focus:border-primary cursor-pointer"
            >
              <option value="Local Users">Local Users</option>
              <option value="OIDC / OAuth2">OIDC / OAuth2</option>
              <option value="SAML 2.0">SAML 2.0</option>
              <option value="LDAP">LDAP</option>
            </select>
          </div>

          {/* Session Timeout */}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Session Timeout</span>
            <select
              value={sessionTimeout}
              onChange={(e) => setSessionTimeout(e.target.value)}
              className="bg-background border border-input px-2.5 py-1 text-foreground text-xs focus:outline-none focus:border-primary cursor-pointer"
            >
              <option value="15 minutes">15 minutes</option>
              <option value="30 minutes">30 minutes</option>
              <option value="1 hour">1 hour</option>
              <option value="8 hours">8 hours</option>
            </select>
          </div>

          {/* Enable 2FA */}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Enable 2FA</span>
            <button
              type="button"
              onClick={() => setEnable2FA(!enable2FA)}
              className={`w-9 h-5 flex items-center p-0.5 cursor-pointer transition-colors ${enable2FA ? 'bg-primary' : 'bg-muted border border-border'
                }`}
            >
              <div
                className={`w-4 h-4 bg-white transition-transform ${enable2FA ? 'translate-x-4' : 'translate-x-0'
                  }`}
              />
            </button>
          </div>

          {/* Password Policy */}
          <div className="flex items-center justify-between py-1 border-b border-border">
            <span className="text-muted-foreground">Password Policy</span>
            <button
              type="button"
              onClick={() => setShowPassPolicyModal(true)}
              className="px-2.5 py-1 bg-muted hover:bg-muted/80 border border-input text-foreground text-xs transition-colors cursor-pointer"
            >
              Configure
            </button>
          </div>

          {/* API Access Sub-section */}
          <div className="pt-2 space-y-2.5">
            <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              API Access
            </div>

            {/* Enable API Keys */}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Enable API Keys</span>
              <button
                type="button"
                onClick={() => setEnableApiKeys(!enableApiKeys)}
                className={`w-9 h-5 flex items-center p-0.5 cursor-pointer transition-colors ${enableApiKeys ? 'bg-primary' : 'bg-muted border border-border'
                  }`}
              >
                <div
                  className={`w-4 h-4 bg-white transition-transform ${enableApiKeys ? 'translate-x-4' : 'translate-x-0'
                    }`}
                />
              </button>
            </div>

            {/* Allow from Internal Network Only */}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Allow from Internal Network Only</span>
              <button
                type="button"
                onClick={() => setInternalOnly(!internalOnly)}
                className={`w-9 h-5 flex items-center p-0.5 cursor-pointer transition-colors ${internalOnly ? 'bg-primary' : 'bg-muted border border-border'
                  }`}
              >
                <div
                  className={`w-4 h-4 bg-white transition-transform ${internalOnly ? 'translate-x-4' : 'translate-x-0'
                    }`}
                />
              </button>
            </div>

            {/* Audit Log for Admin Actions */}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Audit Log for Admin Actions</span>
              <button
                type="button"
                onClick={() => setAuditLogAdmin(!auditLogAdmin)}
                className={`w-9 h-5 flex items-center p-0.5 cursor-pointer transition-colors ${auditLogAdmin ? 'bg-primary' : 'bg-muted border border-border'
                  }`}
              >
                <div
                  className={`w-4 h-4 bg-white transition-transform ${auditLogAdmin ? 'translate-x-4' : 'translate-x-0'
                    }`}
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
