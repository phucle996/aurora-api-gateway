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
    <div className="bg-card border border-border p-4 space-y-4 font-sans text-xs">
      <div>
        <div className="text-sm font-semibold text-foreground">
          3. Match Conditions (Optional)
        </div>
        <p className="text-muted-foreground text-[11px] mt-0.5 font-sans">
          Apply this rate limit only when ALL conditions match.
        </p>
      </div>

      <div className="space-y-2.5">
        {conditions.map((cond) => (
          <div
            key={cond.id}
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 bg-muted/30 border border-border p-2"
          >
            {/* Field */}
            <select
              value={cond.field}
              onChange={(e) =>
                handleUpdateCondition(cond.id, 'field', e.target.value)
              }
              className="bg-background border border-input px-3 py-1.5 text-foreground focus:outline-none focus:border-primary cursor-pointer text-xs sm:w-1/3"
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
              className="bg-background border border-input px-3 py-1.5 text-foreground focus:outline-none focus:border-primary cursor-pointer text-xs sm:w-1/3"
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
              className="flex-1 bg-background border border-input px-3 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary text-xs"
            />

            {/* Delete button */}
            <button
              type="button"
              onClick={() => handleRemoveCondition(cond.id)}
              className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors self-end sm:self-center cursor-pointer"
              title="Delete Condition"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={handleAddCondition}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-background hover:bg-muted border border-border text-primary hover:text-primary/80 text-xs cursor-pointer transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Condition</span>
        </button>
      </div>
    </div>
  );
}
