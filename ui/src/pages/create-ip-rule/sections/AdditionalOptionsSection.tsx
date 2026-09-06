import React from 'react';
import type { AccessRuleDocument } from '../../../lib/api/access';

interface AdditionalOptionsProps {
  form: AccessRuleDocument;
  setForm: React.Dispatch<React.SetStateAction<AccessRuleDocument>>;
}

export function AdditionalOptionsSection({ form, setForm }: AdditionalOptionsProps) {
  return (
    <section className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] p-5 space-y-4 shadow-xs rounded-sm font-sans text-xs">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
          4. Additional Options
        </h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-1">
        {/* Log matching requests */}
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={form.log}
            onChange={(e) => setForm((prev) => ({ ...prev, log: e.target.checked }))}
            className="mt-0.5 rounded text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
          />
          <div>
            <div className="font-medium text-slate-800 dark:text-slate-200">
              Log matching requests
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
              Record this event in security logs.
            </p>
          </div>
        </label>

        {/* Add to IP reputation list */}
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={form.reputation}
            onChange={(e) => setForm((prev) => ({ ...prev, reputation: e.target.checked }))}
            className="mt-0.5 rounded text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
          />
          <div>
            <div className="font-medium text-slate-800 dark:text-slate-200">
              Add to IP reputation list
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
              Increase risk score for matched IPs.
            </p>
          </div>
        </label>

        {/* Enable alert */}
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={form.alert}
            onChange={(e) => setForm((prev) => ({ ...prev, alert: e.target.checked }))}
            className="mt-0.5 rounded text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
          />
          <div>
            <div className="font-medium text-slate-800 dark:text-slate-200">
              Enable alert
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
              Send notification when triggered.
            </p>
          </div>
        </label>
      </div>
    </section>
  );
}
