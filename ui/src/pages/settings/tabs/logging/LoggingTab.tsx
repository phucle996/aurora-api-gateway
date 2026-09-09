import React from 'react';
import { LoggingSettingsSection } from './sections/LoggingSettingsSection';

export function LoggingTab() {
  return (
    <div className="space-y-6 w-full font-sans">
      <LoggingSettingsSection />
    </div>
  );
}
