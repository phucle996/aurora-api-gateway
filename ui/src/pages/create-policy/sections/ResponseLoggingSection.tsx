import React from 'react';
import { ShieldAlert, ChevronDown } from 'lucide-react';

interface ResponseLoggingSectionProps {
  defaultAction: string;
  onDefaultActionChange: (val: string) => void;
  returnStatus: number;
  onReturnStatusChange: (val: number) => void;
  eventLogging: string;
  onEventLoggingChange: (val: string) => void;
  auditTrail: string;
  onAuditTrailChange: (val: string) => void;
  previewMode: boolean;
  onPreviewModeToggle: () => void;
}

export function ResponseLoggingSection({
  defaultAction,
  onDefaultActionChange,
  returnStatus,
  onReturnStatusChange,
  eventLogging,
  onEventLoggingChange,
  auditTrail,
  onAuditTrailChange,
  previewMode,
  onPreviewModeToggle,
}: ResponseLoggingSectionProps) {
  return (
    <div className="bg-[#0B1320] border border-[#172338] p-5 space-y-4">
      {/* Section Header */}
      <div className="flex items-start gap-2.5 pb-2 border-b border-[#172338]">
        <div className="w-7 h-7 bg-[#0E1B2C] border border-[#1C3252] flex items-center justify-center text-slate-300">
          <ShieldAlert className="w-4 h-4 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-xs font-mono font-semibold text-white uppercase tracking-wider">
            Response & Logging
          </h2>
          <p className="text-[11px] text-slate-400 font-mono">
            Define how requests are handled and logged when this policy is enforced.
          </p>
        </div>
      </div>

      {/* Form Fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 font-mono text-xs items-end">
        {/* Default Action */}
        <div>
          <label
            htmlFor="defaultAction"
            className="block text-[11px] uppercase tracking-wider text-slate-300 mb-1"
          >
            Default Action
          </label>
          <div className="relative">
            <select
              id="defaultAction"
              value={defaultAction}
              onChange={(e) => onDefaultActionChange(e.target.value)}
              className="w-full appearance-none bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors cursor-pointer"
            >
              <option value="Block">Block</option>
              <option value="Log">Log Only</option>
              <option value="Challenge">Challenge</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* Return Status */}
        <div>
          <label
            htmlFor="returnStatus"
            className="block text-[11px] uppercase tracking-wider text-slate-300 mb-1"
          >
            Return Status
          </label>
          <div className="relative">
            <select
              id="returnStatus"
              value={returnStatus}
              onChange={(e) => onReturnStatusChange(Number(e.target.value))}
              className="w-full appearance-none bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors cursor-pointer"
            >
              <option value={403}>403 Forbidden</option>
              <option value={401}>401 Unauthorized</option>
              <option value={429}>429 Too Many Requests</option>
              <option value={200}>200 OK</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* Event Logging */}
        <div>
          <label
            htmlFor="eventLogging"
            className="block text-[11px] uppercase tracking-wider text-slate-300 mb-1"
          >
            Event Logging
          </label>
          <div className="relative">
            <select
              id="eventLogging"
              value={eventLogging}
              onChange={(e) => onEventLoggingChange(e.target.value)}
              className="w-full appearance-none bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors cursor-pointer"
            >
              <option value="Enabled">Enabled</option>
              <option value="Disabled">Disabled</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* Audit Trail */}
        <div>
          <label
            htmlFor="auditTrail"
            className="block text-[11px] uppercase tracking-wider text-slate-300 mb-1"
          >
            Audit Trail
          </label>
          <div className="relative">
            <select
              id="auditTrail"
              value={auditTrail}
              onChange={(e) => onAuditTrailChange(e.target.value)}
              className="w-full appearance-none bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors cursor-pointer"
            >
              <option value="Enabled">Enabled</option>
              <option value="Disabled">Disabled</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* Preview Mode Switch */}
        <div className="flex flex-col justify-end">
          <span className="block text-[11px] uppercase tracking-wider text-slate-300 mb-1">
            Preview Mode
          </span>
          <div
            onClick={onPreviewModeToggle}
            className="flex items-center gap-2 cursor-pointer h-[34px] px-2 bg-[#0E1726] border border-[#1C293D] select-none"
          >
            <div
              className={`w-7 h-4 p-0.5 border transition-colors ${
                previewMode
                  ? 'bg-emerald-600 border-emerald-500'
                  : 'bg-[#152030] border-[#25354D]'
              }`}
            >
              <div
                className={`w-2.5 h-2.5 bg-white transition-transform ${
                  previewMode ? 'translate-x-3' : 'translate-x-0'
                }`}
              />
            </div>
            <span className="text-[11px] text-slate-300 truncate">
              {previewMode ? 'On (Simulate)' : 'Off (Live)'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
