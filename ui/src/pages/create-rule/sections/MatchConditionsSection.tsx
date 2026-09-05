import React from 'react';
import { Plus, Trash2 } from 'lucide-react';

export interface Condition {
  id: string;
  field: string;
  operator: string;
  value: string;
  headerName?: string;
}

interface MatchConditionsProps {
  conditions: Condition[];
  setConditions: React.Dispatch<React.SetStateAction<Condition[]>>;
  logicMode: 'ALL' | 'ANY';
  setLogicMode: (mode: 'ALL' | 'ANY') => void;
}

export function MatchConditionsSection({
  conditions,
  setConditions,
  logicMode,
  setLogicMode,
}: MatchConditionsProps) {
  const handleAddCondition = () => {
    const newCond: Condition = {
      id: Math.random().toString(36).substring(2, 9),
      field: 'Request URI',
      operator: 'Equals',
      value: '',
    };
    setConditions([...conditions, newCond]);
  };

  const handleRemoveCondition = (id: string) => {
    if (conditions.length > 1) {
      setConditions(conditions.filter((c) => c.id !== id));
    }
  };

  const handleUpdateCondition = (id: string, key: keyof Condition, val: string) => {
    setConditions(
      conditions.map((c) => (c.id === id ? { ...c, [key]: val } : c))
    );
  };

  return (
    <div className="bg-[#0B1320] border border-[#152030] p-4 space-y-4 font-mono text-xs">
      <div>
        <div className="text-sm font-semibold text-white">
          2. Match Conditions
        </div>
        <p className="text-slate-400 text-[11px] mt-0.5 font-sans">
          When a request matches {logicMode === 'ALL' ? 'ALL' : 'ANY'} of the following conditions:
        </p>
      </div>

      <div className="space-y-3">
        {conditions.map((cond) => (
          <div
            key={cond.id}
            className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center bg-[#080E18] border border-[#152030] p-3"
          >
            {/* Field */}
            <div className="md:col-span-3">
              <label className="block text-slate-500 mb-1 text-[10px]">Field</label>
              <select
                aria-label={`Condition ${conditions.indexOf(cond) + 1} field`}
                value={cond.field}
                onChange={(e) =>
                  handleUpdateCondition(cond.id, 'field', e.target.value)
                }
                className="w-full bg-[#0E1726] border border-[#1C293D] px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
              >
                <option value="Request URI">Request URI</option>
                <option value="Request Path">Request Path</option>
                <option value="Query String">Query String</option>
                <option value="Request Header">Request Header</option>
                <option value="Request Body">Request Body</option>
                <option value="Client IP">Client IP</option>
                <option value="HTTP Method">HTTP Method</option>
              </select>
            </div>

            {/* Operator */}
            <div className="md:col-span-3">
              <label className="block text-slate-500 mb-1 text-[10px]">Operator</label>
              <select
                aria-label={`Condition ${conditions.indexOf(cond) + 1} operator`}
                value={cond.operator}
                onChange={(e) =>
                  handleUpdateCondition(cond.id, 'operator', e.target.value)
                }
                className="w-full bg-[#0E1726] border border-[#1C293D] px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
              >
                <option value="Contains (Pattern)">Contains (literal)</option>
                <option value="Equals">Equals</option>
                <option value="Starts With">Starts With</option>
                <option value="Ends With">Ends With</option>
                <option value="Regex Match">Regex Match</option>
                <option value="In CIDR Range">In CIDR Range</option>
              </select>
            </div>

            {/* Value */}
            <div className="md:col-span-5">
              <label className="block text-slate-500 mb-1 text-[10px]">Value</label>
              <input
                type="text"
                aria-label={`Condition ${conditions.indexOf(cond) + 1} value`}
                required
                maxLength={8192}
                value={cond.value}
                onChange={(e) =>
                  handleUpdateCondition(cond.id, 'value', e.target.value)
                }
                placeholder="(?i)(union|select|insert|drop|or\s+1=1)"
                className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
              />
              {cond.field === 'Request Header' && <input aria-label={`Condition ${conditions.indexOf(cond) + 1} header name`} value={cond.headerName || ''} onChange={e => handleUpdateCondition(cond.id, 'headerName', e.target.value)} placeholder="Header name, e.g. User-Agent" required maxLength={128} className="mt-2 w-full bg-[#0E1726] border border-[#1C293D] px-3 py-1.5" />}
            </div>

            {/* Action */}
            <div className="md:col-span-1 flex justify-end md:justify-center pt-4 md:pt-0">
              <button
                type="button"
                onClick={() => handleRemoveCondition(cond.id)}
                disabled={conditions.length <= 1}
                className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-[#152030] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-500 transition-colors cursor-pointer"
                title="Remove condition"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Footer controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <button
          type="button"
          onClick={handleAddCondition}
          disabled={conditions.length >= 16}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0E1726] hover:bg-[#152030] border border-[#1C293D] text-slate-200 hover:text-white transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 text-cyan-400" />
          <span>Add Condition</span>
        </button>

        <div className="flex items-center border border-[#1C293D] overflow-hidden">
          <button
            type="button"
            onClick={() => setLogicMode('ALL')}
            className={`px-3 py-1.5 transition-colors cursor-pointer ${
              logicMode === 'ALL'
                ? 'bg-blue-600 text-white font-bold'
                : 'bg-[#0E1726] text-slate-400 hover:text-white'
            }`}
          >
            ALL (AND)
          </button>
          <button
            type="button"
            onClick={() => setLogicMode('ANY')}
            className={`px-3 py-1.5 transition-colors cursor-pointer ${
              logicMode === 'ANY'
                ? 'bg-blue-600 text-white font-bold'
                : 'bg-[#0E1726] text-slate-400 hover:text-white'
            }`}
          >
            ANY (OR)
          </button>
        </div>
      </div>
    </div>
  );
}
