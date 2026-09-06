import React from 'react';
import { HelpCircle } from 'lucide-react';
import type { AccessRuleDocument } from '../../../lib/api/access';

interface BasicInfoProps {
  form: AccessRuleDocument;
  setForm: React.Dispatch<React.SetStateAction<AccessRuleDocument>>;
}

export function BasicInfoSection({ form, setForm }: BasicInfoProps) {
  return (
    <section className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] p-5 space-y-4 shadow-xs rounded-sm font-sans text-xs">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
          1. Basic Information
        </h2>
      </div>

      {/* Row 1: Name and Description */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-slate-700 dark:text-slate-300 font-medium">
            Rule Name <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            required
            maxLength={120}
            placeholder="e.g. block-suspicious-ip"
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            className="w-full bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#1C293D] px-3 py-2 text-slate-900 dark:text-white rounded-sm focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-slate-700 dark:text-slate-300 font-medium">
            Description
          </label>
          <input
            type="text"
            maxLength={2000}
            placeholder="e.g. Block requests from high-risk IP addresses."
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            className="w-full bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#1C293D] px-3 py-2 text-slate-900 dark:text-white rounded-sm focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>
      </div>

      {/* Row 2: Action, Status, Priority */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1 items-end">
        {/* Action */}
        <div className="space-y-1.5">
          <label className="block text-slate-700 dark:text-slate-300 font-medium">
            Action <span className="text-rose-500">*</span>
          </label>
          <div className="relative">
            <select
              value={form.action}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  action: e.target.value as AccessRuleDocument['action'],
                }))
              }
              className="w-full bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#1C293D] px-3 py-2 text-slate-900 dark:text-white rounded-sm focus:outline-none focus:border-blue-500 transition-colors cursor-pointer appearance-none pr-8"
            >
              <option value="block">🚫 Block</option>
              <option value="allow">✅ Allow</option>
              <option value="log">📋 Log only</option>
            </select>
            <div className="absolute inset-y-0 right-0 flex items-center pr-2.5 pointer-events-none text-slate-400">
              ▼
            </div>
          </div>
        </div>

        {/* Status Toggle */}
        <div className="space-y-1.5">
          <label className="block text-slate-700 dark:text-slate-300 font-medium">
            Status
          </label>
          <div className="flex items-center gap-3 h-[34px]">
            <button
              type="button"
              role="switch"
              aria-checked={form.enabled}
              onClick={() => setForm((prev) => ({ ...prev, enabled: !prev.enabled }))}
              className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${
                form.enabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition duration-200 ease-in-out mt-0.5 ${
                  form.enabled ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300 select-none">
              {form.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </div>

        {/* Priority */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-1 text-slate-700 dark:text-slate-300 font-medium">
            <span>Priority</span>
            <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
          </label>
          <input
            type="number"
            min={0}
            max={1000000}
            required
            value={form.priority}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, priority: Number(e.target.value) || 0 }))
            }
            className="w-full bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#1C293D] px-3 py-2 text-slate-900 dark:text-white rounded-sm focus:outline-none focus:border-blue-500 transition-colors font-mono"
          />
        </div>
      </div>
    </section>
  );
}
