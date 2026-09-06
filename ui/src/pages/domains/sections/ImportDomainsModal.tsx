import React, { useState } from 'react';
import { Upload, X, FileText, AlertCircle } from 'lucide-react';
import type { DomainItem } from '../types';

interface ImportDomainsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (domains: DomainItem[]) => void;
}

export function ImportDomainsModal({
  isOpen,
  onClose,
  onImport,
}: ImportDomainsModalProps) {
  const [importText, setImportText] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleImportSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const lines = importText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

      if (lines.length === 0) {
        setError('Please enter at least one domain or JSON list.');
        return;
      }

      // Try JSON parse first
      if (importText.trim().startsWith('[') || importText.trim().startsWith('{')) {
        const parsed = JSON.parse(importText);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        const newDomains: DomainItem[] = list.map((item: any, idx: number) => ({
          id: `imp-${Date.now()}-${idx}`,
          domain: item.domain || 'imported.example.com',
          rootDomain: item.rootDomain || 'example.com',
          status: item.status || 'Active',
          tlsType: item.tlsType || "Let's Encrypt",
          upstream: item.upstream || 'http://127.0.0.1:8080',
          rulesCount: item.rulesCount || 0,
          policiesCount: item.policiesCount || 0,
          ipRulesCount: item.ipRulesCount || 0,
          rateLimitsCount: item.rateLimitsCount || 0,
          tags: item.tags || [],
          createdAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
          updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
          createdBy: 'admin',
          description: item.description || 'Imported via JSON batch',
        }));
        onImport(newDomains);
        onClose();
        return;
      }

      // Otherwise parse line by line (domain,upstream or just domain)
      const newDomains: DomainItem[] = lines.map((line, idx) => {
        const [dom, ups] = line.split(',').map((s) => s.trim());
        const root = dom.split('.').slice(-2).join('.');
        return {
          id: `imp-${Date.now()}-${idx}`,
          domain: dom,
          rootDomain: root,
          status: 'Active',
          tlsType: "Let's Encrypt",
          upstream: ups || 'http://127.0.0.1:8080',
          rulesCount: 0,
          policiesCount: 0,
          ipRulesCount: 0,
          rateLimitsCount: 0,
          tags: [],
          createdAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
          updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
          createdBy: 'admin',
          description: 'Batch imported from text',
        };
      });

      onImport(newDomains);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to parse import data');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg bg-card border border-border rounded-xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-foreground">Import Domains</h3>
              <p className="text-xs text-muted-foreground">
                Paste a list of domain names or JSON configuration array.
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

        <form onSubmit={handleImportSubmit} className="p-6 space-y-4 text-xs">
          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 text-destructive border border-destructive/20 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block font-medium text-foreground mb-1">
              Domain List / CSV / JSON
            </label>
            <textarea
              rows={6}
              required
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={`# Example CSV format:\napi.example.com, http://10.0.1.10:8080\nauth.example.com, https://auth.internal:8443\n\n# Or JSON array:\n[{"domain": "shop.example.com", "upstream": "http://10.0.1.12:8080"}]`}
              className="w-full font-mono text-xs bg-background border border-input text-foreground p-3 rounded-md focus:outline-none focus:border-primary resize-none"
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
              className="px-4 py-2 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground font-medium shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" />
              Import Now
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
