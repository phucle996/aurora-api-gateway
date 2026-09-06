import React, { useState, useEffect } from 'react';
import { X, Globe, Pencil } from 'lucide-react';
import type { DomainItem, TlsType, DomainStatus } from '../types';

interface EditDomainModalProps {
  isOpen: boolean;
  domain: DomainItem | null;
  onClose: () => void;
  onSave: (updated: DomainItem) => void;
}

export function EditDomainModal({
  isOpen,
  domain,
  onClose,
  onSave,
}: EditDomainModalProps) {
  const [domainName, setDomainName] = useState('');
  const [rootDomain, setRootDomain] = useState('');
  const [status, setStatus] = useState<DomainStatus>('Active');
  const [tlsType, setTlsType] = useState<TlsType>("Let's Encrypt");
  const [upstream, setUpstream] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (domain) {
      setDomainName(domain.domain);
      setRootDomain(domain.rootDomain);
      setStatus(domain.status);
      setTlsType(domain.tlsType);
      setUpstream(domain.upstream);
      setTagsInput(domain.tags.join(', '));
      setDescription(domain.description || '');
    }
  }, [domain]);

  if (!isOpen || !domain) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!domainName.trim() || !upstream.trim()) return;

    const tags = tagsInput
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    onSave({
      ...domain,
      domain: domainName.trim(),
      rootDomain: rootDomain.trim() || domainName.trim(),
      status,
      tlsType,
      upstream: upstream.trim(),
      tags: tags.length > 0 ? tags : domain.tags,
      description: description.trim(),
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg bg-card border border-border rounded-xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400">
              <Pencil className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-foreground">Edit Domain</h3>
              <p className="text-xs text-muted-foreground">
                Update configuration for {domain.domain}
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

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-foreground mb-1">
                Domain / Subdomain
              </label>
              <input
                type="text"
                required
                value={domainName}
                onChange={(e) => setDomainName(e.target.value)}
                className="w-full bg-background border border-input text-foreground px-3 py-2 rounded-md focus:outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="block font-medium text-foreground mb-1">
                Root Domain
              </label>
              <input
                type="text"
                value={rootDomain}
                onChange={(e) => setRootDomain(e.target.value)}
                className="w-full bg-background border border-input text-foreground px-3 py-2 rounded-md focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          <div>
            <label className="block font-medium text-foreground mb-1">
              Upstream Target Origin
            </label>
            <input
              type="text"
              required
              value={upstream}
              onChange={(e) => setUpstream(e.target.value)}
              className="w-full font-mono bg-background border border-input text-foreground px-3 py-2 rounded-md focus:outline-none focus:border-primary"
            />
          </div>

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
                Status
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

          <div>
            <label className="block font-medium text-foreground mb-1">
              Tags (Comma separated)
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              className="w-full bg-background border border-input text-foreground px-3 py-2 rounded-md focus:outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="block font-medium text-foreground mb-1">
              Description
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-background border border-input text-foreground px-3 py-2 rounded-md focus:outline-none focus:border-primary resize-none"
            />
          </div>

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
              className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-xs transition-colors cursor-pointer"
            >
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
