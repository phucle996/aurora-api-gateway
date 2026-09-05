import React from 'react';
import auroraLogo from '@/assets/image.png';

export function LoginHeader() {
  return (
    <header className="w-full px-8 py-6 flex items-center justify-between z-10">
      <div className="flex items-center gap-3">
        <img
          src={auroraLogo}
          alt="Aurora"
          className="h-7 w-auto object-contain select-none"
        />
      </div>

      <div className="text-[11px] font-medium tracking-[0.2em] text-slate-500 uppercase select-none hidden sm:block">
        SECURE APPLICATIONS &nbsp;/&nbsp; PROTECT WHAT MATTERS
      </div>
    </header>
  );
}
