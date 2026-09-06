import React from 'react';
import { HelpCircle } from 'lucide-react';
import type { PolicyCatalogItem } from '../../../lib/api/policies';

interface EditBasicInfoProps {
  ruleId: string;
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  policy: string;
  setPolicy: (v: string) => void;
  priority: number;
  setPriority: (v: number) => void;
  policyCatalog?: PolicyCatalogItem[];
  isLoadingPolicies?: boolean;
}

export function EditBasicInfoSection({
  ruleId,
  name,
  setName,
  description,
  setDescription,
  policy,
  setPolicy,
  priority,
  setPriority,
  policyCatalog = [],
  isLoadingPolicies = false,
}: EditBasicInfoProps) {
  return (
    <div className="bg-card border border-border p-4 space-y-4 font-sans text-xs text-foreground">
      <div className="flex items-center justify-between pb-1 border-b border-border/50">
        <div className="text-sm font-semibold text-foreground">
          1. Basic Information
        </div>
        <div className="text-[11px] font-mono text-muted-foreground">
          Rule ID: <span className="text-foreground font-semibold bg-muted/60 px-2 py-0.5 border border-border select-all">{ruleId}</span>
        </div>
      </div>

      {/* Tầng 1: Rule Name, Priority, Policy */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
        {/* Rule Name */}
        <div>
          <label className="block text-muted-foreground mb-1 text-[11px]">
            Rule Name <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="block-sql-injection"
            className="w-full bg-background border border-input px-3 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
        </div>

        {/* Priority */}
        <div>
          <div className="flex items-center gap-1 text-muted-foreground mb-1 text-[11px]">
            <span>Priority</span>
            <HelpCircle className="w-3 h-3 text-muted-foreground cursor-pointer" />
          </div>
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
            className="w-full bg-background border border-input px-3 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
        </div>

        {/* Policy */}
        <div>
          <label className="block text-muted-foreground mb-1 text-[11px]">
            Policy
          </label>
          <select
            aria-label="Policy"
            value={policy}
            onChange={(e) => setPolicy(e.target.value)}
            className="w-full bg-background border border-input px-3 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary cursor-pointer"
          >
            <option value="">Unassigned</option>
            {policyCatalog && policyCatalog.length > 0 ? (
              policyCatalog.map((p) => (
                <option key={p.id} value={p.name}>
                  {p.name}
                </option>
              ))
            ) : (
              <option value="" disabled>
                {isLoadingPolicies ? 'Loading policies...' : 'No policies available'}
              </option>
            )}
          </select>
        </div>
      </div>

      {/* Tầng 2: Mô tả (Description) */}
      <div>
        <label className="block text-muted-foreground mb-1 text-[11px]">
          Description
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Block common SQL injection patterns in URI and query parameters."
          className="w-full bg-background border border-input px-3 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
        />
      </div>
    </div>
  );
}


