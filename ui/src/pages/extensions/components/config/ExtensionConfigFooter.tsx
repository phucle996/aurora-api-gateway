import { Sparkles } from 'lucide-react';

interface ExtensionConfigFooterProps {
  onClose: () => void;
}

export function ExtensionConfigFooter({ onClose }: ExtensionConfigFooterProps) {
  return (
    <div className="px-6 py-3 border-t border-border bg-muted/10 flex items-center justify-between text-xs text-muted-foreground shrink-0">
      <span className="flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5 text-primary" />
        <span>
          Configuration schema is loaded dynamically from SQLite Authority and synchronized to Dataplane Nodes.
        </span>
      </span>
      <button
        type="button"
        onClick={onClose}
        className="px-3 py-1 rounded border border-border hover:bg-muted text-foreground transition-colors cursor-pointer"
      >
        Close Workspace
      </button>
    </div>
  );
}
