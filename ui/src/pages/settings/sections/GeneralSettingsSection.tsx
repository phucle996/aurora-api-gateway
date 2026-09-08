import React, { useState, useEffect } from 'react';
import { Info, Monitor, RefreshCw } from 'lucide-react';
import { useTheme, type Theme } from '../../../components/theme-provider';
import { systemApi, type SystemInfo } from '../../../lib/api';

export function GeneralSettingsSection() {
  const { theme, setTheme } = useTheme();
  const [language, setLanguage] = useState('English');
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

  const selectCls = 'bg-background border border-input px-2.5 py-1 text-foreground text-xs focus:outline-none focus:border-primary cursor-pointer';
  const rowCls = 'flex items-center justify-between py-1 border-b border-border';

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {/* System Information Card */}
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
              <span className="text-foreground font-semibold">{sysInfo?.product || 'AURORA WAF'}</span>
            </div>
            <div className={rowCls}>
              <span className="text-muted-foreground">Version</span>
              <span className="text-foreground font-mono">{sysInfo?.version || 'v2024.11.3'}</span>
            </div>
            <div className={rowCls}>
              <span className="text-muted-foreground">Build</span>
              <span className="text-foreground font-mono">{sysInfo?.build || '2026-09-07'}</span>
            </div>
            <div className={rowCls}>
              <span className="text-muted-foreground">Uptime</span>
              <span className="text-foreground">{sysInfo?.uptime_formatted || 'Calculating...'}</span>
            </div>
            <div className={rowCls}>
              <span className="text-muted-foreground">Architecture</span>
              <span className="text-foreground font-mono">{sysInfo?.architecture || 'linux/amd64'}</span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-muted-foreground">State Persistence</span>
              <span className="text-foreground">{sysInfo?.state_persistence || 'SQLite'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Web Interface Card */}
      <div className="bg-card border border-border p-4 flex flex-col justify-between shadow-xs">
        <div>
          <div className="flex items-center gap-2 pb-3 border-b border-border text-sm font-semibold text-foreground">
            <Monitor className="w-4 h-4 text-primary" />
            <span>Web Interface</span>
          </div>

          <div className="mt-3 space-y-3 text-xs">
            {/* Theme */}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Theme</span>
              <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)} className={selectCls}>
                <option value="dark">Dark (Default)</option>
                <option value="light">Light</option>
                <option value="system">System Preference</option>
              </select>
            </div>

            {/* Language */}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Language</span>
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className={selectCls}>
                <option value="English">English</option>
                <option value="Tiếng Việt">Tiếng Việt</option>
                <option value="日本語">日本語</option>
                <option value="Deutsch">Deutsch</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
