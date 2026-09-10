import React from 'react';
import logoImg from '@/assets/logo.png';

export function LoginHeader() {
  return (
    <header className="w-full px-8 py-6 flex items-center justify-between z-10">
      <div className="flex items-center gap-3">
        <img
          src={logoImg}
          alt="Aurora API Gateway Logo"
          className="w-8 h-8 object-contain shrink-0"
        />
        <div className="flex flex-col">
          <span className="font-bold text-foreground text-sm tracking-wider uppercase font-sans">
            Aurora API Gateway
          </span>
          <span className="text-[10px] text-muted-foreground font-sans tracking-wide uppercase">
            Cloud Console
          </span>
        </div>
      </div>

      <div className="text-[11px] font-medium tracking-[0.2em] text-muted-foreground uppercase select-none hidden sm:block font-sans">
        SECURE APPLICATIONS &nbsp;/&nbsp; PROTECT WHAT MATTERS
      </div>
    </header>
  );
}

