import { api } from '../fetcher';

export interface AuthProviderItem {
  id: 'local' | 'oidc' | 'ldap' | 'saml';
  name: string;
  description: string;
  enabled: boolean;
  config_json: string;
  updated_at: string;
}

export interface TwoFactorStatus {
  enabled: boolean;
  configured: boolean;
  configured_at: string;
}

export interface SecurityOverview {
  auth_providers: AuthProviderItem[];
  two_factor: TwoFactorStatus;
  admin_username: string;
  password_last_updated: string;
}

export interface Init2FAOutput {
  secret: string;
  otpauth_url: string;
  qr_svg: string;
}

export interface Verify2FAOutput {
  enabled: boolean;
  recovery_codes: string[];
}

export const securityApi = {
  getOverview: () => api.get<SecurityOverview>('/api/v1/settings/security'),
  updateProvider: (id: string, enabled: boolean, configJSON: string) =>
    api.put<{ message: string; id: string; enabled: boolean }>(`/api/v1/settings/security/auth-providers/${id}`, {
      enabled,
      config_json: configJSON,
    }),
  init2FA: () => api.post<Init2FAOutput>('/api/v1/settings/security/2fa/init', {}),
  verify2FA: (secret: string, code: string) =>
    api.post<Verify2FAOutput>('/api/v1/settings/security/2fa/verify', { secret, code }),
  disable2FA: () => api.post<{ message: string }>('/api/v1/settings/security/2fa/disable', {}),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ message: string }>('/api/v1/settings/security/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    }),
};
