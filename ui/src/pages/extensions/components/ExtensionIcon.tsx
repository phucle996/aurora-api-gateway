import React from 'react';
import {
  Activity,
  FileText,
  Network,
  Globe,
  ShieldAlert,
  Bot,
  EyeOff,
  Gauge,
  Zap,
  Sliders,
  Cpu,
  ShieldCheck,
  KeyRound,
  Shield,
  Minimize2,
  GitFork,
  Fingerprint,
  Database,
  Key,
  Hash,
  LineChart,
  Eye,
  Terminal,
  Radio,
  Blocks,
} from 'lucide-react';

interface ExtensionIconProps {
  id: string;
  category: string;
  className?: string;
}

export function ExtensionIcon({ id, category, className = 'w-5 h-5' }: ExtensionIconProps) {
  switch (id) {
    case 'metrics':
      return <Activity className={className} />;
    case 'access_logger':
      return <FileText className={className} />;
    case 'distributed_tracing':
      return <Network className={className} />;
    case 'geoip':
      return <Globe className={className} />;
    case 'ip_reputation':
      return <ShieldAlert className={className} />;
    case 'bot_defense':
      return <Bot className={className} />;
    case 'tor_blocker':
      return <EyeOff className={className} />;
    case 'rate_limiter':
      return <Gauge className={className} />;
    case 'circuit_breaker':
      return <Zap className={className} />;
    case 'request_transformer':
      return <Sliders className={className} />;
    case 'wasm_filter':
      return <Cpu className={className} />;
    case 'crowdsec':
      return <ShieldCheck className={className} />;
    case 'jwt_auth':
      return <KeyRound className={className} />;
    case 'coraza_waf':
      return <Shield className={className} />;
    case 'brotli_compress':
      return <Minimize2 className={className} />;
    case 'canary_routing':
      return <GitFork className={className} />;
    case 'tls_fingerprint':
      return <Fingerprint className={className} />;
    case 'cache_accelerator':
      return <Database className={className} />;
    case 'api_key_auth':
      return <Key className={className} />;
    case 'request_id':
      return <Hash className={className} />;
    case 'datadog_apm':
      return <LineChart className={className} />;
    case 'header_masking':
      return <Eye className={className} />;
    case 'lua_jit_runtime':
      return <Terminal className={className} />;
    case 'websocket_guard':
      return <Radio className={className} />;
    default:
      if (category === 'security') return <Shield className={className} />;
      if (category === 'observability') return <Activity className={className} />;
      if (category === 'traffic') return <Sliders className={className} />;
      if (category === 'auth') return <Key className={className} />;
      if (category === 'runtime') return <Cpu className={className} />;
      return <Blocks className={className} />;
  }
}
