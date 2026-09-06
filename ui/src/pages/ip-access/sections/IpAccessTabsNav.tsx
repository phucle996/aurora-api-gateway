import React, { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { Shield, Layers, Globe, Activity } from 'lucide-react';

export type AccessTabKey = 'rules' | 'groups' | 'datasets' | 'activity';

interface IpAccessTabsNavProps {
  activeTab: AccessTabKey;
  onTabChange: (tab: AccessTabKey) => void;
  counts: {
    rules: number;
    groups: number;
    datasets: number;
    activity: number;
  };
}

export function IpAccessTabsNav({
  activeTab,
  onTabChange,
  counts,
}: IpAccessTabsNavProps) {
  const tabRefs = useRef<{ [key in AccessTabKey]?: HTMLButtonElement | null }>({});
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number; ready: boolean }>({
    left: 0,
    width: 0,
    ready: false,
  });

  const tabs: { key: AccessTabKey; label: string; icon: React.ComponentType<{ className?: string }>; count: number }[] = [
    { key: 'rules', label: 'Access Rules', icon: Shield, count: counts.rules },
    { key: 'groups', label: 'IP Groups', icon: Layers, count: counts.groups },
    { key: 'datasets', label: 'Geo / ASN Datasets', icon: Globe, count: counts.datasets },
    { key: 'activity', label: 'Access Activity', icon: Activity, count: counts.activity },
  ];

  const updateIndicator = () => {
    const el = tabRefs.current[activeTab];
    if (el) {
      setIndicatorStyle({
        left: el.offsetLeft,
        width: el.offsetWidth,
        ready: true,
      });
    }
  };

  useLayoutEffect(() => {
    updateIndicator();
  }, [activeTab, counts]);

  useEffect(() => {
    const handleResize = () => updateIndicator();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [activeTab]);

  return (
    <div className="relative border-b border-slate-200 dark:border-[#172338] font-sans">
      <nav className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.key;
          return (
            <button
              key={t.key}
              ref={(el) => {
                tabRefs.current[t.key] = el;
              }}
              type="button"
              onClick={() => onTabChange(t.key)}
              className={`relative flex items-center gap-2 px-4 py-3 text-xs font-medium cursor-pointer transition-colors duration-150 select-none whitespace-nowrap ${
                isActive
                  ? 'text-blue-600 dark:text-blue-400 font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
              <span>{t.label}</span>
              {t.key === 'activity' ? (
                <span className="flex items-center gap-1 ml-0.5">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  {t.count > 0 && (
                    <span className="text-[10px] text-slate-400 font-mono">
                      ({t.count})
                    </span>
                  )}
                </span>
              ) : (
                <span
                  className={`px-1.5 py-0.2 rounded-xs text-[10px] font-mono transition-colors ${
                    isActive
                      ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900/50'
                      : 'bg-slate-100 dark:bg-[#152030] text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Animated Sliding Active Indicator Bar */}
      <div
        className={`absolute bottom-0 h-[2.5px] bg-blue-600 dark:bg-blue-500 rounded-full transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] pointer-events-none ${
          indicatorStyle.ready ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          transform: `translateX(${indicatorStyle.left}px)`,
          width: `${indicatorStyle.width}px`,
        }}
      />
    </div>
  );
}
