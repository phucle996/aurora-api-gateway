import React from 'react';

interface RateLimitBasicInfoProps {
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
}

export function RateLimitBasicInfoSection({
  name,
  setName,
  description,
  setDescription,
}: RateLimitBasicInfoProps) {
  return (
    <div className="bg-card border border-border p-4 space-y-3 font-sans text-xs shadow-xs rounded-sm">
      <div className="text-sm font-semibold text-foreground">
        1. Basic Information
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Rule Name */}
        <div>
          <label className="block text-muted-foreground mb-1 text-[11px] font-medium">
            Rule Name <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. limit-login-attempts"
            className="w-full bg-background border border-input px-3 py-1.5 text-foreground placeholder:text-muted-foreground font-mono text-xs focus:outline-none focus:border-primary rounded-sm"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-muted-foreground mb-1 text-[11px] font-medium">
            Description
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Limit login requests to prevent brute force attacks."
            className="w-full bg-background border border-input px-3 py-1.5 text-foreground placeholder:text-muted-foreground text-xs focus:outline-none focus:border-primary rounded-sm"
          />
        </div>
      </div>
    </div>
  );
}

