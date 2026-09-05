import React from 'react';
import { Plus, Trash2 } from 'lucide-react';

export interface RateLimitCondition {
  id: string;
  field: string;
  operator: string;
  value: string;
}

interface RateLimitConditionsProps {
  conditions: RateLimitCondition[];
  setConditions: React.Dispatch<React.SetStateAction<RateLimitCondition[]>>;
}

export function RateLimitConditionsSection({
  conditions,
  setConditions,
}: RateLimitConditionsProps) {
  const handleAddCondition = () => {
    const newCond: RateLimitCondition = {
      id: Date.now().toString(),
      field: 'Request Path',
      operator: 'Starts With',
      value: '/login',
    };
    setConditions([...conditions, newCond]);
  };

  const handleRemoveCondition = (id: string) => {
    setConditions(conditions.filter((c) => c.id !== id));
  };

  const handleUpdateCondition = (
    id: string,
    key: keyof RateLimitCondition,
    value: string
  ) => {
    setConditions(
      conditions.map((c) => (c.id === id ? { ...c, [key]: value } : c))
    );
  };

  return (
    <div className="bg-[#0B1320] border border-[#152030] p-4 space-y-4 font-mono text-xs">
      <div>
        <div className="text-sm font-semibold text-white">
          3. Match Conditions (Optional)
        </div>
        <p className="text-slate-400 text-[11px] mt-0.5 font-sans">
          Apply this rate limit only when ALL conditions match.
        </p>
      </div>

      <div className="space-y-2.5">
        {conditions.map((cond) => (
          <div
            key={cond.id}
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 bg-[#080E18] border border-[#152030] p-2"
          >
            {/* Field */}
            <select
              value={cond.field}
              onChange={(e) =>
                handleUpdateCondition(cond.id, 'field', e.target.value)
              }
              className="bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-slate-200 focus:outline-none focus:border-blue-500 cursor-pointer text-xs sm:w-1/3"
            >
              <option value="Request Path">Request Path</option>
              <option value="Client IP">Client IP</option>
              <option value="HTTP Header">HTTP Header</option>
              <option value="Query Parameter">Query Parameter</option>
              <option value="HTTP Method">HTTP Method</option>
            </select>

            {/* Operator */}
            <select
              value={cond.operator}
              onChange={(e) =>
                handleUpdateCondition(cond.id, 'operator', e.target.value)
              }
              className="bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-slate-200 focus:outline-none focus:border-blue-500 cursor-pointer text-xs sm:w-1/3"
            >
              <option value="Starts With">Starts With</option>
              <option value="Equals">Equals</option>
              <option value="Contains">Contains</option>
              <option value="Ends With">Ends With</option>
              <option value="Regex Match">Regex Match</option>
            </select>

            {/* Value */}
            <input
              type="text"
              value={cond.value}
              onChange={(e) =>
                handleUpdateCondition(cond.id, 'value', e.target.value)
              }
              placeholder="/login"
              className="flex-1 bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500 text-xs"
            />

            {/* Delete button */}
            <button
              type="button"
              onClick={() => handleRemoveCondition(cond.id)}
              className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 transition-colors self-end sm:self-center cursor-pointer"
              title="Delete Condition"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={handleAddCondition}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0E1726] hover:bg-[#152030] border border-[#1C293D] text-cyan-400 hover:text-cyan-300 text-xs cursor-pointer transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Condition</span>
        </button>
      </div>
    </div>
  );
}
