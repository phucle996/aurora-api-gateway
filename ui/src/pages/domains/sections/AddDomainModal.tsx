import React, { useState } from 'react';
import { X, Globe, Shield, Server, Tag, Info } from 'lucide-react';
import type { DomainItem, TlsType, DomainStatus } from '../types';

interface AddDomainModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (newDomain: Omit<DomainItem, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'rulesCount' | 'policiesCount' | 'ipRulesCount' | 'rateLimitsCount'>) => void;
}

export function AddDomainModal({ isOpen, onClose, onAdd }: AddDomainModalProps) {
  const [domain, setDomain] = useState('');
  const [rootDomain, setRootDomain] = useState('');
  const [status, setStatus] = useState<DomainStatus>('Active');
  const [tlsType, setTlsType] = useState<TlsType>("Let's Encrypt");
  const [upstream, setUpstream] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [description, setDescription] = useState('');

  if (!isOpen) return null;

  // Auto-fill root domain when domain changes
  const handleDomainChange = (val: string) => {
    setDomain(val);
    const trimmed = val.trim();
    if (trimmed === '*') {
      setRootDomain('*');
      return;
    }
    const clean = trimmed.startsWith('*.') ? trimmed.slice(2) : trimmed;
    const parts = clean.split('.');
    if (parts.length >= 2) {
      setRootDomain(parts.slice(-2).join('.'));
    } else {
      setRootDomain(clean);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!domain.trim() || !upstream.trim()) return;

    const tags = tagsInput
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    onAdd({
      domain: domain.trim(),
      rootDomain: rootDomain.trim() || domain.trim(),
      status,
      tlsType,
      upstream: upstream.trim(),
      tags,
      description: description.trim(),
      hstsEnabled: true,
      minTlsVersion: 'TLSv1.3',
      tlsAutoRenew: true,
      upstreamAlgorithm: 'round_robin',
    });

    // Reset
    setDomain('');
    setRootDomain('');
    setUpstream('');
    setTagsInput('');
    setDescription('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg bg-card border border-border rounded-xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-foreground">Add New Domain</h3>
              <p className="text-xs text-muted-foreground">
                Configure your routing, TLS security, and target upstream origin.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          {/* Domain & Root Domain */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-foreground mb-1">
                Domain / Subdomain <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. api.example.com, *.example.com, or *"
                value={domain}
                onChange={(e) => handleDomainChange(e.target.value)}
                className="w-full bg-background border border-input text-foreground px-3 py-2 rounded-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
              />
            </div>

            <div>
              <label className="block font-medium text-foreground mb-1">
                Root Domain
              </label>
              <input
                type="text"
                placeholder="e.g. example.com"
                value={rootDomain}
                onChange={(e) => setRootDomain(e.target.value)}
                className="w-full bg-background border border-input text-foreground px-3 py-2 rounded-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
              />
            </div>
          </div>

          {domain.trim().startsWith('*.') && (
            <div className="p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 text-xs flex items-center gap-2">
              <Info className="w-4 h-4 shrink-0" />
              <span>Wildcard Subdomain: Protects all subdomains under <strong>{rootDomain}</strong> and the apex domain.</span>
            </div>
          )}
          {domain.trim() === '*' && (
            <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs flex items-center gap-2">
              <Info className="w-4 h-4 shrink-0" />
              <span>Global Catch-All (*): Matches all unmatched incoming HTTP host requests.</span>
            </div>
          )}

          {/* Upstream URL */}
          <div>
            <label className="block font-medium text-foreground mb-1">
              Upstream Target Origin <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. http://10.0.1.10:8080 or https://internal.srv:8443"
              value={upstream}
              onChange={(e) => setUpstream(e.target.value)}
              className="w-full font-mono bg-background border border-input text-foreground px-3 py-2 rounded-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
            />
          </div>

          {/* TLS & Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-foreground mb-1">
                TLS / Security Mode
              </label>
              <select
                value={tlsType}
                onChange={(e) => setTlsType(e.target.value as TlsType)}
                className="w-full bg-background border border-input text-foreground px-3 py-2 rounded-md focus:outline-none focus:border-primary cursor-pointer"
              >
                <option value="Let's Encrypt">Let's Encrypt (Automated ACME)</option>
                <option value="Custom Cert">Custom Certificate (PEM / Key)</option>
                <option value="mTLS">mTLS (Mutual TLS with Client CA)</option>
                <option value="Self-signed">Self-signed (Development)</option>
              </select>
            </div>

            <div>
              <label className="block font-medium text-foreground mb-1">
                Initial Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as DomainStatus)}
                className="w-full bg-background border border-input text-foreground px-3 py-2 rounded-md focus:outline-none focus:border-primary cursor-pointer"
              >
                <option value="Active">Active (Live Traffic)</option>
                <option value="Inactive">Inactive (Disabled)</option>
              </select>
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block font-medium text-foreground mb-1">
              Tags (Comma separated)
            </label>
            <input
              type="text"
              placeholder="e.g. api, prod, internal"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              className="w-full bg-background border border-input text-foreground px-3 py-2 rounded-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block font-medium text-foreground mb-1">
              Description
            </label>
            <textarea
              rows={2}
              placeholder="Brief description about the purpose of this domain..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-background border border-input text-foreground px-3 py-2 rounded-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 resize-none"
            />
          </div>

          {/* Footer Buttons */}
          <div className="pt-3 border-t border-border flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-md border border-border hover:bg-muted text-foreground font-medium transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground font-medium shadow-xs transition-colors cursor-pointer"
            >
              Create Domain
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
