import React from 'react';
import { Plus, Trash2, HelpCircle } from 'lucide-react';
import type { Condition } from '../../create-rule/sections/MatchConditionsSection';

interface EditMatchConditionsProps {
  conditions: Condition[];
  setConditions: React.Dispatch<React.SetStateAction<Condition[]>>;
  logicMode: 'ALL' | 'ANY';
  setLogicMode: (mode: 'ALL' | 'ANY') => void;
}

export function EditMatchConditionsSection({
  conditions,
  setConditions,
  logicMode,
  setLogicMode,
}: EditMatchConditionsProps) {
  const handleAddCondition = () => {
    const newCond: Condition = {
      id: Math.random().toString(36).substring(2, 9),
      field: 'Query Parameter',
      operator: 'Contains (Pattern)',
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
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-foreground">
            2. Match Conditions
          </div>
          <p className="text-muted-foreground text-[11px] mt-0.5">
            When a request matches {logicMode === 'ALL' ? 'ALL' : 'ANY'} of the following conditions:
          </p>
        </div>

        {/* Hover-based Rule Logic Guide */}
        <div className="relative group inline-block">
          <div
            tabIndex={0}
            role="button"
            aria-label="Rule Logic Guide"
            className="flex items-center gap-1.5 text-primary hover:text-primary/80 text-xs transition-colors cursor-pointer py-1 select-none"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>Rule Logic Guide</span>
          </div>

          <div className="absolute right-0 top-full mt-2 w-72 p-3 bg-card border border-border text-foreground rounded-md shadow-xl opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-all duration-200 z-50 font-sans">
            <div className="font-semibold text-xs text-foreground mb-1.5 flex items-center gap-1.5 font-mono">
              <span className="w-2 h-2 rounded-full bg-primary inline-block"></span>
              Rule Logic Guide
            </div>
            <div className="space-y-1.5 text-[11px] text-muted-foreground leading-relaxed">
              <p>
                <strong className="text-foreground font-semibold">ALL (AND):</strong> Every condition in the rule must evaluate to true for the action to trigger.
              </p>
              <p>
                <strong className="text-foreground font-semibold">ANY (OR):</strong> Any single condition evaluating to true will trigger the action.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {conditions.map((cond, idx) => (
          <div
            key={cond.id}
            className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center bg-muted/30 border border-border p-3"
          >
            {/* Connector Badge or Field label */}
            <div className="md:col-span-3">
              <div className="flex items-center gap-1.5 mb-1">
                {idx > 0 && (
                  <span className="px-1.5 py-0.5 bg-primary text-primary-foreground text-[9px] font-bold rounded-xs tracking-wider uppercase">
                    {logicMode === 'ALL' ? 'AND' : 'OR'}
                  </span>
                )}
                <span className="text-muted-foreground text-[10px]">Field</span>
              </div>
              <select
                value={cond.field}
                onChange={(e) =>
                  handleUpdateCondition(cond.id, 'field', e.target.value)
                }
                className="w-full bg-background border border-input px-2.5 py-1.5 text-foreground focus:outline-none focus:border-primary cursor-pointer"
              >
                <option value="Request URI">Request URI</option>
                <option value="Query Parameter">Query Parameter</option>
                <option value="Request Body">Request Body</option>
                <option value="Request Path">Request Path</option>
                <option value="Request Header">Request Header</option>
                <option value="Client IP">Client IP</option>
                <option value="HTTP Method">HTTP Method</option>
              </select>
            </div>

            {/* Operator */}
            <div className="md:col-span-3">
              <label className="block text-muted-foreground mb-1 text-[10px]">Operator</label>
              <select
                value={cond.operator}
                onChange={(e) =>
                  handleUpdateCondition(cond.id, 'operator', e.target.value)
                }
                className="w-full bg-background border border-input px-2.5 py-1.5 text-foreground focus:outline-none focus:border-primary cursor-pointer"
              >
                <option value="Contains (Pattern)">Contains (Pattern)</option>
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
                value={cond.value}
                onChange={(e) =>
                  handleUpdateCondition(cond.id, 'value', e.target.value)
                }
                placeholder="(?i)(union|select|insert|drop|or\s+1=1)"
                className="w-full bg-background border border-input px-3 py-1.5 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary font-mono text-[11px]"
              />
            </div>

            {/* Delete button */}
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
