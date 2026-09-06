import React from 'react';

export function LoginFooter() {
  return (
    <footer className="w-full px-8 py-5 flex flex-col sm:flex-row items-center justify-between text-xs text-muted-foreground gap-4 z-10">
      <div className="flex items-center gap-2">
        <span>Aurora WAF Console</span>
        <span className="text-muted-foreground/70">v2024.11.3</span>
      </div>

      <div className="flex items-center gap-5 sm:gap-6 flex-wrap justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <a href="#documentation" className="hover:text-foreground transition-colors">
            Documentation
          </a>
          <span className="text-border">|</span>
          <a href="#support" className="hover:text-foreground transition-colors">
            Support
          </a>
          <span className="text-border">|</span>
          <a href="#status" className="hover:text-foreground transition-colors">
            Status
          </a>
        </div>

        <div className="flex items-center gap-2 pl-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
          </span>
          <span className="text-primary font-medium text-xs select-none">
            All Systems Operational
          </span>
        </div>
      </div>
    </footer>
  );
}
