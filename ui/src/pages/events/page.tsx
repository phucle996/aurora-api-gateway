import React, { useState } from 'react';
import { EventsStats } from './sections/EventsStats';
import { EventsTable, EventItem } from './sections/EventsTable';
import { EventDetail } from './sections/EventDetail';

const initialEvents: EventItem[] = [
  {
    id: '1',
    eventId: 'evt_9f2a31',
    title: 'SQLi attempt on /api/v1/search',
    time: '2026-09-05 08:26',
    sourceIp: '185.24.91.17',
    host: 'api.example.com',
    method: 'GET',
    path: '/api/v1/search',
    action: 'BLOCK',
    severity: 'Critical',
    rule: 'SQLi Union Select',
    status: 'Investigating',
    queryString: "q=' union select password from users --",
    userAgent: 'python-requests/2.31',
    country: 'Germany',
    countryCode: 'DE',
    countryFlag: '🇩🇪',
    response: {
      statusCode: 403,
      auditLogged: 'Enabled',
      wafNode: 'edge-nginx-02',
    },
    recentNotes: [
      {
        icon: 'user',
        note: 'Analyst assigned',
        user: 'Admin User',
        date: '2026-09-05 08:32 UTC',
      },
      {
        icon: 'file',
        note: 'Matched policy Global Web Policy',
        user: 'Admin User',
        date: '2026-09-05 08:28 UTC',
      },
      {
        icon: 'message',
        note: 'Temporary IP block recommended',
        user: 'SecOps',
        date: '2026-09-05 08:27 UTC',
      },
    ],
  },
  {
    id: '2',
    eventId: 'evt_8c1b22',
    title: 'Brute force attempt on /login',
    time: '2026-09-05 07:41',
    sourceIp: '203.0.113.42',
    host: 'app.example.com',
    method: 'POST',
    path: '/login',
    action: 'LOG',
    severity: 'High',
    rule: 'Brute Force ...',
    status: 'New',
    queryString: 'auth_mode=pwd&remember=true',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    country: 'United States',
    countryCode: 'US',
    countryFlag: '🇺🇸',
    response: {
      statusCode: 200,
      auditLogged: 'Enabled',
      wafNode: 'edge-nginx-01',
    },
    recentNotes: [
      {
        icon: 'user',
        note: 'Auto flagged by anomaly engine',
        user: 'System',
        date: '2026-09-05 07:41 UTC',
      },
    ],
  },
  {
    id: '3',
    eventId: 'evt_7d9e14',
    title: 'Unauthorized access to /admin/users',
    time: '2026-09-05 06:18',
    sourceIp: '198.51.100.23',
    host: 'admin.aurora.local',
    method: 'GET',
    path: '/admin/users',
    action: 'BLOCK',
    severity: 'High',
    rule: 'Admin Path ...',
    status: 'Resolved',
    queryString: 'role=superuser&limit=100',
    userAgent: 'curl/7.88.1',
    country: 'United Kingdom',
    countryCode: 'GB',
    countryFlag: '🇬🇧',
    response: {
      statusCode: 403,
      auditLogged: 'Enabled',
      wafNode: 'edge-nginx-02',
    },
    recentNotes: [
      {
        icon: 'message',
        note: 'Confirmed external scan attempt',
        user: 'SecOps',
        date: '2026-09-05 06:20 UTC',
      },
    ],
  },
  {
    id: '4',
    eventId: 'evt_6a8f55',
    title: 'Rate limit triggered on /wp-login.php',
    time: '2026-09-05 05:03',
    sourceIp: '192.0.2.56',
    host: 'app.example.com',
    method: 'POST',
    path: '/wp-login.php',
    action: 'RATE LIMIT',
    severity: 'Medium',
    rule: 'Login Rate L...',
    status: 'New',
    queryString: 'action=postpass',
    userAgent: 'Go-http-client/1.1',
    country: 'France',
    countryCode: 'FR',
    countryFlag: '🇫🇷',
    response: {
      statusCode: 429,
      auditLogged: 'Enabled',
      wafNode: 'edge-nginx-01',
    },
    recentNotes: [
      {
        icon: 'file',
        note: 'Rate throttled for 15 minutes',
        user: 'System',
        date: '2026-09-05 05:03 UTC',
      },
    ],
  },
  {
    id: '5',
    eventId: 'evt_5e4c90',
    title: 'GraphQL introspection attack on /graphql',
    time: '2026-09-05 03:27',
    sourceIp: '203.0.113.88',
    host: 'api.example.com',
    method: 'POST',
    path: '/graphql',
    action: 'BLOCK',
    severity: 'Medium',
    rule: 'GraphQL Int...',
    status: 'Investigating',
    queryString: 'query={__schema{types{name}}}',
    userAgent: 'insomnia/8.4.5',
    country: 'Japan',
    countryCode: 'JP',
    countryFlag: '🇯🇵',
    response: {
      statusCode: 403,
      auditLogged: 'Enabled',
      wafNode: 'edge-nginx-02',
    },
    recentNotes: [
      {
        icon: 'user',
        note: 'Assigned to DevSecOps team',
        user: 'Admin User',
        date: '2026-09-05 03:30 UTC',
      },
    ],
  },
  {
    id: '6',
    eventId: 'evt_4b3a19',
    title: 'Suspicious token header on /api/auth',
    time: '2026-09-05 01:12',
    sourceIp: '10.23.45.67',
    host: 'app.example.com',
    method: 'POST',
    path: '/api/auth',
    action: 'LOG',
    severity: 'Low',
    rule: 'Suspicious ...',
    status: 'Resolved',
    queryString: 'client_id=web_app&grant_type=refresh',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    country: 'Internal',
    countryCode: 'LAN',
    countryFlag: '🌐',
    response: {
      statusCode: 200,
      auditLogged: 'Enabled',
      wafNode: 'edge-nginx-01',
    },
    recentNotes: [
      {
        icon: 'file',
        note: 'Marked false positive from internal QA',
        user: 'Admin User',
        date: '2026-09-05 01:25 UTC',
      },
    ],
  },
];

export default function SecurityEventsPage() {
  const [events] = useState<EventItem[]>(initialEvents);
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
          <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-[#152030]">
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
          <EventsStats />

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

