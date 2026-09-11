import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Plus, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import type { CertificateItem } from './types';
import { certificatesApi } from '../../lib/api/certificates';
import { CertificateStats } from './sections/CertificateStats';
import { CertificateTable } from './sections/CertificateTable';
import { CertificateModal } from './sections/CertificateModal';
import { DeleteCertificateDialog } from './sections/DeleteCertificateDialog';

export default function CertificatesPage() {
  const [certificates, setCertificates] = useState<CertificateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statFilter, setStatFilter] = useState<string | null>(null);

  // Modals state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCert, setEditingCert] = useState<CertificateItem | null>(null);
  const [deletingCert, setDeletingCert] = useState<CertificateItem | null>(null);
  const [togglingIds, setTogglingIds] = useState<Record<string, boolean>>({});

  const requestSequence = useRef(0);

  const fetchCertificates = useCallback(async (showSpin = false) => {
    const seq = ++requestSequence.current;
    if (showSpin) setIsRefreshing(true);

    try {
      const res = await certificatesApi.list({ limit: 200 });
      if (seq === requestSequence.current) {
        setCertificates(res.items || []);
        setError(null);
      }
    } catch (err: any) {
      if (seq === requestSequence.current) {
        setError(err?.message || 'Failed to load certificates from backend');
      }
    } finally {
      if (seq === requestSequence.current) {
        setLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void fetchCertificates();
    const interval = setInterval(() => void fetchCertificates(), 5000);
    return () => {
      clearInterval(interval);
      requestSequence.current++;
    };
  }, [fetchCertificates]);

  // Filtered certificates
  const filteredCertificates = useMemo(() => {
    return certificates.filter((c) => {
      // Search match (name, SNIs, ID, description)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          c.name.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q) ||
          c.snis_json.toLowerCase().includes(q) ||
          (c.description && c.description.toLowerCase().includes(q));
        if (!match) return false;
      }

      // Stat filter
      if (statFilter === 'active' && !c.enabled) return false;
      if (statFilter === 'mtls' && !c.mtls_enabled) return false;
      if (statFilter === 'wildcard') {
        try {
          const snis: string[] = JSON.parse(c.snis_json || '[]');
          if (!snis.some((s) => s.includes('*'))) return false;
        } catch {
          return false;
        }
      }

      return true;
    });
  }, [certificates, searchQuery, statFilter]);

  // Optimistic toggle handler
  const handleToggle = async (cert: CertificateItem, nextEnabled: boolean) => {
    setTogglingIds((prev) => ({ ...prev, [cert.id]: true }));
    setCertificates((prev) =>
      prev.map((c) => (c.id === cert.id ? { ...c, enabled: nextEnabled } : c))
    );

    try {
      await certificatesApi.toggle(cert.id, nextEnabled);
    } catch (err) {
      console.error('Failed to toggle certificate:', err);
      setCertificates((prev) =>
        prev.map((c) => (c.id === cert.id ? { ...c, enabled: !nextEnabled } : c))
      );
    } finally {
      setTogglingIds((prev) => {
        const next = { ...prev };
        delete next[cert.id];
        return next;
      });
    }
  };

  return (
    <div className="p-6 space-y-6 w-full font-sans">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                SSL Certificates & mTLS
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Manage X.509 SSL/TLS certificates, SNI hostname bindings, and Mutual TLS client authentication.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => fetchCertificates(true)}
            disabled={isRefreshing}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted/70 rounded-xl transition-colors cursor-pointer border border-border/70 bg-card/60"
            title="Refresh certificates"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => {
              setEditingCert(null);
              setIsModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Install Certificate</span>
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <CertificateStats
        certificates={certificates}
        selectedFilter={statFilter}
        onSelectFilter={setStatFilter}
      />

      {/* Controls Bar: Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-card/50 border border-border/60 p-3 rounded-xl backdrop-blur-xs">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search by name, SNI domain, certificate ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-background/80 border border-border/80 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-primary/40 focus:border-primary text-foreground"
          />
        </div>

        {statFilter && (
          <button
            type="button"
            onClick={() => setStatFilter(null)}
            className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground bg-muted/60 hover:bg-muted rounded-lg transition-colors cursor-pointer"
          >
            Clear Filter ({statFilter})
          </button>
        )}
      </div>

      {/* Error alert */}
      {error && (
        <div className="p-3.5 text-xs bg-destructive/10 border border-destructive/20 text-destructive rounded-xl flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => fetchCertificates(true)}
            className="underline hover:text-destructive/80 cursor-pointer font-medium ml-2"
          >
            Retry
          </button>
        </div>
      )}

      {/* Main Table */}
      {loading && certificates.length === 0 ? (
        <div className="p-12 text-center text-xs text-muted-foreground bg-card/40 border border-border/60 rounded-xl">
          <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-primary" />
          Loading certificate store...
        </div>
      ) : (
        <CertificateTable
          certificates={filteredCertificates}
          onEdit={(c) => {
            setEditingCert(c);
            setIsModalOpen(true);
          }}
          onDelete={(c) => setDeletingCert(c)}
          onToggle={handleToggle}
          togglingIds={togglingIds}
        />
      )}

      {/* Install / Edit Modal */}
      <CertificateModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => void fetchCertificates()}
        editingCert={editingCert}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteCertificateDialog
        isOpen={Boolean(deletingCert)}
        cert={deletingCert}
        onClose={() => setDeletingCert(null)}
        onSuccess={() => void fetchCertificates()}
      />
    </div>
  );
}
