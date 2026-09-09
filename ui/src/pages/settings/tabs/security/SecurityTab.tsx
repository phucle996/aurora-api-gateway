import React from 'react';
import { SecuritySettingsSection } from './sections/SecuritySettingsSection';

export function SecurityTab() {
  return (
    <div className="space-y-6 w-full font-sans">
      <SecuritySettingsSection />
    </div>
  );
}
