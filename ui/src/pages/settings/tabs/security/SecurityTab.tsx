import React, { useState, useEffect } from 'react';
import { Lock, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { securityApi, type AuthProviderItem } from '../../../../lib/api';
import { AuthProvidersSection } from './sections/AuthProvidersSection';
import { TwoFactorAuthSection } from './sections/TwoFactorAuthSection';
import { PasswordManagementSection } from './sections/PasswordManagementSection';
import { TwoFactorSetupModal } from './sections/TwoFactorSetupModal';
import { ChangePasswordModal } from './sections/ChangePasswordModal';
import { AuthProviderSetupModal } from './sections/AuthProviderSetupModal';

export function SecurityTab() {
  const [loading, setLoading] = useState(true);
  const [errorBanner, setErrorBanner] = useState('');
  const [successBanner, setSuccessBanner] = useState('');

  // 1. Providers State
  const [providers, setProviders] = useState<AuthProviderItem[]>([]);
  const [savingProviderId, setSavingProviderId] = useState<string | null>(null);

  // Active Setup Modal
  const [activeSetupProvider, setActiveSetupProvider] = useState<AuthProviderItem | null>(null);

  // 2. 2FA State & Modal
  const [enable2FA, setEnable2FA] = useState(false);
  const [show2FAModal, setShow2FAModal] = useState(false);
  const [disabling2FA, setDisabling2FA] = useState(false);

  // 3. Password Management State
  const [showPasswordChangeModal, setShowPasswordChangeModal] = useState(false);
  const [passwordLastUpdated, setPasswordLastUpdated] = useState('Recently');
  const [adminUsername, setAdminUsername] = useState('admin');

  const loadOverview = async () => {
    try {
      setLoading(true);
      setErrorBanner('');
      const data = await securityApi.getOverview();
      setProviders(data.auth_providers || []);
      setEnable2FA(data.two_factor?.enabled || false);
      if (data.admin_username) setAdminUsername(data.admin_username);
      if (data.password_last_updated) setPasswordLastUpdated(data.password_last_updated);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Không thể tải cấu hình bảo mật từ máy chủ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  // Toggle Provider
  const handleToggleProvider = async (provider: AuthProviderItem) => {
    const nextEnabled = !provider.enabled;

    if (!nextEnabled && providers.filter((p) => p.enabled).length <= 1) {
      setErrorBanner('Hệ thống yêu cầu ít nhất 1 phương thức xác thực luôn hoạt động. Không thể tắt tất cả phương thức.');
      return;
    }

    // Local state optimistic update
    setProviders((prev) =>
      prev.map((p) => (p.id === provider.id ? { ...p, enabled: nextEnabled } : p))
    );
    setSavingProviderId(provider.id);
    setErrorBanner('');

    try {
      await securityApi.updateProvider(provider.id, nextEnabled, provider.config_json);
      setSuccessBanner(`Đã ${nextEnabled ? 'bật' : 'tắt'} ${provider.name}`);
      setTimeout(() => setSuccessBanner(''), 3000);
    } catch (err: any) {
      // Rollback on error
      setProviders((prev) =>
        prev.map((p) => (p.id === provider.id ? { ...p, enabled: provider.enabled } : p))
      );
      setErrorBanner(err?.message || 'Thao tác không thành công');
    } finally {
      setSavingProviderId(null);
    }
  };

  // Disable 2FA
  const handleDisable2FA = async () => {
    if (!window.confirm('Bạn có chắc chắn muốn tắt xác thực 2 bước (2FA)?')) return;
    setDisabling2FA(true);
    setErrorBanner('');
    try {
      await securityApi.disable2FA();
      setEnable2FA(false);
      setSuccessBanner('Đã tắt xác thực hai bước (2FA)');
      setTimeout(() => setSuccessBanner(''), 3000);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Không thể tắt 2FA');
    } finally {
      setDisabling2FA(false);
    }
  };

  const handleProviderSetupSuccess = (providerId: string, configJsonStr: string) => {
    setProviders((prev) =>
      prev.map((p) =>
        p.id === providerId ? { ...p, enabled: true, config_json: configJsonStr } : p
      )
    );
    const target = providers.find((p) => p.id === providerId);
    setSuccessBanner(`Đã lưu cấu hình cho ${target?.name || providerId}`);
    setTimeout(() => setSuccessBanner(''), 3000);
  };

  const activeProvidersCount = providers.filter((p) => p.enabled).length;

  if (loading && providers.length === 0) {
    return (
      <div className="p-8 bg-card border border-border flex items-center justify-center gap-2 text-xs text-muted-foreground font-sans">
        <RefreshCw className="w-4 h-4 animate-spin text-primary" />
        <span>Đang đồng bộ cấu hình bảo mật thực tế từ máy chủ...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full font-sans">
      {errorBanner && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2 rounded-lg">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorBanner}</span>
        </div>
      )}

      {successBanner && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2 rounded-lg">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successBanner}</span>
        </div>
      )}

      {/* Main Container */}
      <div className="p-6 bg-card border border-border space-y-6 shadow-xs w-full">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Lock className="w-4 h-4 text-primary" />
            <span>Authentication & Identity Access</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono">
              {activeProvidersCount} authentication provider(s) active
            </span>
          </div>
        </div>

        {/* 1. Multi-method Authentication Providers */}
        <AuthProvidersSection
          providers={providers}
          savingProviderId={savingProviderId}
          onToggleProvider={handleToggleProvider}
          onOpenSetup={(p) => setActiveSetupProvider(p)}
        />

        {/* 2. 2FA & Password Management Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          <TwoFactorAuthSection
            enable2FA={enable2FA}
            disabling2FA={disabling2FA}
            onStart2FA={() => setShow2FAModal(true)}
            onDisable2FA={handleDisable2FA}
          />

          <PasswordManagementSection
            adminUsername={adminUsername}
            passwordLastUpdated={passwordLastUpdated}
            onOpenChangePasswordModal={() => setShowPasswordChangeModal(true)}
          />
        </div>
      </div>

      {/* MODAL 1: 2FA Setup */}
      {show2FAModal && (
        <TwoFactorSetupModal
          onClose={() => setShow2FAModal(false)}
          onSuccess={() => setEnable2FA(true)}
        />
      )}

      {/* MODAL 2: Change Password */}
      {showPasswordChangeModal && (
        <ChangePasswordModal
          adminUsername={adminUsername}
          onClose={() => setShowPasswordChangeModal(false)}
          onSuccess={() => setPasswordLastUpdated('Vừa xong')}
        />
      )}

      {/* MODAL 3: Auth Provider Setup */}
      {activeSetupProvider && (
        <AuthProviderSetupModal
          provider={activeSetupProvider}
          onClose={() => setActiveSetupProvider(null)}
          onSuccess={handleProviderSetupSuccess}
        />
      )}
    </div>
  );
}
