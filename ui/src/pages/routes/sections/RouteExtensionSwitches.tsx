import React, { useEffect, useState } from 'react';
import { Layers, RotateCcw, Sparkles, CheckCircle2, Ban } from 'lucide-react';
import { extensionsApi } from '../../../lib/api';
import {
  DATAPLANE_EXTENSION_CATALOG,
  normalizeExtensionKey,
  resolveExtensionProfiles,
} from '../../extensions/data/extensionProfiles';

export interface RouteExtensionItem {
  key: string;
  label: string;
  shortLabel: string;
  category: 'performance' | 'security' | 'traffic';
}

export const ROUTE_EXTENSIONS: RouteExtensionItem[] = DATAPLANE_EXTENSION_CATALOG.map((item) => ({
  key: item.key,
  label: item.label,
  shortLabel: item.shortLabel,
  category: item.category,
}));

interface Props {
  pluginsJson: string;
  onChange: (nextJson: string) => void;
}

function parsePluginsObj(raw: string): Record<string, any> {
  try {
    const parsed = JSON.parse(raw || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }
  } catch {
    // ignore malformed json while typing
  }
  return {};
}

/**
 * Extracts the selected profile ID for an extension from a Route's `plugins_json` object,
 * or returns `'off'` if disabled / not selected on this route.
 */
export function getRouteExtensionSelectedProfile(
  obj: Record<string, any>,
  extKey: string,
  defaultProfileId = 'standard'
): string {
  const val = obj[extKey];
  if (val === undefined || val === null || val === false) {
    return 'off';
  }
  if (val === true) {
    return defaultProfileId;
  }
  if (typeof val === 'string') {
    const clean = val.trim();
    if (!clean || clean === 'off' || clean === 'disabled' || clean === 'none') {
      return 'off';
    }
    return clean;
  }
  if (typeof val === 'object' && !Array.isArray(val)) {
    if (val.enabled === false) {
      return 'off';
    }
    if (typeof val.profile === 'string' && val.profile.trim()) {
      const p = val.profile.trim();
      if (p === 'off' || p === 'disabled' || p === 'none') return 'off';
      return p;
    }
    return defaultProfileId;
  }
  return 'off';
}

export const RouteExtensionSwitches: React.FC<Props> = ({ pluginsJson, onChange }) => {
  const [liveConfigsByExt, setLiveConfigsByExt] = useState<Record<string, string>>({});

  useEffect(() => {
    let mounted = true;
    extensionsApi
      .list()
      .then((res) => {
        if (!mounted || !res?.extensions) return;
        const map: Record<string, string> = {};
        for (const ext of res.extensions) {
          const cleanKey = normalizeExtensionKey(ext.id || ext.name || '');
          if (cleanKey && ext.config_json) {
            map[cleanKey] = ext.config_json;
          }
        }
        setLiveConfigsByExt(map);
      })
      .catch(() => {
        // Fallback to built-in profiles if API is unreachable
      });
    return () => {
      mounted = false;
    };
  }, []);

  const obj = parsePluginsObj(pluginsJson);

  const handleSelectProfile = (extKey: string, profileId: string) => {
    const next: Record<string, any> = { ...obj, _mode: 'explicit' };
    delete next._profile;

    if (profileId === 'off') {
      next[extKey] = { enabled: false, profile: 'off' };
    } else {
      const profiles = resolveExtensionProfiles(extKey, liveConfigsByExt[extKey]);
      const chosen = profiles.find((p) => p.id === profileId);
      const entry: Record<string, any> = {
        enabled: true,
        profile: profileId,
      };
      if (chosen?.params && Object.keys(chosen.params).length > 0) {
        for (const [k, v] of Object.entries(chosen.params)) {
          if (k !== 'label' && k !== 'summary') {
            entry[k] = v;
          }
        }
      }
      next[extKey] = entry;
    }

    onChange(JSON.stringify(next, null, 2));
  };

  const handleSetAllOff = () => {
    const next: Record<string, any> = {
      _mode: 'explicit',
      _profile: 'passthrough',
    };
    onChange(JSON.stringify(next, null, 2));
  };

  const handleResetInherit = () => {
    onChange('{}');
  };

  const activeCount = DATAPLANE_EXTENSION_CATALOG.filter((ext) => {
    const firstProf = ext.defaultProfiles[0]?.id || 'default';
    return getRouteExtensionSelectedProfile(obj, ext.key, firstProf) !== 'off';
  }).length;

  return (
    <div className="space-y-4">
      {/* Header & Summary */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/20 border border-border rounded-xl p-3">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary shrink-0" />
          <div>
            <div className="text-xs font-semibold text-foreground flex items-center gap-2">
              <span>Cấu hình Profile theo từng Extension</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-primary/15 text-primary">
                {activeCount} / {DATAPLANE_EXTENSION_CATALOG.length} đang bật
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Mỗi Extension có các Profile riêng. Chọn 1 Profile cho từng Extension trên Route này
              (hoặc để <strong>Off</strong> để tắt hoàn toàn với 0 FFI overhead).
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSetAllOff}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-background hover:bg-muted text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <Ban className="w-3 h-3" />
            <span>Tắt tất cả (Passthrough)</span>
          </button>
          <button
            type="button"
            onClick={handleResetInherit}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-background hover:bg-muted text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Mặc định Global</span>
          </button>
        </div>
      </div>

      {/* Per-Extension Profile Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {DATAPLANE_EXTENSION_CATALOG.map((ext) => {
          const profiles = resolveExtensionProfiles(ext.key, liveConfigsByExt[ext.key]);
          const defaultProfId = profiles[0]?.id || 'default';
          const selectedProfileId = getRouteExtensionSelectedProfile(obj, ext.key, defaultProfId);
          const isEnabled = selectedProfileId !== 'off';
          const activeProfileObj = profiles.find((p) => p.id === selectedProfileId);

          return (
            <div
              key={ext.key}
              className={`flex flex-col justify-between p-3.5 rounded-xl border transition-all ${
                isEnabled
                  ? 'border-emerald-500/40 bg-emerald-500/5 shadow-2xs'
                  : 'border-border/70 bg-muted/10 opacity-85 hover:opacity-100'
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {isEnabled ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    ) : (
                      <Ban className="w-4 h-4 text-muted-foreground/60 shrink-0" />
                    )}
                    <span className="text-xs font-semibold text-foreground truncate">
                      {ext.label}
                    </span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold shrink-0 ${
                      isEnabled
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {isEnabled ? `Profile: ${selectedProfileId}` : 'OFF'}
                  </span>
                </div>

                <p className="text-[11px] text-muted-foreground">{ext.description}</p>

                {/* Profile Selector Dropdown */}
                <div className="pt-1">
                  <select
                    value={selectedProfileId}
                    onChange={(e) => handleSelectProfile(ext.key, e.target.value)}
                    className={`w-full px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer focus:outline-hidden ${
                      isEnabled
                        ? 'bg-background border-emerald-500/40 text-foreground'
                        : 'bg-background/70 border-border text-muted-foreground'
                    }`}
                  >
                    <option value="off">Off — Không chạy Extension này trên Route</option>
                    {profiles.map((prof) => (
                      <option key={prof.id} value={prof.id}>
                        Profile [{prof.id}] — {prof.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Selected Profile Details */}
                {isEnabled && activeProfileObj && (
                  <div className="flex items-center gap-1.5 pt-1 text-[11px] text-emerald-400/90 font-mono">
                    <Sparkles className="w-3 h-3 shrink-0" />
                    <span className="truncate">{activeProfileObj.summary}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
