import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, RefreshCw, AlertCircle, CheckCircle2, ShieldCheck, Radio } from 'lucide-react';
import {
  accessApi,
  type AccessObject,
  type AccessStatus,
  type AccessActivity,
  type AccessChange,
} from '../../lib/api/access';
import { IpAccessStatsCards } from './sections/IpAccessStatsCards';
import { IpAccessTabsNav, type AccessTabKey } from './sections/IpAccessTabsNav';
import { AccessRulesTab } from './sections/AccessRulesTab';
import { IpGroupsTab } from './sections/IpGroupsTab';
import { DatasetsTab } from './sections/DatasetsTab';
import { AccessActivityTab } from './sections/AccessActivityTab';
import { AccessHistoryDrawer } from './sections/AccessHistoryDrawer';

export default function IpAccessPage() {
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab') || 'rules';
  const activeTab: AccessTabKey = ['rules', 'groups', 'datasets', 'activity'].includes(rawTab)
    ? (rawTab as AccessTabKey)
    : 'rules';

  const [items, setItems] = useState<AccessObject[]>([]);
  const [status, setStatus] = useState<AccessStatus | null>(null);
  const [activity, setActivity] = useState<AccessActivity[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [selected, setSelected] = useState<AccessObject | null>(null);
  const [history, setHistory] = useState<AccessObject[]>([]);
  const receipt = useRef<{ body: string; key: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [rows, s, events] = await Promise.all([
        accessApi.list(),
        accessApi.status(),
        accessApi.activity(),
      ]);
      setItems(rows);
      setStatus(s);
      setActivity(events);
      setError('');
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    let live = true;
    setHistory([]);
    if (selected) {
      accessApi
        .list(selected.id, true)
        .then((rows) => {
          if (live) setHistory(rows);
        })
        .catch((e) => {
          if (live) setError(String(e));
        });
    }
    return () => {
      live = false;
    };
  }, [selected]);

  const change = async (command: AccessChange) => {
    if (busy) return;
    setBusy(true);
    setError('');
    const body = JSON.stringify(command);
    if (receipt.current?.body !== body) {
      receipt.current = { body, key: crypto.randomUUID() };
    }
    try {
      const result = await accessApi.change(command, receipt.current.key);
      receipt.current = null;
      setNotice(`Changes applied successfully. Deployment #${result.release_id} active across edge nodes.`);
      setSelected(null);
      await refresh();
      setTimeout(() => setNotice(''), 6000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async (item: AccessObject, _version: number, doc: unknown) => {
    if (!status) return;
    await change({
      id: item.id,
      kind: item.kind,
      expected_version: item.version,
      expected_release: status.release_id,
      delete: false,
      document: doc,
    });
  };

  const rules = items.filter((x) => x.kind === 'rule');
  const groups = items.filter((x) => x.kind === 'group');
  const datasets = items.filter((x) => x.kind === 'dataset');

  return (
    <div className="p-6 w-full space-y-5 font-sans">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-[#172338] pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
              IP & Access Control
            </h1>
            {status && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/60">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                </span>
                Release #{status.release_id}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Deterministic edge perimeter filtering, CIDR lists, IP groups, and Geo/ASN custom datasets.
          </p>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => void refresh()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] hover:border-slate-300 dark:hover:border-[#223552] rounded-xs shadow-xs transition-colors cursor-pointer"
            title="Refresh access state"
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
            <span>Refresh</span>
          </button>

          <Link
            to="/ip-access/create"
            className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xs shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Access Rule</span>
          </Link>
        </div>
      </div>

      {/* Alerts / Feedback */}
      {error && (
        <div
          role="alert"
          className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between rounded-xs"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setError('');
              void refresh();
            }}
            className="text-xs font-bold underline hover:opacity-80 cursor-pointer ml-4 shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300 text-xs flex items-center justify-between rounded-xs"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
            <span>{notice}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotice('')}
            className="text-xs font-semibold hover:opacity-80 cursor-pointer ml-4 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {!loaded && !error && (
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 py-4">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-500" />
          <span>Loading IP & Access configuration…</span>
        </div>
      )}

      {loaded && (
        <>
          {/* Real-time KPI Stats Cards */}
          <IpAccessStatsCards items={items} status={status} />

          {/* Animated Sliding Tabs Navigation */}
          <IpAccessTabsNav
            activeTab={activeTab}
            onTabChange={(t) => setParams({ tab: t })}
            counts={{
              rules: rules.length,
              groups: groups.length,
              datasets: datasets.length,
              activity: activity.length,
            }}
          />

          {/* Active Tab View */}
          <div className="pt-1">
            {activeTab === 'rules' && (
              <AccessRulesTab
                items={items}
                busy={busy}
                status={status}
                onChange={change}
                onSelectHistory={(item) => setSelected(item)}
              />
            )}

            {activeTab === 'groups' && (
              <IpGroupsTab
                items={items}
                busy={busy}
                status={status}
                onChange={change}
                onSelectHistory={(item) => setSelected(item)}
              />
            )}

            {activeTab === 'datasets' && (
              <DatasetsTab
                items={items}
                busy={busy}
                status={status}
                onChange={change}
                onSelectHistory={(item) => setSelected(item)}
              />
            )}

            {activeTab === 'activity' && (
              <AccessActivityTab activity={activity} />
            )}
          </div>
        </>
      )}

      {/* Revision History Slide-over Drawer */}
      <AccessHistoryDrawer
        selected={selected}
        history={history}
        busy={busy}
        status={status}
        onClose={() => setSelected(null)}
        onRestore={handleRestore}
      />
    </div>
  );
}
