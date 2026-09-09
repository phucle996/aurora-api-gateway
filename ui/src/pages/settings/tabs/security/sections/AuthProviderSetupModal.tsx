import React, { useState } from 'react';
import { X, Copy, RefreshCw, AlertCircle } from 'lucide-react';
import { securityApi, type AuthProviderItem } from '../../../../../lib/api';

export interface AuthProviderSetupModalProps {
  provider: AuthProviderItem;
  onClose: () => void;
  onSuccess: (providerId: string, configJsonStr: string) => void;
}

export function AuthProviderSetupModal({
  provider,
  onClose,
  onSuccess,
}: AuthProviderSetupModalProps) {
  const [setupConfig, setSetupConfig] = useState<Record<string, any>>(() => {
    try {
      return JSON.parse(provider.config_json || '{}');
    } catch {
      return {};
    }
  });
  const [savingConfig, setSavingConfig] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [copiedCallback, setCopiedCallback] = useState(false);

  const handleSaveSetup = async () => {
    setSavingConfig(true);
    setErrorMsg('');

    const jsonStr = JSON.stringify(setupConfig);
    try {
      await securityApi.updateProvider(provider.id, true, jsonStr);
      onSuccess(provider.id, jsonStr);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Lưu cấu hình thất bại');
    } finally {
      setSavingConfig(false);
    }
  };

  const copyCallbackUrl = () => {
    const url = setupConfig.redirect_url || 'https://waf.local/api/v1/auth/callback/oidc';
    navigator.clipboard.writeText(url);
    setCopiedCallback(true);
    setTimeout(() => setCopiedCallback(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h3 className="text-sm font-bold text-foreground">
              Setup {provider.name}
            </h3>
            <p className="text-[11px] text-muted-foreground">
              Configure authentication provider parameters and server credentials
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground cursor-pointer p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {errorMsg && (
          <div className="mx-5 mt-4 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-[11px] flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="p-5 space-y-4 text-xs max-h-[75vh] overflow-y-auto">
          {/* Local Provider Setup */}
          {provider.id === 'local' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Minimum Password Length
                </label>
                <input
                  type="number"
                  value={setupConfig.password_min_length || 8}
                  onChange={(e) =>
                    setSetupConfig({ ...setupConfig, password_min_length: parseInt(e.target.value, 10) || 8 })
                  }
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-xs"
                />
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={setupConfig.require_uppercase ?? true}
                    onChange={(e) =>
                      setSetupConfig({ ...setupConfig, require_uppercase: e.target.checked })
                    }
                    className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
                  />
                  <span className="text-xs text-foreground">Require uppercase letters (A-Z)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={setupConfig.require_number ?? true}
                    onChange={(e) =>
                      setSetupConfig({ ...setupConfig, require_number: e.target.checked })
                    }
                    className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
                  />
                  <span className="text-xs text-foreground">Require numerical digits (0-9)</span>
                </label>
              </div>
            </div>
          )}

          {/* OIDC Provider Setup */}
          {provider.id === 'oidc' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  OIDC Discovery / Issuer URL <span className="text-destructive">*</span>
                </label>
                <input
                  type="url"
                  value={setupConfig.issuer_url || ''}
                  onChange={(e) => setSetupConfig({ ...setupConfig, issuer_url: e.target.value })}
                  placeholder="https://accounts.google.com or https://keycloak.company.com/realms/master"
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Client ID <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={setupConfig.client_id || ''}
                  onChange={(e) => setSetupConfig({ ...setupConfig, client_id: e.target.value })}
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Client Secret <span className="text-destructive">*</span>
                </label>
                <input
                  type="password"
                  value={setupConfig.client_secret || ''}
                  onChange={(e) => setSetupConfig({ ...setupConfig, client_secret: e.target.value })}
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Authorized Redirect Callback URL (Copy to IdP)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={setupConfig.redirect_url || 'https://waf.local/api/v1/auth/callback/oidc'}
                    className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-muted-foreground text-xs font-mono"
                  />
                  <button
                    type="button"
                    onClick={copyCallbackUrl}
                    className="px-2.5 py-2 bg-muted hover:bg-muted/80 border border-border rounded-lg text-foreground cursor-pointer text-xs flex items-center gap-1 shrink-0"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{copiedCallback ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* LDAP Provider Setup */}
          {provider.id === 'ldap' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  LDAP Server URI <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={setupConfig.server || ''}
                  onChange={(e) => setSetupConfig({ ...setupConfig, server: e.target.value })}
                  placeholder="ldap.company.internal"
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-xs font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Port
                  </label>
                  <input
                    type="number"
                    value={setupConfig.port || 636}
                    onChange={(e) =>
                      setSetupConfig({ ...setupConfig, port: parseInt(e.target.value, 10) || 636 })
                    }
                    className="w-full px-3 py-2 bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-xs font-mono"
                  />
                </div>
                <div className="flex items-center pt-5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={setupConfig.use_ssl ?? true}
                      onChange={(e) => setSetupConfig({ ...setupConfig, use_ssl: e.target.checked })}
                      className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
                    />
                    <span className="text-xs text-foreground">Use LDAPS (SSL/TLS)</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Base DN <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={setupConfig.base_dn || ''}
                  onChange={(e) => setSetupConfig({ ...setupConfig, base_dn: e.target.value })}
                  placeholder="dc=company,dc=internal"
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Bind DN (Service Account)
                </label>
                <input
                  type="text"
                  value={setupConfig.bind_dn || ''}
                  onChange={(e) => setSetupConfig({ ...setupConfig, bind_dn: e.target.value })}
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Bind Password
                </label>
                <input
                  type="password"
                  value={setupConfig.bind_password || ''}
                  onChange={(e) => setSetupConfig({ ...setupConfig, bind_password: e.target.value })}
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-xs font-mono"
                />
              </div>
            </div>
          )}

          {/* SAML Provider Setup */}
          {provider.id === 'saml' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  IdP Metadata URL <span className="text-destructive">*</span>
                </label>
                <input
                  type="url"
                  value={setupConfig.idp_metadata_url || ''}
                  onChange={(e) => setSetupConfig({ ...setupConfig, idp_metadata_url: e.target.value })}
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  SP Entity ID
                </label>
                <input
                  type="text"
                  value={setupConfig.entity_id || ''}
                  onChange={(e) => setSetupConfig({ ...setupConfig, entity_id: e.target.value })}
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  IdP Single Sign-On (SSO) URL
                </label>
                <input
                  type="url"
                  value={setupConfig.sso_url || ''}
                  onChange={(e) => setSetupConfig({ ...setupConfig, sso_url: e.target.value })}
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-xs font-mono"
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-4 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border border-border text-foreground hover:bg-muted text-xs cursor-pointer font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={savingConfig}
              onClick={handleSaveSetup}
              className="px-4 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold cursor-pointer shadow-xs inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {savingConfig && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              <span>{savingConfig ? 'Saving...' : 'Save Configuration'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
