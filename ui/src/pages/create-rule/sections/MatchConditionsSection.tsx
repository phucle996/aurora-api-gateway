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
    <div className="bg-card border border-border p-4 space-y-4 font-sans text-xs">
      <div>
        <div className="text-sm font-semibold text-foreground">
          2. Match Conditions
        </div>
        <p className="text-muted-foreground text-[11px] mt-0.5 font-sans">
          When a request matches {logicMode === 'ALL' ? 'ALL' : 'ANY'} of the following conditions:
        </p>
      </div>

      <div className="space-y-3">
        {conditions.map((cond, idx) => (
          <div
            key={cond.id}
            className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center bg-muted/30 border border-border p-3"
          >
            {/* Field */}
            <div className="md:col-span-3">
              <div className="flex items-center gap-1.5 mb-1">
                {idx > 0 && (
                  <span className="px-1.5 py-0.5 bg-primary text-primary-foreground text-[9px] font-bold rounded-xs tracking-wider uppercase">
                    {logicMode === 'ALL' ? 'AND' : 'OR'}
                  </span>
                )}
                <label className="text-muted-foreground text-[10px]">Field</label>
              </div>
              <select
                aria-label={`Condition ${conditions.indexOf(cond) + 1} field`}
                value={cond.field}
                onChange={(e) =>
                  handleUpdateCondition(cond.id, 'field', e.target.value)
                }
                className="w-full bg-background border border-input px-2.5 py-1.5 text-foreground focus:outline-none focus:border-primary cursor-pointer"
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
              <label className="block text-muted-foreground mb-1 text-[10px]">Operator</label>
              <select
                aria-label={`Condition ${conditions.indexOf(cond) + 1} operator`}
                value={cond.operator}
                onChange={(e) =>
                  handleUpdateCondition(cond.id, 'operator', e.target.value)
                }
                className="w-full bg-background border border-input px-2.5 py-1.5 text-foreground focus:outline-none focus:border-primary cursor-pointer"
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
              <label className="block text-muted-foreground mb-1 text-[10px]">Value</label>
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
                className="w-full bg-background border border-input px-3 py-1.5 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary"
              />
              {cond.field === 'Request Header' && (
                <input
                  aria-label={`Condition ${conditions.indexOf(cond) + 1} header name`}
                  value={cond.headerName || ''}
                  onChange={(e) => handleUpdateCondition(cond.id, 'headerName', e.target.value)}
                  placeholder="Header name, e.g. User-Agent"
                  required
                  maxLength={128}
                  className="mt-2 w-full bg-background border border-input px-3 py-1.5 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary"
                />
              )}
            </div>

            {/* Action */}
            <div className="md:col-span-1 flex justify-end md:justify-center pt-4 md:pt-0">
              <button
                type="button"
                onClick={() => handleRemoveCondition(cond.id)}
                disabled={conditions.length <= 1}
                className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground transition-colors cursor-pointer"
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
          className="flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-accent border border-border text-foreground transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 text-primary" />
          <span>Add Condition</span>
        </button>

        <div className="flex items-center border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => setLogicMode('ALL')}
            className={`px-3 py-1.5 transition-colors cursor-pointer ${
              logicMode === 'ALL'
                ? 'bg-primary text-primary-foreground font-bold'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            ALL (AND)
          </button>
          <button
            type="button"
            onClick={() => setLogicMode('ANY')}
            className={`px-3 py-1.5 transition-colors cursor-pointer ${
              logicMode === 'ANY'
                ? 'bg-primary text-primary-foreground font-bold'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            ANY (OR)
          </button>
        </div>
      </div>
    </div>
  );
}
