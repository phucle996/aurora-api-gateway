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
    <div className="xl:col-span-5 bg-[#0B1320] border border-[#172338] p-4 space-y-5 font-mono">
      {/* Header Info */}
      <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#172338]">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-white font-sans tracking-tight">
              {event.title}
            </h3>
            {event.status === 'Investigating' && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-700 uppercase">
                Investigating
              </span>
            )}
            {event.status === 'New' && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-700 uppercase">
                New
              </span>
            )}
            {event.status === 'Resolved' && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-slate-900 text-slate-400 border border-slate-700 uppercase">
                Resolved
              </span>
            )}
          </div>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-200 hover:bg-[#152338] transition-colors cursor-pointer"
            title="Đóng chi tiết sự kiện"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Overview Group */}
      <div className="space-y-2 text-xs">
        <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider pb-1 border-b border-[#172338]/60 font-sans">
          Overview
        </h4>
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Time:</span>
            <span className="text-slate-300 text-[11px]">{event.time} UTC</span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Source IP:</span>
            <span className="text-slate-200 font-bold">{event.sourceIp}</span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Host:</span>
            <span className="text-slate-200">{event.host}</span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Method:</span>
            <span className="text-slate-200 font-bold">{event.method}</span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Action:</span>
            {event.action === 'BLOCK' && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-[#3E1418] text-[#FCA5A5] border border-red-800">
                BLOCK
              </span>
            )}
            {event.action === 'LOG' && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-blue-950 text-blue-300 border border-blue-800">
                LOG
              </span>
            )}
            {event.action === 'RATE LIMIT' && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-800">
                RATE LIMIT
              </span>
            )}
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Severity:</span>
            {event.severity === 'Critical' && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-[#451216] text-[#FCA5A5] border border-red-700 uppercase">
                Critical
              </span>
            )}
            {event.severity === 'High' && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800 uppercase">
                High
              </span>
            )}
            {event.severity === 'Medium' && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-yellow-950 text-yellow-300 border border-yellow-800 uppercase">
                Medium
              </span>
            )}
            {event.severity === 'Low' && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700 uppercase">
                Low
              </span>
            )}
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Rule:</span>
            <span className="text-slate-200">{event.rule}</span>
          </div>
        </div>
      </div>

      {/* Request Details Group */}
      <div className="space-y-2 text-xs">
        <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider pb-1 border-b border-[#172338]/60 font-sans">
          Request Details
        </h4>
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Path:</span>
            <span className="text-slate-200">{event.path}</span>
          </div>

          <div className="space-y-1 pt-1">
            <div className="text-slate-400">Query String:</div>
            <div className="bg-[#080E18] border border-[#172338] px-2.5 py-1.5">
              <code className="text-[11px] text-emerald-300 select-all break-all">
                {event.queryString}
              </code>
            </div>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">User Agent:</span>
            <span className="text-slate-300 text-[11px]">{event.userAgent}</span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Country:</span>
            <div className="flex items-center gap-1.5">
              <span>{event.countryFlag}</span>
              <span className="text-slate-200 font-bold">{event.countryCode}</span>
            </div>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Event ID:</span>
            <div className="flex items-center gap-2">
              <span className="text-slate-300 text-[11px]">{event.eventId}</span>
              <button
                type="button"
                onClick={handleCopyEventId}
                className="p-1 text-slate-400 hover:text-slate-200 hover:bg-[#152338] transition-colors cursor-pointer border border-[#1C293D]"
                title="Copy Event ID"
              >
                {copied ? (
                  <Check className="w-3 h-3 text-emerald-400" />
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
        <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider pb-1 border-b border-[#172338]/60 font-sans">
          Response
        </h4>
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Status Code:</span>
            <span className="text-slate-200 font-bold">
              {event.response.statusCode}
            </span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Audit Logged:</span>
            <span className="text-slate-200">
              {event.response.auditLogged}
            </span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">WAF Node:</span>
            <span className="text-slate-300 text-[11px]">
              {event.response.wafNode}
            </span>
          </div>
        </div>
      </div>

      {/* Action Buttons Grid */}
      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#172338]">
        <button
          type="button"
          className="bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-semibold px-3 py-2 flex items-center justify-center gap-1.5 transition-colors cursor-pointer font-sans uppercase tracking-wider"
        >
          <Search className="w-3.5 h-3.5" />
          <span>View request</span>
        </button>

        <button
          type="button"
          className="bg-[#0E1726] hover:bg-[#142034] text-slate-200 border border-[#1C293D] text-xs font-medium px-3 py-2 flex items-center justify-center gap-1.5 transition-colors cursor-pointer font-sans uppercase tracking-wider"
        >
          <Crosshair className="w-3.5 h-3.5 text-slate-400" />
          <span>Investigate</span>
        </button>

        <button
          type="button"
          className="bg-[#0E1726] hover:bg-[#142034] text-slate-200 border border-[#1C293D] text-xs font-medium px-3 py-2 flex items-center justify-center gap-1.5 transition-colors cursor-pointer font-sans uppercase tracking-wider"
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-slate-400" />
          <span>Mark resolved</span>
        </button>

        <button
          type="button"
          className="bg-[#0E1726] hover:bg-[#142034] text-slate-200 border border-[#1C293D] text-xs font-medium px-3 py-2 flex items-center justify-center gap-1.5 transition-colors cursor-pointer font-sans uppercase tracking-wider"
        >
          <Ban className="w-3.5 h-3.5 text-slate-400" />
          <span>Create IP block</span>
        </button>
      </div>

      {/* Recent Notes Group */}
      <div className="space-y-2 pt-2 border-t border-[#172338]">
        <div className="flex items-center justify-between">
          <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider font-sans">
            Recent Notes
          </h4>
          <a
            href="#notes"
            className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-medium transition-colors"
          >
            <span>View all</span>
            <ArrowRight className="w-3 h-3" />
          </a>
        </div>

        <div className="space-y-2 text-xs">
          {event.recentNotes.map((note, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between text-slate-400 py-0.5"
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
                <span className="text-slate-300">{note.note}</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-slate-400">{note.user}</span>
                <span className="text-slate-500 text-[10px]">
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
