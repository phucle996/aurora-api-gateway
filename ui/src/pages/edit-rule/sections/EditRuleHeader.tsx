import React from 'react';
import { Link } from 'react-router-dom';
import { History, Trash2, Save, ChevronRight } from 'lucide-react';

interface EditRuleHeaderProps {
  ruleId?: string;
  onDuplicate?: () => void;
  onDelete: () => void;
  onSave: () => void;
  isSaving: boolean;
}

export function EditRuleHeader({
  ruleId,
  onDelete,
  onSave,
  isSaving,
}: EditRuleHeaderProps) {
  return (
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
      <div>
        {/* Breadcrumbs */}
        <div className="flex items-center gap-1.5 text-xs font-sans text-muted-foreground mb-1">
          <Link to="/rules" className="hover:text-foreground transition-colors">
            Rules
          </Link>
          <ChevronRight className="w-3 h-3 text-muted-foreground" />
          <span className="text-foreground font-medium">Edit Rule</span>
        </div>

        {/* Title */}
        <h1 className="text-xl font-semibold text-foreground tracking-tight">
          Edit Security Rule
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Modify the rule configuration and deploy changes to protect your applications.
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center gap-2.5 font-sans text-xs">
        <Link
          to={`/rules/history?id=${ruleId || 'rule_01H8F3K9Z7'}`}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-accent border border-border text-foreground transition-colors cursor-pointer"
        >
          <History className="w-3.5 h-3.5 text-primary" />
          <span>View Rule History</span>
        </Link>

        <button
          type="button"
          onClick={onDelete}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-destructive/10 hover:bg-destructive/20 border border-destructive/30 text-destructive transition-colors cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Delete</span>
        </button>

        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-primary hover:bg-primary/90 border border-primary text-primary-foreground font-bold transition-colors cursor-pointer shadow-sm"
        >
          <Save className="w-3.5 h-3.5" />
          <span>{isSaving ? 'Saving...' : 'Save Changes'}</span>
        </button>
      </div>
    </div>
  );
}
