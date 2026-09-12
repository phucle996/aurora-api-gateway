import React, { useState, useEffect } from 'react';
import { X, ShieldCheck, Key, Lock, Globe, FileText } from 'lucide-react';
import { certificatesApi } from '../../../lib/api/certificates';
import type { CertificateItem, CertificateFormState } from '../types';
import { DEFAULT_CERTIFICATE_FORM } from '../types';

interface CertificateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editingCert: CertificateItem | null;
}

export function CertificateModal({
  isOpen,
  onClose,
  onSuccess,
  editingCert,
}: CertificateModalProps) {
  const [formData, setFormData] = useState<CertificateFormState>(DEFAULT_CERTIFICATE_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);

    if (editingCert) {
      let snis: string[] = [];
      try {
        snis = JSON.parse(editingCert.snis_json || '[]');
      } catch {
        snis = [];
      }

      setFormData({
        name: editingCert.name,
        snisInput: snis.join(', '),
        cert_pem: editingCert.cert_pem,
		key_pem: '',
        mtls_enabled: editingCert.mtls_enabled,
        client_ca_pem: editingCert.client_ca_pem || '',
        verify_depth: editingCert.verify_depth || 1,
        enabled: editingCert.enabled,
        description: editingCert.description || '',
      });
    } else {
      setFormData(DEFAULT_CERTIFICATE_FORM);
    }
  }, [isOpen, editingCert]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const name = formData.name.trim();
    if (!name) {
      setError('Certificate Name is required.');
      return;
    }

    const snis = formData.snisInput
      .split(/[\n,]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    if (snis.length === 0) {
      setError('At least one SNI (domain/hostname) is required (e.g. api.example.com, *.example.com).');
      return;
    }

    const certPem = formData.cert_pem.trim();
    const keyPem = formData.key_pem.trim();

    if (!certPem.includes('BEGIN CERTIFICATE')) {
      setError('Certificate PEM must contain valid "-----BEGIN CERTIFICATE-----" header.');
      return;
    }

    if (!keyPem.includes('BEGIN') || !keyPem.includes('KEY')) {
      setError('Private Key PEM must contain valid "-----BEGIN ... KEY-----" header.');
      return;
    }

    if (formData.mtls_enabled && !formData.client_ca_pem.trim().includes('BEGIN CERTIFICATE')) {
      setError('Client CA PEM is required and must contain "-----BEGIN CERTIFICATE-----" when mTLS is enabled.');
      return;
    }

    setSubmitting(true);
    try {
      if (editingCert) {
        await certificatesApi.update(editingCert.id, {
          name,
          snis,
          cert_pem: certPem,
          key_pem: keyPem,
          mtls_enabled: formData.mtls_enabled,
          client_ca_pem: formData.client_ca_pem.trim(),
          verify_depth: Number(formData.verify_depth) || 1,
          enabled: formData.enabled,
          description: formData.description,
        });
      } else {
        await certificatesApi.create({
          name,
          snis,
          cert_pem: certPem,
          key_pem: keyPem,
          mtls_enabled: formData.mtls_enabled,
          client_ca_pem: formData.client_ca_pem.trim(),
          verify_depth: Number(formData.verify_depth) || 1,
          enabled: formData.enabled,
          description: formData.description,
        });
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to save certificate. Please verify certificate & private key pair.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-card border border-border/80 rounded-2xl shadow-2xl overflow-hidden font-sans">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/70 bg-muted/20">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">
                {editingCert ? 'Edit SSL Certificate' : 'Install SSL Certificate'}
              </h2>
              <p className="text-xs text-muted-foreground">
                Add TLS certificate for SNI matching, wildcard hosts, and mTLS client authentication.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body / Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[82vh] overflow-y-auto">
          {error && (
            <div className="p-3 text-xs bg-destructive/10 border border-destructive/20 text-destructive rounded-lg flex items-center gap-2">
              <span className="font-semibold">Error:</span> {error}
            </div>
          )}

          {/* Certificate Name */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">
              Certificate Name <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Production Wildcard Cert (Cloudflare / Let's Encrypt)"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 text-sm bg-background border border-border/80 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all text-foreground"
            />
          </div>

          {/* SNIs Input */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">
              Server Name Identifiers (SNIs) <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. api.aurora.local, *.aurora.local (comma-separated)"
              value={formData.snisInput}
              onChange={(e) => setFormData({ ...formData, snisInput: e.target.value })}
              className="w-full px-3 py-2 text-sm font-mono bg-background border border-border/80 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all text-foreground"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Supports exact hostnames and wildcard patterns like <code>*.example.com</code>. NGINX matches SNI automatically on TLS handshakes.
            </p>
          </div>

          {/* Certificate PEM & Private Key PEM Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-primary" />
                <span>Certificate PEM (X.509)</span> <span className="text-destructive">*</span>
              </label>
              <textarea
                required
                rows={6}
                placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                value={formData.cert_pem}
                onChange={(e) => setFormData({ ...formData, cert_pem: e.target.value })}
                className="w-full px-3 py-2 text-[11px] font-mono bg-background border border-border/80 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-primary/40 focus:border-primary text-foreground leading-tight"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-amber-400" />
                <span>Private Key PEM (RSA / EC)</span> <span className="text-destructive">*</span>
              </label>
              <textarea
                required
                rows={6}
                placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
                value={formData.key_pem}
                onChange={(e) => setFormData({ ...formData, key_pem: e.target.value })}
                className="w-full px-3 py-2 text-[11px] font-mono bg-background border border-border/80 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-primary/40 focus:border-primary text-foreground leading-tight"
              />
            </div>
          </div>

          {/* mTLS Capability Section */}
          <div className="p-4 bg-muted/30 border border-border/60 rounded-xl space-y-3">
            <label className="flex items-center justify-between cursor-pointer group">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-md bg-amber-500/10 text-amber-400">
                  <Lock className="w-3.5 h-3.5" />
                </div>
                <div>
                  <span className="text-xs font-medium text-foreground block">
                    Mutual TLS (mTLS) Client Verification
                  </span>
                  <span className="text-[11px] text-muted-foreground block">
                    Enforce two-way TLS authentication by validating connecting clients against a trusted CA
                  </span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={formData.mtls_enabled}
                onChange={(e) => setFormData({ ...formData, mtls_enabled: e.target.checked })}
                className="w-4 h-4 text-primary rounded-sm border-border focus:ring-primary cursor-pointer"
              />
            </label>

            {formData.mtls_enabled && (
              <div className="space-y-3 pt-3 border-t border-border/40 animate-in fade-in duration-150">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    Client CA Certificate PEM <span className="text-destructive">*</span>
                  </label>
                  <textarea
                    required={formData.mtls_enabled}
                    rows={4}
                    placeholder="-----BEGIN CERTIFICATE-----&#10;... Client CA Bundle ...&#10;-----END CERTIFICATE-----"
                    value={formData.client_ca_pem}
                    onChange={(e) => setFormData({ ...formData, client_ca_pem: e.target.value })}
                    className="w-full px-3 py-2 text-[11px] font-mono bg-background border border-border/80 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-primary/40 focus:border-primary text-foreground leading-tight"
                  />
                </div>

                <div className="w-48">
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    Verify Depth
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={formData.verify_depth}
                    onChange={(e) => setFormData({ ...formData, verify_depth: parseInt(e.target.value, 10) || 1 })}
                    className="w-full px-3 py-2 text-xs font-mono bg-background border border-border/80 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-primary/40 focus:border-primary text-foreground"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">
              Description (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Edge ingress certificate with automated renewal"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 text-sm bg-background border border-border/80 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all text-foreground"
            />
          </div>

          {/* Enabled Switch */}
          <div className="p-3 bg-muted/20 border border-border/50 rounded-xl">
            <label className="flex items-center justify-between cursor-pointer group">
              <div>
                <span className="text-xs font-medium text-foreground block">
                  Certificate Active Status
                </span>
                <span className="text-[11px] text-muted-foreground block">
                  Only active certificates will be materialized to disk and bound to NGINX SSL blocks
                </span>
              </div>
              <input
                type="checkbox"
                checked={formData.enabled}
                onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                className="w-4 h-4 text-primary rounded-sm border-border focus:ring-primary cursor-pointer"
              />
            </label>
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border/70">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-foreground bg-muted hover:bg-muted/80 rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-medium text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
            >
              {submitting ? 'Saving...' : editingCert ? 'Update Certificate' : 'Save Certificate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
