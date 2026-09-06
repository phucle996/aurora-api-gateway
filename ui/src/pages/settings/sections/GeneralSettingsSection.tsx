import React, { useState } from 'react';
import { Info, Monitor, Check } from 'lucide-react';
import { useTheme, type Theme } from '../../../components/theme-provider';

// Reusable toggle button for settings
function Toggle({ value, onChange }: { value: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`w-9 h-5 flex items-center p-0.5 cursor-pointer transition-colors ${
        value ? 'bg-primary' : 'bg-muted border border-border'
      }`}
    >
      <div
        className={`w-4 h-4 bg-white transition-transform ${
          value ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

export function GeneralSettingsSection() {
  const { theme, setTheme } = useTheme();
  const [language, setLanguage] = useState('English');
  const [sessionTimeout, setSessionTimeout] = useState('30 minutes');
  const [refreshInterval, setRefreshInterval] = useState('10 seconds');
  const [showWelcomeBanner, setShowWelcomeBanner] = useState(true);
  const [enableCommandPalette, setEnableCommandPalette] = useState(true);
  const [compactMode, setCompactMode] = useState(false);

  const selectCls = 'bg-background border border-input px-2.5 py-1 text-foreground text-xs focus:outline-none focus:border-primary cursor-pointer';
  const rowCls = 'flex items-center justify-between py-1 border-b border-border';

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {/* System Information Card */}
      <div className="bg-card border border-border p-4 flex flex-col justify-between shadow-xs">
        <div>
          <div className="flex items-center gap-2 pb-3 border-b border-border text-sm font-semibold text-foreground">
            <Info className="w-4 h-4 text-primary" />
            <span>System Information</span>
          </div>

          <div className="mt-3 space-y-2.5 text-xs">
            <div className={rowCls}>
              <span className="text-muted-foreground">Product</span>
              <span className="text-foreground font-semibold">AURORA WAF</span>
            </div>
            <div className={rowCls}>
              <span className="text-muted-foreground">Version</span>
              <span className="text-foreground font-mono">v2024.11.3</span>
            </div>
            <div className={rowCls}>
              <span className="text-muted-foreground">Build</span>
              <span className="text-foreground font-mono">2026-09-05 08:30:12</span>
            </div>
            <div className={rowCls}>
              <span className="text-muted-foreground">License</span>
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center px-2 py-0.5 bg-primary/10 border border-primary/30 text-primary text-[10px]">
                  Enterprise
                </span>
                <Info className="w-3 h-3 text-muted-foreground cursor-pointer" />
              </div>
            </div>
            <div className={rowCls}>
              <span className="text-muted-foreground">Uptime</span>
              <span className="text-foreground">14 days 6 hours</span>
            </div>
            <div className={rowCls}>
              <span className="text-muted-foreground">Cluster Architecture</span>
              <span className="text-foreground">HA NGINX Cluster</span>
            </div>
            <div className={rowCls}>
              <span className="text-muted-foreground">HA Gateway</span>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-emerald-500 inline-block" />
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold font-mono">aurora-lb (:8090)</span>
              </div>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-muted-foreground">State Persistence</span>
              <span className="text-foreground">SQLite (WAL Mode)</span>
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

            {/* Session Timeout */}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Session Timeout</span>
              <select value={sessionTimeout} onChange={(e) => setSessionTimeout(e.target.value)} className={selectCls}>
                <option value="15 minutes">15 minutes</option>
                <option value="30 minutes">30 minutes</option>
                <option value="1 hour">1 hour</option>
                <option value="4 hours">4 hours</option>
              </select>
            </div>

            {/* Refresh Interval */}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Refresh Interval</span>
              <select value={refreshInterval} onChange={(e) => setRefreshInterval(e.target.value)} className={selectCls}>
                <option value="5 seconds">5 seconds</option>
                <option value="10 seconds">10 seconds</option>
                <option value="30 seconds">30 seconds</option>
                <option value="Manual">Manual</option>
              </select>
            </div>

            <div className="pt-2 border-t border-border space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Show Welcome Banner</span>
                <Toggle value={showWelcomeBanner} onChange={() => setShowWelcomeBanner(!showWelcomeBanner)} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Enable Command Palette</span>
                <Toggle value={enableCommandPalette} onChange={() => setEnableCommandPalette(!enableCommandPalette)} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Compact Mode</span>
                <Toggle value={compactMode} onChange={() => setCompactMode(!compactMode)} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
