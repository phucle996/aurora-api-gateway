import React, { useState } from 'react';
import { EventsStats } from './sections/EventsStats';
import { EventsTable, EventItem } from './sections/EventsTable';
import { EventDetail } from './sections/EventDetail';

export default function SecurityEventsPage() {
  const [events] = useState<EventItem[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('All Actions');
  const [severityFilter, setSeverityFilter] = useState('All Severities');
  const [hostFilter, setHostFilter] = useState('All Hosts');
  const [timeFilter, setTimeFilter] = useState('Last 24 Hours');

  const selectedEvent =
    events.find((e) => e.id === selectedEventId) || null;

  const filteredEvents = events.filter((e) => {
    const matchesSearch =
      e.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.sourceIp.includes(searchQuery) ||
      e.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.rule.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesAction =
      actionFilter === 'All Actions' || e.action === actionFilter;
    const matchesSeverity =
      severityFilter === 'All Severities' || e.severity === severityFilter;
    const matchesHost =
      hostFilter === 'All Hosts' || e.host === hostFilter;

    return matchesSearch && matchesAction && matchesSeverity && matchesHost;
  });

  return (
    <div className="p-6 w-full space-y-4 font-sans selection:bg-emerald-500/30 selection:text-emerald-200">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight font-sans">
              Security Events
            </h1>
            <span className="px-2 py-0.5 text-[10px] font-sans font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700 uppercase rounded-xs">
              LIVE MONITORING
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-sans">
            Inspect blocked, logged, and suspicious requests across protected applications.
          </p>
        </div>
      </div>

      {/* 4 Summary Stat Cards Section */}
      <EventsStats events={events} />

      {/* Table + Details Grid Section */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <EventsTable
          events={filteredEvents}
          selectedId={selectedEventId || ''}
          onSelect={(id) => setSelectedEventId(selectedEventId === id ? null : id)}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          actionFilter={actionFilter}
          onActionFilterChange={setActionFilter}
          severityFilter={severityFilter}
          onSeverityFilterChange={setSeverityFilter}
          hostFilter={hostFilter}
          onHostFilterChange={setHostFilter}
          timeFilter={timeFilter}
          onTimeFilterChange={setTimeFilter}
        />

        {selectedEvent && (
          <EventDetail
            event={selectedEvent}
            onClose={() => setSelectedEventId(null)}
          />
        )}
      </div>
    </div>
  );
}

