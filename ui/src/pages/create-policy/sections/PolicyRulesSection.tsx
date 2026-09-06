import React, { useState } from 'react';
import {
  GripVertical,
  Code,
  Activity,
  UserCheck,
  Ban,
  Clock,
  CheckCircle2,
  Pencil,
} from 'lucide-react';
import { AddRuleModal } from './AddRuleModal';

export interface PolicyRuleItem {
  id: number;
  name: string;
  type: 'custom' | 'rate-limit' | 'access-control';
  group?: string;
  action: 'block' | 'throttle' | 'allow';
  enabled: boolean;
}

interface PolicyRulesSectionProps {
  rules: PolicyRuleItem[];
  setRules: React.Dispatch<React.SetStateAction<PolicyRuleItem[]>>;
  availableCatalog?: { id: number; name: string; action: string; group?: string }[];
  isLoading?: boolean;
}

export function PolicyRulesSection({
  rules,
  setRules,
  availableCatalog = [],
  isLoading = false,
}: PolicyRulesSectionProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const toggleRuleEnabled = (id: number) => {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
    );
  };

  const handleSaveRulesFromModal = (selectedIds: number[]) => {
    // 1. Keep existing rules that are still selected (preserves order, enabled state, etc.)
    const keptRules = rules.filter((r) => selectedIds.includes(r.id));
    const keptIds = new Set(keptRules.map((r) => r.id));

    // 2. Newly selected rules from availableCatalog
    const newlySelected = availableCatalog.filter(
      (item) => selectedIds.includes(item.id) && !keptIds.has(item.id)
    );

    const newRules: PolicyRuleItem[] = newlySelected.map((item) => {
      let type: PolicyRuleItem['type'] = 'custom';
      const act = (item.action || '').toLowerCase();
      const name = item.name.toLowerCase();
      const g = (item.group || '').toLowerCase();
      if (
        g === 'rate-limit' ||
        name.includes('rate-limit') ||
        act.includes('throttle') ||
        act.includes('limit')
      ) {
        type = 'rate-limit';
      } else if (
        g === 'endpoint' ||
        g === 'authentication' ||
        g === 'access-control' ||
        name.includes('allow') ||
        name.includes('ip') ||
        name.includes('access') ||
        name.includes('whitelist')
      ) {
        type = 'access-control';
      }

      let action: PolicyRuleItem['action'] = 'block';
      if (act.includes('allow')) action = 'allow';
      else if (
        act.includes('throttle') ||
        act.includes('limit') ||
        act.includes('log')
      )
        action = 'throttle';

      return {
        id: item.id,
        name: item.name,
        type,
        group: item.group,
        action,
        enabled: true,
      };
    });

    setRules([...keptRules, ...newRules]);
  };

  return (
    <section className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] p-5 space-y-4 shadow-xs rounded-sm font-sans">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            3. Policy Rules
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Select and configure real rules from your catalog that will be applied by this policy.
          </p>
        </div>
        <span className="text-xs font-semibold px-2 py-0.5 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-900/60 text-blue-700 dark:text-blue-400 rounded-xs">
          {rules.length} rule{rules.length === 1 ? '' : 's'} configured
        </span>
      </div>

      {/* Rules Table */}
      <div className="border border-slate-200 dark:border-[#172338] overflow-x-auto rounded-sm">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 dark:bg-[#080E18] text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-[#172338]">
            <tr>
              <th className="py-2.5 px-3 w-16 text-center">Order</th>
              <th className="py-2.5 px-3">Rule</th>
              <th className="py-2.5 px-3">Type</th>
              <th className="py-2.5 px-3">Action</th>
              <th className="py-2.5 px-3 w-28 text-right pr-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-[#172338]/60">
            {isLoading ? (
              <tr>
                <td
                  colSpan={5}
                  className="py-8 text-center text-slate-400 dark:text-slate-500"
                >
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <span>Loading rules from catalog...</span>
                  </div>
                </td>
              </tr>
            ) : rules.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="py-6 text-center text-slate-400 dark:text-slate-500"
                >
                  No rules configured in this policy. Click "Edit Rules" to select rules from catalog.
                </td>
              </tr>
            ) : (
              rules.map((rule, index) => (
                <tr
                  key={rule.id}
                  className="hover:bg-slate-50 dark:hover:bg-[#0E1726]/40 transition-colors"
                >
                  {/* Order & Drag Handle */}
                  <td className="py-3 px-3">
                    <div className="flex items-center justify-center gap-1 text-slate-400 dark:text-slate-500">
                      <GripVertical className="w-3.5 h-3.5 opacity-60 hover:opacity-100" />
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        {index + 1}
                      </span>
                    </div>
                  </td>

                  {/* Rule Name */}
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900 dark:text-white">
                        {rule.name}
                      </span>
                      {rule.group && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-xs bg-slate-100 dark:bg-[#152030] text-slate-500 dark:text-slate-400">
                          {rule.group}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Type */}
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-1.5 text-cyan-600 dark:text-cyan-400 font-medium">
                      {rule.type === 'custom' && (
                        <>
                          <Code className="w-3.5 h-3.5" />
                          <span>Custom Rule</span>
                        </>
                      )}
                      {rule.type === 'rate-limit' && (
                        <>
                          <Activity className="w-3.5 h-3.5" />
                          <span>Rate Limit</span>
                        </>
                      )}
                      {rule.type === 'access-control' && (
                        <>
                          <UserCheck className="w-3.5 h-3.5" />
                          <span>Access Control</span>
                        </>
                      )}
                    </div>
                  </td>

                  {/* Action */}
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-1.5 font-medium">
                      {rule.action === 'block' && (
                        <div className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
                          <Ban className="w-3.5 h-3.5" />
                          <span>Block</span>
                        </div>
                      )}
                      {rule.action === 'throttle' && (
                        <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                          <Clock className="w-3.5 h-3.5" />
                          <span>Throttle</span>
                        </div>
                      )}
                      {rule.action === 'allow' && (
                        <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Allow</span>
                        </div>
                      )}
                    </div>
                  </td>

                  {/* Status Toggle */}
                  <td className="py-3 px-3 text-right pr-4">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={rule.enabled}
                      onClick={() => toggleRuleEnabled(rule.id)}
                      className={`inline-flex w-9 h-5 items-center p-0.5 rounded-full cursor-pointer transition-colors ${
                        rule.enabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-[#1C293D]'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 bg-white rounded-full transition-transform shadow-xs ${
                          rule.enabled ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Action Buttons Below Table */}
      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/30 dark:hover:bg-blue-950/50 border border-blue-300 dark:border-blue-500/40 text-blue-700 dark:text-blue-400 text-xs font-semibold rounded-sm transition-colors cursor-pointer"
        >
          <Pencil className="w-3.5 h-3.5" />
          <span>Edit Rules</span>
        </button>

        <span className="text-[11px] text-slate-400 dark:text-slate-500">
          Showing {rules.length} of {availableCatalog.length} catalog rules
        </span>
      </div>

      {/* Catalog Modal */}
      <AddRuleModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSaveRules={handleSaveRulesFromModal}
        catalog={availableCatalog}
        selectedRuleIds={rules.map((r) => r.id)}
      />
    </section>
  );
}

export default PolicyRulesSection;
