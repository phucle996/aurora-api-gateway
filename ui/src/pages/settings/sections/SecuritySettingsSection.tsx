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
    <div className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#152030] p-4 flex flex-col justify-between shadow-xs">
      <div>
        <div className="flex items-center gap-2 pb-3 border-b border-slate-200 dark:border-[#152030] text-sm font-semibold text-slate-900 dark:text-white font-mono">
          <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span>Security</span>
        </div>

        <div className="mt-3 space-y-3 text-xs font-mono">
          {/* Authentication */}
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">Authentication</span>
            <select
              value={authMethod}
              onChange={(e) => setAuthMethod(e.target.value)}
              className="bg-slate-50 dark:bg-[#0E1726] border border-slate-200 dark:border-[#1C293D] px-2.5 py-1 text-slate-800 dark:text-slate-200 text-xs focus:outline-none focus:border-emerald-500 cursor-pointer"
            >
              <option value="Local Users">Local Users</option>
              <option value="OIDC / OAuth2">OIDC / OAuth2</option>
              <option value="SAML 2.0">SAML 2.0</option>
              <option value="LDAP">LDAP</option>
            </select>
          </div>

          {/* Session Timeout */}
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">Session Timeout</span>
            <select
              value={sessionTimeout}
              onChange={(e) => setSessionTimeout(e.target.value)}
              className="bg-slate-50 dark:bg-[#0E1726] border border-slate-200 dark:border-[#1C293D] px-2.5 py-1 text-slate-800 dark:text-slate-200 text-xs focus:outline-none focus:border-emerald-500 cursor-pointer"
            >
              <option value="15 minutes">15 minutes</option>
              <option value="30 minutes">30 minutes</option>
              <option value="1 hour">1 hour</option>
              <option value="8 hours">8 hours</option>
            </select>
          </div>

          {/* Enable 2FA */}
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">Enable 2FA</span>
            <button
              type="button"
              onClick={() => setEnable2FA(!enable2FA)}
              className={`w-9 h-5 flex items-center p-0.5 cursor-pointer transition-colors ${
                enable2FA ? 'bg-emerald-600 dark:bg-emerald-500' : 'bg-slate-300 dark:bg-[#152030]'
              }`}
            >
              <div
                className={`w-4 h-4 bg-white transition-transform ${
                  enable2FA ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Password Policy */}
          <div className="flex items-center justify-between py-1 border-b border-slate-100 dark:border-[#152030]/60">
            <span className="text-slate-500 dark:text-slate-400">Password Policy</span>
            <button
              type="button"
              onClick={() => setShowPassPolicyModal(true)}
              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-[#0E1726] dark:hover:bg-[#152030] border border-slate-200 dark:border-[#1C293D] text-slate-800 dark:text-slate-200 text-xs transition-colors cursor-pointer"
            >
              Configure
            </button>
          </div>

          {/* API Access Sub-section */}
          <div className="pt-2 space-y-2.5">
            <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
              API Access
            </div>

            {/* Enable API Keys */}
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400">Enable API Keys</span>
              <button
                type="button"
                onClick={() => setEnableApiKeys(!enableApiKeys)}
                className={`w-9 h-5 flex items-center p-0.5 cursor-pointer transition-colors ${
                  enableApiKeys ? 'bg-emerald-600 dark:bg-emerald-500' : 'bg-slate-300 dark:bg-[#152030]'
                }`}
              >
                <div
                  className={`w-4 h-4 bg-white transition-transform ${
                    enableApiKeys ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Allow from Internal Network Only */}
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400">Allow from Internal Network Only</span>
              <button
                type="button"
                onClick={() => setInternalOnly(!internalOnly)}
                className={`w-9 h-5 flex items-center p-0.5 cursor-pointer transition-colors ${
                  internalOnly ? 'bg-emerald-600 dark:bg-emerald-500' : 'bg-slate-300 dark:bg-[#152030]'
                }`}
              >
                <div
                  className={`w-4 h-4 bg-white transition-transform ${
                    internalOnly ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Audit Log for Admin Actions */}
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400">Audit Log for Admin Actions</span>
              <button
                type="button"
                onClick={() => setAuditLogAdmin(!auditLogAdmin)}
                className={`w-9 h-5 flex items-center p-0.5 cursor-pointer transition-colors ${
                  auditLogAdmin ? 'bg-emerald-600 dark:bg-emerald-500' : 'bg-slate-300 dark:bg-[#152030]'
                }`}
              >
                <div
                  className={`w-4 h-4 bg-white transition-transform ${
                    auditLogAdmin ? 'translate-x-4' : 'translate-x-0'
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
