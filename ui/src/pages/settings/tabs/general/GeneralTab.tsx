import React from 'react';
import { SystemInfoSection } from './sections/SystemInfoSection';
import { WebInterfaceSection } from './sections/WebInterfaceSection';

export function GeneralTab() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 font-sans">
      <SystemInfoSection />
      <WebInterfaceSection />
    </div>
  );
}
