import type { DomainItem } from '../types';
interface DomainDrawerProps {
 domain: DomainItem | null; onClose: () => void; onEdit: (d: DomainItem) => void;
 onDelete: (d: DomainItem) => void; onAddTag: (id: string, tag: string) => void;
 onUpdateDomain: (d: DomainItem) => void;
}
export function DomainDrawer({domain, onClose, onEdit, onDelete}: DomainDrawerProps) {
 if (!domain) return null;
 return <aside className="w-full lg:w-[420px] border border-border rounded bg-card p-5 space-y-4">
  <div className="flex justify-between gap-3"><h2 className="font-semibold break-all">{domain.domain}</h2><button onClick={onClose} aria-label="Close details">✕</button></div>
  <dl className="text-sm space-y-3">
   {Object.entries({'Root domain': domain.rootDomain, 'Saved routing status': domain.status,
    'Upstream target': domain.upstream, 'Created at': domain.createdAt, 'Created by': domain.createdBy,
    'Updated at': domain.updatedAt, 'Description': domain.description || '—', 'Tags': domain.tags.join(', ') || '—'
   }).map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="break-all">{value}</dd></div>)}
  </dl>
  <p className="text-xs text-muted-foreground">Routing is applied asynchronously on nodes. Runtime activation and origin health are not reported in this detail view.</p>
  <p className="text-xs text-muted-foreground">Edge TLS is not provisioned. Stored TLS preference: {domain.tlsType}. No verified certificate or renewal status is available.</p>
  <div className="flex gap-3"><button onClick={() => onEdit(domain)} className="text-primary">Edit domain</button><button onClick={() => onDelete(domain)} className="text-destructive">Delete domain</button></div>
 </aside>;
}
