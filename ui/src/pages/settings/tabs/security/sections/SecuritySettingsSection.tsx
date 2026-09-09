import React, { useState, useEffect } from 'react';
import {
  Key,
  Eye,
  EyeOff,
  Copy,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  X,
  Lock,
} from 'lucide-react';
import QRCode from 'qrcode';
import { securityApi, AuthProviderItem, SecurityOverview } from '../../../../../lib/api';

export function SecuritySettingsSection() {
  const [loading, setLoading] = useState(true);
  const [errorBanner, setErrorBanner] = useState('');
  const [successBanner, setSuccessBanner] = useState('');

  // 1. Providers State
  const [providers, setProviders] = useState<AuthProviderItem[]>([]);
  const [savingProviderId, setSavingProviderId] = useState<string | null>(null);

  // Active Setup Modal
  const [activeSetupProvider, setActiveSetupProvider] = useState<AuthProviderItem | null>(null);
  const [setupConfig, setSetupConfig] = useState<Record<string, any>>({});
  const [savingConfig, setSavingConfig] = useState(false);

  // 2. 2FA State & Modal
  const [enable2FA, setEnable2FA] = useState(false);
  const [twoFaConfigured, setTwoFaConfigured] = useState(false);
  const [show2FAModal, setShow2FAModal] = useState(false);
  const [twoFaStep, setTwoFaStep] = useState<'scan' | 'recovery'>('scan');
  const [twoFaCode, setTwoFaCode] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [twoFaError, setTwoFaError] = useState('');
  const [verifying2FA, setVerifying2FA] = useState(false);
  const [disabling2FA, setDisabling2FA] = useState(false);

  // 3. Password Change Modal State
  const [showPasswordChangeModal, setShowPasswordChangeModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [passChangeSuccess, setPassChangeSuccess] = useState(false);
  const [passChangeError, setPassChangeError] = useState('');
  const [changingPass, setChangingPass] = useState(false);
  const [passwordLastUpdated, setPasswordLastUpdated] = useState('Recently');
  const [adminUsername, setAdminUsername] = useState('admin');

  // Fetch security overview on load
  const loadOverview = async () => {
    try {
      setLoading(true);
      setErrorBanner('');
      const data = await securityApi.getOverview();
      setProviders(data.auth_providers || []);
      setEnable2FA(data.two_factor?.enabled || false);
      setTwoFaConfigured(data.two_factor?.configured || false);
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

  // Open Provider Setup Dialog
  const handleOpenSetup = (provider: AuthProviderItem) => {
    let parsed: Record<string, any> = {};
    try {
      parsed = JSON.parse(provider.config_json || '{}');
    } catch {
      parsed = {};
    }
    setSetupConfig(parsed);
    setActiveSetupProvider(provider);
  };

  // Save Provider Setup
  const handleSaveSetup = async () => {
    if (!activeSetupProvider) return;
    setSavingConfig(true);
    setErrorBanner('');

    const jsonStr = JSON.stringify(setupConfig);
    try {
      await securityApi.updateProvider(activeSetupProvider.id, true, jsonStr);
      setProviders((prev) =>
        prev.map((p) =>
          p.id === activeSetupProvider.id ? { ...p, enabled: true, config_json: jsonStr } : p
        )
      );
      setActiveSetupProvider(null);
      setSuccessBanner(`Đã lưu cấu hình cho ${activeSetupProvider.name}`);
      setTimeout(() => setSuccessBanner(''), 3000);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Lưu cấu hình thất bại');
    } finally {
      setSavingConfig(false);
    }
  };

  // Start 2FA Setup
  const handleStart2FA = async () => {
    try {
      setTwoFaError('');
      setTwoFaCode('');
      setLoading(true);
      const res = await securityApi.init2FA();
      setSecretKey(res.secret);

      // Generate real QR code data URL from otpauth URL
      const dataUrl = await QRCode.toDataURL(res.otpauth_url, {
        width: 200,
        margin: 1,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      });
      setQrDataUrl(dataUrl);
      setTwoFaStep('scan');
      setShow2FAModal(true);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Không thể khởi tạo 2FA');
    } finally {
      setLoading(false);
    }
  };

  // Verify 2FA
  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (twoFaCode.length !== 6) return;

    setVerifying2FA(true);
    setTwoFaError('');

    try {
      const res = await securityApi.verify2FA(secretKey, twoFaCode);
      setRecoveryCodes(res.recovery_codes || []);
      setEnable2FA(true);
      setTwoFaConfigured(true);
      setTwoFaStep('recovery');
    } catch (err: any) {
      setTwoFaError(err?.message || 'Mã xác thực không hợp lệ. Vui lòng thử lại');
    } finally {
      setVerifying2FA(false);
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
      setTwoFaConfigured(false);
      setSuccessBanner('Đã tắt xác thực hai bước (2FA)');
      setTimeout(() => setSuccessBanner(''), 3000);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Không thể tắt 2FA');
    } finally {
      setDisabling2FA(false);
    }
  };

  // Copy Secret
  const handleCopySecret = () => {
    navigator.clipboard.writeText(secretKey);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  };

  // Submit Password Change
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassChangeError('');
    if (!currentPassword) {
      setPassChangeError('Vui lòng nhập mật khẩu hiện tại.');
      return;
    }
    if (newPassword.length < 8) {
      setPassChangeError('Mật khẩu mới phải có ít nhất 8 ký tự.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPassChangeError('Mật khẩu xác nhận không khớp.');
      return;
    }

    setChangingPass(true);
    try {
      await securityApi.changePassword(currentPassword, newPassword);
      setPassChangeSuccess(true);
      setPasswordLastUpdated('Vừa xong');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        setPassChangeSuccess(false);
        setShowPasswordChangeModal(false);
      }, 1500);
    } catch (err: any) {
      setPassChangeError(err?.message || 'Đổi mật khẩu thất bại. Vui lòng kiểm tra lại mật khẩu cũ.');
    } finally {
      setChangingPass(false);
    }
  };

  const activeProvidersCount = providers.filter((p) => p.enabled).length;

  if (loading && providers.length === 0) {
    return (
      <div className="p-8 bg-card border border-border flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <RefreshCw className="w-4 h-4 animate-spin text-primary" />
        <span>Đang đồng bộ cấu hình bảo mật thực tế từ máy chủ...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full">
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
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-foreground">
              Authentication Providers (Select & Configure)
            </label>
            <span className="text-[11px] text-muted-foreground">
              Multiple providers can be active simultaneously
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {providers.map((method) => {
              const isLocal = method.id === 'local';
              return (
                <div
                  key={method.id}
                  className={`p-3.5 border rounded-lg transition-all flex flex-col justify-between space-y-2.5 ${
                    method.enabled
                      ? 'border-primary/40 bg-primary/5 shadow-xs'
                      : 'border-border bg-background'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <label className="flex items-start gap-2.5 cursor-pointer flex-1">
                      <input
                        type="checkbox"
                        checked={method.enabled}
                        disabled={savingProviderId === method.id}
                        onChange={() => handleToggleProvider(method)}
                        className="mt-0.5 h-4 w-4 rounded border-input text-primary focus:ring-ring cursor-pointer"
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground text-xs">
                            {method.name}
                          </span>
                          <span
                            className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
                              method.enabled
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                : 'bg-muted text-muted-foreground'
                            }`}
                          >
                            {method.enabled ? 'Active' : 'Disabled'}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                          {method.description}
                        </p>
                      </div>
                    </label>

                    {method.id !== 'local' && (
                      <button
                        type="button"
                        onClick={() => handleOpenSetup(method)}
                        className="px-2.5 py-1 rounded bg-muted hover:bg-muted/80 text-foreground border border-border text-[11px] font-medium transition-colors cursor-pointer shrink-0"
                      >
                        Setup
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 2. 2FA & Password Management Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          {/* 2FA Card */}
          <div className="p-4 border border-border rounded-lg bg-background flex flex-col justify-between space-y-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground flex items-center gap-1.5">
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
                    onClick={handleDisable2FA}
                    className="px-2.5 py-1.5 rounded text-xs font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20 transition-colors cursor-pointer"
                  >
                    {disabling2FA ? 'Disabling...' : 'Disable 2FA'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleStart2FA}
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

          {/* Password Change Card */}
          <div className="p-4 border border-border rounded-lg bg-background flex flex-col justify-between space-y-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground flex items-center gap-1.5">
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
                onClick={() => {
                  setPassChangeError('');
                  setShowPasswordChangeModal(true);
                }}
                className="px-3 py-1.5 rounded bg-muted hover:bg-muted/80 text-foreground border border-border text-xs font-medium transition-colors cursor-pointer"
              >
                Change Password
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* MODAL 1: 2FA Setup with Real QR Code & Secret Key */}
      {show2FAModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                  <Key className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">
                    Setup Two-Factor Authentication
                  </h3>
                  <p className="text-[11px] text-muted-foreground">
                    Protect your account with Google Authenticator or 1Password
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShow2FAModal(false)}
                className="text-muted-foreground hover:text-foreground cursor-pointer p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {twoFaStep === 'scan' && (
              <div className="p-5 space-y-4 text-xs">
                {twoFaError && (
                  <div className="p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-[11px] flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{twoFaError}</span>
                  </div>
                )}

                {/* QR Code container */}
                <div className="flex flex-col items-center justify-center space-y-2 py-2">
                  {qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt="2FA QR Code"
                      className="w-44 h-44 bg-white p-2 rounded-lg shadow-sm border border-border"
                    />
                  ) : (
                    <div className="w-44 h-44 flex items-center justify-center bg-muted/40 rounded-lg">
                      <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  <span className="text-[11px] text-muted-foreground text-center max-w-xs">
                    Scan this QR code with your authenticator mobile application.
                  </span>
                </div>

                {/* Manual Code Input */}
                <div className="space-y-1.5">
                  <label className="text-[11px] text-muted-foreground block font-medium">
                    Or enter this setup key manually into your app:
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 px-3 py-2 bg-muted/60 border border-input rounded-lg font-mono text-xs text-foreground tracking-wider font-semibold">
                      {secretKey}
                    </div>
                    <button
                      type="button"
                      onClick={handleCopySecret}
                      className="px-3 py-2 rounded-lg border border-border bg-background hover:bg-muted text-foreground flex items-center gap-1.5 text-xs font-medium cursor-pointer transition-colors"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{copiedSecret ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>

                {/* 6-digit confirmation */}
                <form onSubmit={handleVerify2FA} className="space-y-3 pt-2">
                  <div>
                    <label className="text-xs font-semibold text-foreground block mb-1.5">
                      Enter the 6-digit code from your app:
                    </label>
                    <input
                      type="text"
                      maxLength={6}
                      pattern="[0-9]{6}"
                      required
                      value={twoFaCode}
                      onChange={(e) => setTwoFaCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="000000"
                      className="w-full text-center tracking-[0.5em] font-mono font-bold text-base px-3 py-2 bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setShow2FAModal(false)}
                      className="px-3 py-1.5 rounded-lg border border-border text-foreground hover:bg-muted text-xs cursor-pointer font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={twoFaCode.length !== 6 || verifying2FA}
                      className="px-4 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold disabled:opacity-50 cursor-pointer transition-colors shadow-xs inline-flex items-center gap-1.5"
                    >
                      {verifying2FA && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                      <span>{verifying2FA ? 'Verifying...' : 'Verify & Enable 2FA'}</span>
                    </button>
                  </div>
                </form>
              </div>
            )}

            {twoFaStep === 'recovery' && (
              <div className="p-5 space-y-4 text-xs">
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-center gap-2.5 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span className="font-semibold text-xs">Two-Factor Authentication is now active!</span>
                </div>

                <p className="text-muted-foreground leading-relaxed text-[11px]">
                  Save these one-time recovery codes in a safe password manager. If you lose access to your authenticator app, these are the only way to recover access.
                </p>

                <div className="grid grid-cols-2 gap-2 p-3 bg-muted/50 rounded-lg border border-border font-mono text-xs font-medium text-foreground">
                  {recoveryCodes.map((code) => (
                    <div key={code} className="p-1.5 bg-background border border-border rounded text-center">
                      {code}
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-border">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(recoveryCodes.join('\n'));
                    }}
                    className="inline-flex items-center gap-1 text-primary hover:underline font-medium cursor-pointer text-xs"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy all codes</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShow2FAModal(false)}
                    className="px-4 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 2: Change Password Modal */}
      {showPasswordChangeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                  <Key className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">Change Password</h3>
                  <p className="text-[11px] text-muted-foreground">
                    Update master administrator login password ({adminUsername})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPasswordChangeModal(false)}
                className="text-muted-foreground hover:text-foreground cursor-pointer p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handlePasswordSubmit} className="p-5 space-y-3.5 text-xs">
              {passChangeError && (
                <div className="p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-[11px] flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{passChangeError}</span>
                </div>
              )}

              {passChangeSuccess && (
                <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[11px] flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Password updated successfully!</span>
                </div>
              )}

              {/* Current Password */}
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Current Password <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showCurrentPass ? 'text' : 'password'}
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    className="w-full px-3 py-2 pr-9 bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPass(!showCurrentPass)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    {showCurrentPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* New Password */}
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  New Password <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showNewPass ? 'text' : 'password'}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="w-full px-3 py-2 pr-9 bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPass(!showNewPass)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    {showNewPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Confirm New Password */}
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Confirm New Password <span className="text-destructive">*</span>
                </label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowPasswordChangeModal(false)}
                  className="px-3 py-1.5 rounded-lg border border-border text-foreground hover:bg-muted text-xs cursor-pointer font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={changingPass}
                  className="px-4 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold cursor-pointer shadow-xs disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {changingPass && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{changingPass ? 'Saving...' : 'Update Password'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Auth Provider Setup Configuration Modal */}
      {activeSetupProvider && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h3 className="text-sm font-bold text-foreground">
                  Setup {activeSetupProvider.name}
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  Configure authentication provider parameters and server credentials
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveSetupProvider(null)}
                className="text-muted-foreground hover:text-foreground cursor-pointer p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs max-h-[75vh] overflow-y-auto">
              {/* Local Provider Setup */}
              {activeSetupProvider.id === 'local' && (
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
              {activeSetupProvider.id === 'oidc' && (
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
                        onClick={() =>
                          navigator.clipboard.writeText(
                            setupConfig.redirect_url || 'https://waf.local/api/v1/auth/callback/oidc'
                          )
                        }
                        className="px-2.5 py-2 bg-muted hover:bg-muted/80 border border-border rounded-lg text-foreground cursor-pointer text-xs"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* LDAP Provider Setup */}
              {activeSetupProvider.id === 'ldap' && (
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
              {activeSetupProvider.id === 'saml' && (
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
                  onClick={() => setActiveSetupProvider(null)}
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
      )}
    </div>
  );
}
