import React, { useState, useEffect } from 'react';
import {
  Key,
  X,
  Copy,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import QRCode from 'qrcode';
import { securityApi } from '../../../../../lib/api';

export interface TwoFactorSetupModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function TwoFactorSetupModal({ onClose, onSuccess }: TwoFactorSetupModalProps) {
  const [loading, setLoading] = useState(true);
  const [twoFaStep, setTwoFaStep] = useState<'scan' | 'recovery'>('scan');
  const [twoFaCode, setTwoFaCode] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [twoFaError, setTwoFaError] = useState('');
  const [verifying2FA, setVerifying2FA] = useState(false);

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        setLoading(true);
        setTwoFaError('');
        const res = await securityApi.init2FA();
        if (!mounted) return;
        setSecretKey(res.secret);

        const dataUrl = await QRCode.toDataURL(res.otpauth_url, {
          width: 200,
          margin: 1,
          color: {
            dark: '#000000',
            light: '#ffffff',
          },
        });
        if (!mounted) return;
        setQrDataUrl(dataUrl);
      } catch (err: any) {
        if (mounted) {
          setTwoFaError(err?.message || 'Không thể khởi tạo 2FA');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };
    init();
    return () => {
      mounted = false;
    };
  }, []);

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (twoFaCode.length !== 6) return;

    setVerifying2FA(true);
    setTwoFaError('');

    try {
      const res = await securityApi.verify2FA(secretKey, twoFaCode);
      setRecoveryCodes(res.recovery_codes || []);
      setTwoFaStep('recovery');
      onSuccess();
    } catch (err: any) {
      setTwoFaError(err?.message || 'Mã xác thực không hợp lệ. Vui lòng thử lại');
    } finally {
      setVerifying2FA(false);
    }
  };

  const handleCopySecret = () => {
    navigator.clipboard.writeText(secretKey);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  };

  return (
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
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground cursor-pointer p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="w-5 h-5 animate-spin text-primary" />
            <span>Đang khởi tạo mã bảo mật 2FA...</span>
          </div>
        ) : twoFaStep === 'scan' ? (
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
                  onClick={onClose}
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
        ) : (
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
                onClick={onClose}
                className="px-4 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
