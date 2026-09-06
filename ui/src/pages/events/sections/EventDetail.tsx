import React, { useState } from 'react';
import {
  X,
  Copy,
  Check,
  Search,
  Crosshair,
  CheckCircle2,
  Ban,
  ArrowRight,
  UserCheck,
  FileText,
  MessageSquare,
} from 'lucide-react';
import { EventItem } from './EventsTable';

interface EventDetailProps {
  event: EventItem;
  onClose?: () => void;
}

export function EventDetail({ event, onClose }: EventDetailProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyEventId = () => {
    navigator.clipboard.writeText(event.eventId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="xl:col-span-5 bg-card border border-border p-4 space-y-5 font-sans shadow-xs rounded-sm transition-colors">
      {/* Header Info */}
      <div className="flex items-start justify-between gap-3 pb-3 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-foreground font-sans tracking-tight">
              {event.title}
            </h3>
            {event.status === 'Investigating' && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 uppercase">
                Investigating
              </span>
            )}
            {event.status === 'New' && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 uppercase">
                New
              </span>
            )}
            {event.status === 'Resolved' && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-muted text-muted-foreground border border-border uppercase">
                Resolved
              </span>
            )}
          </div>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer rounded-xs"
            title="Đóng chi tiết sự kiện"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Overview Group */}
      <div className="space-y-2 text-xs">
        <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider pb-1 border-b border-border font-sans">
          Overview
        </h4>
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between py-0.5">
            <span className="text-muted-foreground">Time:</span>
            <span className="text-muted-foreground text-[11px]">{event.time} UTC</span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-muted-foreground">Source IP:</span>
            <span className="text-foreground font-bold">{event.sourceIp}</span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-muted-foreground">Host:</span>
            <span className="text-foreground">{event.host}</span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-muted-foreground">Method:</span>
            <span className="text-foreground font-bold">{event.method}</span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-muted-foreground">Action:</span>
            {event.action === 'BLOCK' && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-destructive/10 text-destructive border border-destructive/20">
                BLOCK
              </span>
            )}
            {event.action === 'LOG' && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-primary/10 text-primary border border-primary/20">
                LOG
              </span>
            )}
            {event.action === 'RATE LIMIT' && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20">
                RATE LIMIT
              </span>
            )}
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-muted-foreground">Severity:</span>
            {event.severity === 'Critical' && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-destructive/15 text-destructive border border-destructive/30 uppercase">
                Critical
              </span>
            )}
            {event.severity === 'High' && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 uppercase">
                High
              </span>
            )}
            {event.severity === 'Medium' && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20 uppercase">
                Medium
              </span>
            )}
            {event.severity === 'Low' && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-muted text-muted-foreground border border-border uppercase">
                Low
              </span>
            )}
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-muted-foreground">Rule:</span>
            <span className="text-foreground">{event.rule}</span>
          </div>
        </div>
      </div>

      {/* Request Details Group */}
      <div className="space-y-2 text-xs">
        <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider pb-1 border-b border-border font-sans">
          Request Details
        </h4>
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between py-0.5">
            <span className="text-muted-foreground">Path:</span>
            <span className="text-foreground">{event.path}</span>
          </div>

          <div className="space-y-1 pt-1">
            <div className="text-muted-foreground">Query String:</div>
            <div className="bg-muted/50 border border-border px-2.5 py-1.5 rounded-xs">
              <code className="text-[11px] text-primary select-all break-all">
                {event.queryString}
              </code>
            </div>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-muted-foreground">User Agent:</span>
            <span className="text-muted-foreground text-[11px]">{event.userAgent}</span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-muted-foreground">Country:</span>
            <div className="flex items-center gap-1.5">
              <span>{event.countryFlag}</span>
              <span className="text-foreground font-bold">{event.countryCode}</span>
            </div>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-muted-foreground">Event ID:</span>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-[11px]">{event.eventId}</span>
              <button
                type="button"
                onClick={handleCopyEventId}
                className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer border border-border rounded-xs"
                title="Copy Event ID"
              >
                {copied ? (
                  <Check className="w-3 h-3 text-primary" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Response Group */}
      <div className="space-y-2 text-xs">
        <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider pb-1 border-b border-border font-sans">
          Response
        </h4>
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between py-0.5">
            <span className="text-muted-foreground">Status Code:</span>
            <span className="text-foreground font-bold">
              {event.response.statusCode}
            </span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-muted-foreground">Audit Logged:</span>
            <span className="text-foreground">
              {event.response.auditLogged}
            </span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-muted-foreground">WAF Node:</span>
            <span className="text-muted-foreground text-[11px]">
              {event.response.wafNode}
            </span>
          </div>
        </div>
      </div>

      {/* Action Buttons Grid */}
      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
        <button
          type="button"
          className="bg-primary hover:bg-primary/90 active:bg-primary/80 text-primary-foreground text-xs font-semibold px-3 py-2 flex items-center justify-center gap-1.5 transition-colors cursor-pointer font-sans uppercase tracking-wider rounded-sm shadow-xs"
        >
          <Search className="w-3.5 h-3.5" />
          <span>View request</span>
        </button>

        <button
          type="button"
          className="bg-card hover:bg-muted text-foreground border border-border text-xs font-medium px-3 py-2 flex items-center justify-center gap-1.5 transition-colors cursor-pointer font-sans uppercase tracking-wider rounded-sm shadow-xs"
        >
          <Crosshair className="w-3.5 h-3.5 text-muted-foreground" />
          <span>Investigate</span>
        </button>

        <button
          type="button"
          className="bg-card hover:bg-muted text-foreground border border-border text-xs font-medium px-3 py-2 flex items-center justify-center gap-1.5 transition-colors cursor-pointer font-sans uppercase tracking-wider rounded-sm shadow-xs"
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground" />
          <span>Mark resolved</span>
        </button>

        <button
          type="button"
          className="bg-card hover:bg-muted text-foreground border border-border text-xs font-medium px-3 py-2 flex items-center justify-center gap-1.5 transition-colors cursor-pointer font-sans uppercase tracking-wider rounded-sm shadow-xs"
        >
          <Ban className="w-3.5 h-3.5 text-muted-foreground" />
          <span>Create IP block</span>
        </button>
      </div>

      {/* Recent Notes Group */}
      <div className="space-y-2 pt-2 border-t border-border">
        <div className="flex items-center justify-between">
          <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider font-sans">
            Recent Notes
          </h4>
          <a
            href="#notes"
            className="text-[11px] text-primary hover:text-primary/80 flex items-center gap-1 font-medium transition-colors"
          >
            <span>View all</span>
            <ArrowRight className="w-3 h-3" />
          </a>
        </div>

        <div className="space-y-2 text-xs">
          {event.recentNotes.map((note, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between text-slate-500 dark:text-slate-400 py-0.5"
            >
              <div className="flex items-center gap-1.5">
                {note.icon === 'user' && (
                  <UserCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                )}
                {note.icon === 'file' && (
                  <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                )}
                {note.icon === 'message' && (
                  <MessageSquare className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                )}
                <span className="text-slate-800 dark:text-slate-300">{note.note}</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-slate-600 dark:text-slate-400">{note.user}</span>
                <span className="text-slate-400 dark:text-slate-500 text-[10px]">
                  {note.date}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
