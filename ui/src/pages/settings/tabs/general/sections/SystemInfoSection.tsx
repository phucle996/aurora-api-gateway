import React, { useState, useEffect } from 'react';
import { Info, RefreshCw } from 'lucide-react';
import { systemApi, type SystemInfo } from '../../../../../lib/api';

export function SystemInfoSection() {
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    systemApi
      .getInfo()
      .then((data) => {
        if (mounted) {
          setSysInfo(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('Failed to load real system info:', err);
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const rowCls = 'flex items-center justify-between py-1 border-b border-border';

  return (
    <div className="bg-card border border-border p-4 flex flex-col justify-between shadow-xs">
      <div>
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Info className="w-4 h-4 text-primary" />
            <span>System Information</span>
          </div>
          {loading && (
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
          )}
        </div>

        <div className="mt-3 space-y-2.5 text-xs">
          <div className={rowCls}>
            <span className="text-muted-foreground">Product</span>
            <span className="text-foreground font-semibold">{sysInfo?.product ?? (loading ? '...' : '—')}</span>
          </div>
          <div className={rowCls}>
            <span className="text-muted-foreground">Version</span>
            <span className="text-foreground font-mono">{sysInfo?.version ?? (loading ? '...' : '—')}</span>
          </div>
          <div className={rowCls}>
            <span className="text-muted-foreground">Build</span>
            <span className="text-foreground font-mono">{sysInfo?.build ?? (loading ? '...' : '—')}</span>
          </div>
          <div className={rowCls}>
            <span className="text-muted-foreground">Uptime</span>
            <span className="text-foreground">{sysInfo?.uptime_formatted ?? (loading ? '...' : '—')}</span>
          </div>
          <div className={rowCls}>
            <span className="text-muted-foreground">Architecture</span>
            <span className="text-foreground font-mono">{sysInfo?.architecture ?? (loading ? '...' : '—')}</span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-muted-foreground">State Persistence</span>
            <span className="text-foreground">{sysInfo?.state_persistence ?? (loading ? '...' : '—')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
