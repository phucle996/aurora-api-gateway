import React, { useState } from 'react';
import { Info, Monitor, ShieldCheck, Check } from 'lucide-react';

export function GeneralSettingsSection() {
  const [theme, setTheme] = useState('Dark (Default)');
  const [language, setLanguage] = useState('English');
  const [sessionTimeout, setSessionTimeout] = useState('30 minutes');
  const [refreshInterval, setRefreshInterval] = useState('10 seconds');
  const [showWelcomeBanner, setShowWelcomeBanner] = useState(true);
  const [enableCommandPalette, setEnableCommandPalette] = useState(true);
  const [compactMode, setCompactMode] = useState(false);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {/* System Information Card */}
      <div className="bg-[#0B1320] border border-[#152030] p-4 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-2 pb-3 border-b border-[#152030] text-sm font-semibold text-white font-mono">
            <Info className="w-4 h-4 text-emerald-400" />
            <span>System Information</span>
          </div>

          <div className="mt-3 space-y-2.5 text-xs font-mono">
            <div className="flex items-center justify-between py-1 border-b border-[#152030]/60">
              <span className="text-slate-400">Product</span>
              <span className="text-slate-100 font-semibold">AURORA WAF</span>
            </div>

            <div className="flex items-center justify-between py-1 border-b border-[#152030]/60">
              <span className="text-slate-400">Version</span>
              <span className="text-slate-200">v2024.11.3</span>
            </div>

            <div className="flex items-center justify-between py-1 border-b border-[#152030]/60">
              <span className="text-slate-400">Build</span>
              <span className="text-slate-300">2026-09-05 08:30:12</span>
            </div>

            <div className="flex items-center justify-between py-1 border-b border-[#152030]/60">
              <span className="text-slate-400">License</span>
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center px-2 py-0.5 bg-emerald-950/60 border border-emerald-500/50 text-emerald-400 text-[10px]">
                  Enterprise
                </span>
                <Info className="w-3 h-3 text-slate-500 cursor-pointer" />
              </div>
            </div>

            <div className="flex items-center justify-between py-1 border-b border-[#152030]/60">
              <span className="text-slate-400">Uptime</span>
              <span className="text-slate-200">14 days 6 hours</span>
            </div>

            <div className="flex items-center justify-between py-1 border-b border-[#152030]/60">
              <span className="text-slate-400">Cluster Architecture</span>
              <span className="text-slate-200">HA NGINX Cluster</span>
            </div>

            <div className="flex items-center justify-between py-1 border-b border-[#152030]/60">
              <span className="text-slate-400">HA Gateway</span>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-emerald-400 inline-block" />
                <span className="text-emerald-400 font-semibold">aurora-lb (:8090)</span>
              </div>
            </div>

            <div className="flex items-center justify-between py-1">
              <span className="text-slate-400">State Persistence</span>
              <span className="text-slate-200">SQLite (WAL Mode)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Web Interface Card */}
      <div className="bg-[#0B1320] border border-[#152030] p-4 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-2 pb-3 border-b border-[#152030] text-sm font-semibold text-white font-mono">
            <Monitor className="w-4 h-4 text-emerald-400" />
            <span>Web Interface</span>
          </div>

          <div className="mt-3 space-y-3 text-xs font-mono">
            {/* Theme */}
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Theme</span>
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                className="bg-[#0E1726] border border-[#1C293D] px-2.5 py-1 text-slate-200 text-xs focus:outline-none focus:border-emerald-500 cursor-pointer"
              >
                <option value="Dark (Default)">Dark (Default)</option>
                <option value="Cyber Slate">Cyber Slate</option>
                <option value="Midnight High-Contrast">Midnight High-Contrast</option>
              </select>
            </div>

            {/* Language */}
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Language</span>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="bg-[#0E1726] border border-[#1C293D] px-2.5 py-1 text-slate-200 text-xs focus:outline-none focus:border-emerald-500 cursor-pointer"
              >
                <option value="English">English</option>
                <option value="Tiếng Việt">Tiếng Việt</option>
                <option value="日本語">日本語</option>
                <option value="Deutsch">Deutsch</option>
              </select>
            </div>

            {/* Session Timeout */}
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Session Timeout</span>
              <select
                value={sessionTimeout}
                onChange={(e) => setSessionTimeout(e.target.value)}
                className="bg-[#0E1726] border border-[#1C293D] px-2.5 py-1 text-slate-200 text-xs focus:outline-none focus:border-emerald-500 cursor-pointer"
              >
                <option value="15 minutes">15 minutes</option>
                <option value="30 minutes">30 minutes</option>
                <option value="1 hour">1 hour</option>
                <option value="4 hours">4 hours</option>
              </select>
            </div>

            {/* Refresh Interval */}
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Refresh Interval</span>
              <select
                value={refreshInterval}
                onChange={(e) => setRefreshInterval(e.target.value)}
                className="bg-[#0E1726] border border-[#1C293D] px-2.5 py-1 text-slate-200 text-xs focus:outline-none focus:border-emerald-500 cursor-pointer"
              >
                <option value="5 seconds">5 seconds</option>
                <option value="10 seconds">10 seconds</option>
                <option value="30 seconds">30 seconds</option>
                <option value="Manual">Manual</option>
              </select>
            </div>

            <div className="pt-2 border-t border-[#152030]/60 space-y-2.5">
              {/* Show Welcome Banner */}
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Show Welcome Banner</span>
                <button
                  type="button"
                  onClick={() => setShowWelcomeBanner(!showWelcomeBanner)}
                  className={`w-9 h-5 flex items-center p-0.5 cursor-pointer transition-colors ${
                    showWelcomeBanner ? 'bg-emerald-600' : 'bg-[#152030]'
                  }`}
                >
                  <div
                    className={`w-4 h-4 bg-white transition-transform ${
                      showWelcomeBanner ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Enable Command Palette */}
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Enable Command Palette</span>
                <button
                  type="button"
                  onClick={() => setEnableCommandPalette(!enableCommandPalette)}
                  className={`w-9 h-5 flex items-center p-0.5 cursor-pointer transition-colors ${
                    enableCommandPalette ? 'bg-emerald-600' : 'bg-[#152030]'
                  }`}
                >
                  <div
                    className={`w-4 h-4 bg-white transition-transform ${
                      enableCommandPalette ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Compact Mode */}
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Compact Mode</span>
                <button
                  type="button"
                  onClick={() => setCompactMode(!compactMode)}
                  className={`w-9 h-5 flex items-center p-0.5 cursor-pointer transition-colors ${
                    compactMode ? 'bg-emerald-600' : 'bg-[#152030]'
                  }`}
                >
                  <div
                    className={`w-4 h-4 bg-white transition-transform ${
                      compactMode ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
