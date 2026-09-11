import React from 'react';
import { Network, Radio, Sliders, Shield } from 'lucide-react';
import { L4ServiceItem } from '../../../lib/api/l4';

interface L4StatsProps {
  services: L4ServiceItem[];
}

export function L4Stats({ services }: L4StatsProps) {
  const tcpCount = services.filter((s) => s.protocol.toLowerCase() === 'tcp').length;
  const udpCount = services.filter((s) => s.protocol.toLowerCase() === 'udp').length;
  const aclCount = services.filter((s) => {
    try {
      const arr = JSON.parse(s.acl_rules_json || '[]');
      return Array.isArray(arr) && arr.length > 0;
    } catch {
      return false;
    }
  }).length;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
      <div className="p-4 rounded-xl border border-border/50 bg-card/40 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Total L4 Services
          </span>
          <Network className="w-4 h-4 text-cyan-400" />
        </div>
        <p className="text-2xl font-bold text-foreground mt-2">{services.length}</p>
        <p className="text-xs text-muted-foreground mt-1">Active stream listeners</p>
      </div>

      <div className="p-4 rounded-xl border border-border/50 bg-card/40 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            TCP Listeners
          </span>
          <Radio className="w-4 h-4 text-blue-400" />
        </div>
        <p className="text-2xl font-bold text-foreground mt-2">{tcpCount}</p>
        <p className="text-xs text-muted-foreground mt-1">Databases, Redis, SSH</p>
      </div>

      <div className="p-4 rounded-xl border border-border/50 bg-card/40 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            UDP Listeners
          </span>
          <Sliders className="w-4 h-4 text-amber-400" />
        </div>
        <p className="text-2xl font-bold text-foreground mt-2">{udpCount}</p>
        <p className="text-xs text-muted-foreground mt-1">DNS, VoIP, Gaming, Syslog</p>
      </div>

      <div className="p-4 rounded-xl border border-border/50 bg-card/40 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            ACL Protected
          </span>
          <Shield className="w-4 h-4 text-emerald-400" />
        </div>
        <p className="text-2xl font-bold text-foreground mt-2">{aclCount}</p>
        <p className="text-xs text-muted-foreground mt-1">Allow / Deny CIDR active</p>
      </div>
    </div>
  );
}
