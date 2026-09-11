import React from 'react';
import { ShieldCheck, Pencil, Trash2, Lock, Globe, FileKey } from 'lucide-react';
import type { CertificateItem } from '../types';

interface CertificateTableProps {
  certificates: CertificateItem[];
  onEdit: (cert: CertificateItem) => void;
  onDelete: (cert: CertificateItem) => void;
  onToggle: (cert: CertificateItem, enabled: boolean) => void;
  togglingIds: Record<string, boolean>;
}

export function CertificateTable({
  certificates,
  onEdit,
  onDelete,
  onToggle,
  togglingIds,
}: CertificateTableProps) {
  if (certificates.length === 0) {
    return (
      <div className="bg-card/70 border border-border/70 rounded-xl p-12 text-center">
        <div className="mx-auto w-12 h-12 rounded-xl bg-muted/60 flex items-center justify-center text-muted-foreground mb-3">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">No SSL certificates found</h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
          No certificates match your query. Install a certificate with SNI bindings to enable HTTPS and HTTP/2 on your domains.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-card/80 border border-border/80 rounded-xl overflow-hidden shadow-xs backdrop-blur-xs">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-muted/40 border-b border-border/70 text-muted-foreground uppercase font-mono text-[10px] tracking-wider">
            <tr>
              <th className="py-3 px-4 w-4/12">Certificate Name</th>
              <th className="py-3 px-4 w-4/12">Bound SNIs (Hostnames)</th>
              <th className="py-3 px-4 w-2/12">Security & mTLS</th>
              <th className="py-3 px-4 w-1/12 text-center">Status</th>
              <th className="py-3 px-4 w-1/12 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {certificates.map((cert) => {
              const isToggling = Boolean(togglingIds[cert.id]);
              let snis: string[] = [];
              try {
                snis = JSON.parse(cert.snis_json || '[]');
              } catch {
                snis = [];
              }

              return (
                <tr
                  key={cert.id}
                  className={`group hover:bg-muted/30 transition-colors duration-150 ${
                    !cert.enabled ? 'opacity-70 hover:opacity-100' : ''
                  }`}
                >
                  {/* Name & ID */}
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0 transition-transform duration-200 group-hover:scale-105">
                        <ShieldCheck className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground truncate">
                            {cert.name}
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-sm shrink-0">
                            {cert.id}
                          </span>
                        </div>
                        {cert.description ? (
                          <p className="text-[11px] text-muted-foreground truncate mt-0.5 max-w-xs">
                            {cert.description}
                          </p>
                        ) : (
                          <p className="text-[11px] text-muted-foreground/60 font-mono truncate mt-0.5">
                            Installed {new Date(cert.created_at).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Bound SNIs */}
                  <td className="py-3.5 px-4">
                    <div className="flex flex-wrap items-center gap-1.5 max-w-md">
                      {snis.map((sni) => {
                        const isWildcard = sni.includes('*');
                        return (
                          <span
                            key={sni}
                            className={`inline-flex items-center gap-1 font-mono text-[11px] px-2 py-0.5 rounded-md border ${
                              isWildcard
                                ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20 font-medium'
                                : 'bg-muted/60 text-foreground border-border/80'
                            }`}
                          >
                            <Globe className="w-3 h-3 text-muted-foreground" />
                            {sni}
                          </span>
                        );
                      })}
                      {snis.length === 0 && (
                        <span className="text-muted-foreground italic text-xs">No SNIs specified</span>
                      )}
                    </div>
                  </td>

                  {/* Security & mTLS */}
                  <td className="py-3.5 px-4">
                    <div className="space-y-1">
                      {cert.mtls_enabled ? (
                        <span className="inline-flex items-center gap-1 font-mono text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-md">
                          <Lock className="w-3 h-3" /> mTLS Active (Depth: {cert.verify_depth})
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-md">
                          <FileKey className="w-3 h-3" /> Standard TLS
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Status Toggle */}
                  <td className="py-3.5 px-4 text-center">
                    <button
                      type="button"
                      disabled={isToggling}
                      onClick={() => onToggle(cert, !cert.enabled)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                        cert.enabled ? 'bg-emerald-500' : 'bg-muted'
                      } ${isToggling ? 'opacity-50' : ''}`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                          cert.enabled ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </td>

                  {/* Actions */}
                  <td className="py-3.5 px-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => onEdit(cert)}
                        title="Edit Certificate"
                        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/70 rounded-lg transition-colors cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(cert)}
                        title="Delete Certificate"
                        className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
