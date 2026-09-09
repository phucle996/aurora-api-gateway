import React, { useState } from 'react';
import { Monitor } from 'lucide-react';
import { useTheme, type Theme } from '../../../../../components/theme-provider';

export function WebInterfaceSection() {
  const { theme, setTheme } = useTheme();
  const [language, setLanguage] = useState('English');

  const selectCls = 'bg-background border border-input px-2.5 py-1 text-foreground text-xs focus:outline-none focus:border-primary cursor-pointer';

  return (
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
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as Theme)}
              className={selectCls}
            >
              <option value="dark">Dark (Default)</option>
              <option value="light">Light</option>
              <option value="system">System Preference</option>
            </select>
          </div>

          {/* Language */}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Language</span>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className={selectCls}
            >
              <option value="English">English</option>
              <option value="Tiếng Việt">Tiếng Việt</option>
              <option value="日本語">日本語</option>
              <option value="Deutsch">Deutsch</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
