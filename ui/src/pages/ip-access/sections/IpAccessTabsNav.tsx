import React, { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { Shield, Layers, Globe, Activity } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

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
  onAddGroup?: () => void;
}

export function IpAccessTabsNav({
  activeTab,
  onTabChange,
  counts,
  onAddGroup,
}: IpAccessTabsNavProps) {
  const navigate = useNavigate();
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

  const PlusIcon = () => (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );

  return (
    <div className="relative border-b border-border font-sans">
      <div className="flex items-center justify-between">
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
                    ? 'text-primary font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                <span>{t.label}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-xs text-[10px] font-mono transition-colors ${
                    isActive
                      ? 'bg-primary/10 text-primary border border-primary/20'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {t.count}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Per-tab action button */}
        <div className="shrink-0 pl-4 pb-1">
          {activeTab === 'rules' && (
            <button
              type="button"
              onClick={() => navigate('/ip-access/create')}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-sm shadow-xs transition-colors cursor-pointer"
            >
              <PlusIcon />
              Add Rule
            </button>
          )}
          {activeTab === 'groups' && (
            <button
              type="button"
              onClick={onAddGroup}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-sm shadow-xs transition-colors cursor-pointer"
            >
              <PlusIcon />
              Add Group
            </button>
          )}
          {activeTab === 'datasets' && (
            <button
              type="button"
              onClick={() => navigate('/ip-access/datasets/new')}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-sm shadow-xs transition-colors cursor-pointer"
            >
              <PlusIcon />
              Add Dataset
            </button>
          )}
        </div>
      </div>

      {/* Animated Sliding Active Indicator Bar */}
      <div
        className={`absolute bottom-0 h-[2.5px] bg-primary rounded-full transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] pointer-events-none ${
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
