import React, { useState } from 'react';
import { X } from 'lucide-react';

export function TagListInput({
  values,
  onChange,
}: {
  values: string[];
  onChange: (newVals: string[]) => void;
}) {
  const [inputVal, setInputVal] = useState('');

  const handleAdd = () => {
    const trimmed = inputVal.trim();
    if (!trimmed) return;
    if (!values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInputVal('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      handleAdd();
    }
  };

  const handleRemove = (idx: number) => {
    onChange(values.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5 min-h-[36px] p-2 bg-background border border-border rounded-lg shadow-2xs">
        {values.map((val, idx) => (
          <span
            key={idx}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-muted text-foreground border border-border/80 font-mono"
          >
            <span>{val}</span>
            <button
              type="button"
              onClick={() => handleRemove(idx)}
              className="text-muted-foreground hover:text-rose-500 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 min-w-[120px] text-xs bg-transparent border-none focus:outline-none text-foreground py-0.5"
        />
        {inputVal.trim() && (
          <button
            type="button"
            onClick={handleAdd}
            className="px-2 py-0.5 bg-primary text-primary-foreground rounded text-xs font-medium cursor-pointer"
          >
            Add
          </button>
        )}
      </div>
    </div>
  );
}
