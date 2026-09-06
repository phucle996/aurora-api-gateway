import React, { useState, useEffect } from 'react';
import { Search, Moon, Sun, Laptop } from 'lucide-react';
import { useTheme } from './theme-provider';

interface ConsoleHeaderProps {
  onSearch?: (query: string) => void;
  title?: string;
}

export function ConsoleHeader({ onSearch }: ConsoleHeaderProps) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [searchQuery, setSearchQuery] = useState('');

  const toggleTheme = () => {
    if (theme === 'dark') setTheme('light');
    else if (theme === 'light') setTheme('system');
    else setTheme('dark');
  };

  // Global keyboard shortcut (Ctrl + K or Cmd + K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const input = document.getElementById('global-search-input') as HTMLInputElement;
        if (input) {
          input.focus();
          input.select();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    if (onSearch) {
      onSearch(e.target.value);
    }
  };

  return (
    <header className="h-14 px-4 sm:px-6 bg-card border-b border-border flex items-center justify-between sticky top-0 z-20 font-sans">
      {/* Left: Global Search Only */}
      <div className="flex items-center flex-1 max-w-md">
        <div className="relative w-full">
          <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="global-search-input"
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="Search IP, rule, policy, node... (Ctrl K)"
            className="w-full bg-background border border-input pl-8 pr-14 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors font-sans rounded-sm"
          />
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[9px] bg-muted text-muted-foreground border border-border select-none rounded-xs">
            Ctrl K
          </kbd>
        </div>
      </div>

      {/* Right: Theme Toggle Only */}
      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={`Current theme: ${theme}. Click to switch.`}
          className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer rounded-sm border border-transparent hover:border-border"
          title={`Theme: ${theme.toUpperCase()} (${resolvedTheme}) - Click to switch`}
        >
          {theme === 'system' ? (
            <Laptop className="w-4 h-4 text-primary" />
          ) : resolvedTheme === 'light' ? (
            <Sun className="w-4 h-4 text-amber-500" />
          ) : (
            <Moon className="w-4 h-4 text-foreground" />
          )}
        </button>
      </div>
    </header>
  );
}

export default ConsoleHeader;

