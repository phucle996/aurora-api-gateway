import React from 'react';
import { FileText, ChevronDown } from 'lucide-react';

interface PolicyInfoSectionProps {
  policyName: string;
  onPolicyNameChange: (val: string) => void;
  description: string;
  onDescriptionChange: (val: string) => void;
  mode: string;
  onModeChange: (val: string) => void;
  priority: string;
  onPriorityChange: (val: string) => void;
  status: string;
  onStatusChange: (val: string) => void;
}

export function PolicyInfoSection({
  policyName,
  onPolicyNameChange,
  description,
  onDescriptionChange,
  mode,
  onModeChange,
  priority,
  onPriorityChange,
  status,
  onStatusChange,
}: PolicyInfoSectionProps) {
  return (
    <div className="bg-[#0B1320] border border-[#172338] p-5 space-y-4">
      {/* Section Header */}
      <div className="flex items-start gap-2.5 pb-2 border-b border-[#172338]">
        <div className="w-7 h-7 bg-[#0E1B2C] border border-[#1C3252] flex items-center justify-center text-slate-300">
          <FileText className="w-4 h-4 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-xs font-mono font-semibold text-white uppercase tracking-wider">
            Policy Information
          </h2>
          <p className="text-[11px] text-slate-400 font-mono">
            Basic information and enforcement behavior for this policy.
          </p>
        </div>
      </div>

      {/* Form Fields */}
      <div className="space-y-3 font-mono text-xs">
        {/* Name & Description */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="policyName"
              className="block text-[11px] uppercase tracking-wider text-slate-300 mb-1"
            >
              Policy Name <span className="text-rose-400">*</span>
            </label>
            <input
              id="policyName"
              type="text"
              value={policyName}
              onChange={(e) => onPolicyNameChange(e.target.value)}
              placeholder="e.g. Admin Console Strict"
              className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
              required
            />
          </div>

          <div>
            <label
              htmlFor="policyDescription"
              className="block text-[11px] uppercase tracking-wider text-slate-300 mb-1"
            >
              Description
            </label>
            <textarea
              id="policyDescription"
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              placeholder="Describe enforcement intent..."
              rows={2}
              className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition-colors resize-none"
            />
          </div>
        </div>

        {/* Mode, Priority, Status */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label
              htmlFor="policyMode"
              className="block text-[11px] uppercase tracking-wider text-slate-300 mb-1"
            >
              Mode
            </label>
            <div className="relative">
              <select
                id="policyMode"
                value={mode}
                onChange={(e) => onModeChange(e.target.value)}
                className="w-full appearance-none bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors cursor-pointer"
              >
                <option value="Blocking">Blocking</option>
                <option value="Detect">Observation / Detect</option>
                <option value="Mixed">Mixed</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          <div>
            <label
              htmlFor="policyPriority"
              className="block text-[11px] uppercase tracking-wider text-slate-300 mb-1"
            >
              Priority
            </label>
            <div className="relative">
              <select
                id="policyPriority"
                value={priority}
                onChange={(e) => onPriorityChange(e.target.value)}
                className="w-full appearance-none bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors cursor-pointer"
              >
                <option value="Critical">Critical</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          <div>
            <label
              htmlFor="policyStatus"
              className="block text-[11px] uppercase tracking-wider text-slate-300 mb-1"
            >
              Status on creation
            </label>
            <div className="relative">
              <select
                id="policyStatus"
                value={status}
                onChange={(e) => onStatusChange(e.target.value)}
                className="w-full appearance-none bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors cursor-pointer"
              >
                <option value="Draft">Draft</option>
                <option value="Active">Active</option>
                <option value="Disabled">Disabled</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
