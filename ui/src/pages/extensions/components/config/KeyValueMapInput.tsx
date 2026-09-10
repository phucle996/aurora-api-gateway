import { useState } from 'react';
import { Trash2 } from 'lucide-react';

export function KeyValueMapInput({
  value,
  onChange,
}: {
  value: Record<string, string>;
  onChange: (newMap: Record<string, string>) => void;
}) {
  const entries = Object.entries(value || {});
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');

  const handleAdd = () => {
    if (!newKey.trim()) return;
    onChange({ ...value, [newKey.trim()]: newVal });
    setNewKey('');
    setNewVal('');
  };

  const handleRemove = (k: string) => {
    const copy = { ...value };
    delete copy[k];
    onChange(copy);
  };

  return (
    <div className="space-y-2">
      <div className="border border-border rounded-lg overflow-hidden divide-y divide-border bg-background shadow-2xs">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between px-3 py-2 text-xs">
            <span className="font-mono font-semibold text-foreground">{k}</span>
            <span className="text-muted-foreground font-mono truncate max-w-[200px]">
              {typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '')}
            </span>
            <button
              type="button"
              onClick={() => handleRemove(k)}
              className="text-muted-foreground hover:text-rose-500 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-2 p-2 bg-muted/20">
          <input
            type="text"
            placeholder="Key"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAdd();
              }
            }}
            className="flex-1 px-2.5 py-1 bg-background border border-border rounded text-xs text-foreground focus:outline-none font-mono"
          />
          <input
            type="text"
            placeholder="Value"
            value={newVal}
            onChange={(e) => setNewVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAdd();
              }
            }}
            className="flex-1 px-2.5 py-1 bg-background border border-border rounded text-xs text-foreground focus:outline-none font-mono"
          />
          <button
            type="button"
            onClick={handleAdd}
            className="px-3 py-1 bg-primary text-primary-foreground rounded text-xs font-medium cursor-pointer hover:bg-primary/90 transition-colors"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
