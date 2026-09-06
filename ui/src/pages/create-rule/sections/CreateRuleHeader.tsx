import React from 'react';
import { Link } from 'react-router-dom';
import { LayoutTemplate, ChevronRight } from 'lucide-react';

interface CreateRuleHeaderProps {
  onScrollToTemplates: () => void;
}

export function CreateRuleHeader({ onScrollToTemplates }: CreateRuleHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        {/* Breadcrumbs */}
        <div className="flex items-center gap-1.5 text-xs font-sans text-muted-foreground mb-1">
          <Link to="/rules" className="hover:text-foreground transition-colors">
            Rules
          </Link>
          <ChevronRight className="w-3 h-3 text-muted-foreground" />
          <span className="text-foreground font-medium">Create Rule</span>
        </div>

        {/* Title */}
        <h1 className="text-xl font-semibold text-foreground tracking-tight">
          Create Security Rule
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Define conditions and actions to protect your applications from malicious traffic.
        </p>
      </div>

      <div>
        <button
          type="button"
          onClick={onScrollToTemplates}
          className="flex items-center gap-2 px-3 py-1.5 bg-muted hover:bg-accent border border-border text-xs font-sans text-foreground transition-colors cursor-pointer"
        >
          <LayoutTemplate className="w-3.5 h-3.5 text-primary" />
          <span>View Rule Templates</span>
        </button>
      </div>
    </div>
  );
}

