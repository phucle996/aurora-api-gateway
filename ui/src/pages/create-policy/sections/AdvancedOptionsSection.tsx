import React from 'react';
import { Check } from 'lucide-react';

interface AdvancedOptionsSectionProps {
  enableLogging: boolean;
  setEnableLogging: (val: boolean) => void;
  addToIpReputation: boolean;
  setAddToIpReputation: (val: boolean) => void;
  enableShadowMode: boolean;
  setEnableShadowMode: (val: boolean) => void;
}

export function AdvancedOptionsSection({
  enableLogging,
  setEnableLogging,
  addToIpReputation,
  setAddToIpReputation,
  enableShadowMode,
  setEnableShadowMode,
}: AdvancedOptionsSectionProps) {
  return (
    <section className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] p-5 space-y-4 shadow-xs rounded-sm font-mono">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
          4. Advanced Options
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        {/* Option 1: Enable Logging */}
        <label
          onClick={() => setEnableLogging(!enableLogging)}
          className="flex items-start gap-3 p-2.5 rounded-sm cursor-pointer hover:bg-slate-50 dark:hover:bg-[#0E1726]/40 transition-colors"
        >
          <div
            className={`w-4 h-4 mt-0.5 rounded-xs flex items-center justify-center border transition-colors shrink-0 ${
              enableLogging
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-white dark:bg-[#080E18] border-slate-300 dark:border-[#1C293D]'
            }`}
          >
            {enableLogging && <Check className="w-3 h-3 stroke-[3]" />}
          </div>
          <div className="space-y-0.5">
            <span className="font-semibold text-slate-900 dark:text-white">
              Enable logging
            </span>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
              Record matched requests in security logs.
            </p>
          </div>
        </label>

        {/* Option 2: Add to IP Reputation */}
        <label
          onClick={() => setAddToIpReputation(!addToIpReputation)}
          className="flex items-start gap-3 p-2.5 rounded-sm cursor-pointer hover:bg-slate-50 dark:hover:bg-[#0E1726]/40 transition-colors"
        >
          <div
            className={`w-4 h-4 mt-0.5 rounded-xs flex items-center justify-center border transition-colors shrink-0 ${
              addToIpReputation
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-white dark:bg-[#080E18] border-slate-300 dark:border-[#1C293D]'
            }`}
          >
            {addToIpReputation && <Check className="w-3 h-3 stroke-[3]" />}
          </div>
          <div className="space-y-0.5">
            <span className="font-semibold text-slate-900 dark:text-white">
              Add to IP reputation list
            </span>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
              Increase risk score for matched IPs.
            </p>
          </div>
        </label>

        {/* Option 3: Shadow Mode */}
        <label
          onClick={() => setEnableShadowMode(!enableShadowMode)}
          className="flex items-start gap-3 p-2.5 rounded-sm cursor-pointer hover:bg-slate-50 dark:hover:bg-[#0E1726]/40 transition-colors"
        >
          <div
            className={`w-4 h-4 mt-0.5 rounded-xs flex items-center justify-center border transition-colors shrink-0 ${
              enableShadowMode
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-white dark:bg-[#080E18] border-slate-300 dark:border-[#1C293D]'
            }`}
          >
            {enableShadowMode && <Check className="w-3 h-3 stroke-[3]" />}
          </div>
          <div className="space-y-0.5">
            <span className="font-semibold text-slate-900 dark:text-white">
              Enable shadow mode
            </span>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
              Test policy without enforcing actions.
            </p>
          </div>
        </label>
      </div>
    </section>
  );
}

export default AdvancedOptionsSection;
