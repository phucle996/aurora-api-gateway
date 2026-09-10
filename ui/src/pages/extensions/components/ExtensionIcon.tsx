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
  Lock,
  ArrowRightLeft,
  Filter,
  Sparkles,
  HeartPulse,
  Timer,
  Repeat,
  Shuffle,
  HardDrive,
  Trash2,
  CloudLightning,
  Webhook,
  Bug,
  FileSearch,
  CheckSquare,
  FileCode,
  PauseCircle,
  Binary,
  RefreshCw,
  Archive,
  Scale,
  BrainCircuit,
  MessageSquare,
  Users,
} from 'lucide-react';

interface ExtensionIconProps {
  id: string;
  category: string;
  className?: string;
}

export function ExtensionIcon({ id, category, className = 'w-5 h-5' }: ExtensionIconProps) {
  // Specific plugin mapping
  switch (id) {
    // 1. Security Engine
    case 'waf-core':
      return <ShieldAlert className={className} />;
    case 'sqli-protection':
      return <Database className={className} />;
    case 'xss-protection':
      return <FileCode className={className} />;
    case 'command-injection-protection':
      return <Terminal className={className} />;
    case 'path-traversal-protection':
      return <FileSearch className={className} />;
    case 'ssrf-protection':
      return <Globe className={className} />;
    case 'rce-protection':
      return <Bug className={className} />;
    case 'protocol-anomaly':
      return <Activity className={className} />;
    case 'bot-detection':
      return <Bot className={className} />;
    case 'ip-reputation':
      return <ShieldAlert className={className} />;
    case 'credential-stuffing':
      return <Lock className={className} />;
    case 'scanner-detection':
      return <EyeOff className={className} />;
    case 'sensitive-data-detection':
      return <Eye className={className} />;
    case 'custom-waf-rules':
      return <Sliders className={className} />;
    case 'owasp-crs':
      return <ShieldCheck className={className} />;

    // 2. Authentication
    case 'basic-auth':
      return <Lock className={className} />;
    case 'key-auth':
    case 'api_key_auth':
      return <Key className={className} />;
    case 'jwt-auth':
    case 'jwt_auth':
      return <KeyRound className={className} />;
    case 'hmac-auth':
      return <Hash className={className} />;
    case 'oauth2-auth':
    case 'openid-connect':
      return <Users className={className} />;
    case 'mtls-auth':
      return <Fingerprint className={className} />;
    case 'ldap-auth':
    case 'saml-auth':
      return <Users className={className} />;
    case 'forward-auth':
      return <ArrowRightLeft className={className} />;
    case 'session-auth':
      return <Database className={className} />;
    case 'multi-auth':
      return <ShieldCheck className={className} />;

    // 3. Authorization & Security
    case 'acl':
    case 'rbac':
      return <CheckSquare className={className} />;
    case 'opa-authz':
      return <ShieldCheck className={className} />;
    case 'ip-restriction':
      return <Shield className={className} />;
    case 'geo-restriction':
    case 'geoip':
      return <Globe className={className} />;
    case 'user-agent-restriction':
    case 'referer-restriction':
      return <Filter className={className} />;
    case 'cors':
      return <Globe className={className} />;
    case 'csrf-protection':
      return <Lock className={className} />;
    case 'api-schema-validator':
      return <FileCode className={className} />;
    case 'request-signature':
      return <Fingerprint className={className} />;
    case 'consumer-restriction':
      return <Users className={className} />;

    // 4. Traffic Control
    case 'rate-limit':
    case 'rate_limiter':
    case 'rate-limit-local':
    case 'rate-limit-distributed':
      return <Gauge className={className} />;
    case 'connection-limit':
    case 'bandwidth-limit':
      return <Sliders className={className} />;
    case 'request-size-limit':
      return <Minimize2 className={className} />;
    case 'traffic-split':
    case 'canary-release':
    case 'canary_routing':
      return <GitFork className={className} />;
    case 'blue-green':
      return <Shuffle className={className} />;
    case 'request-mirror':
    case 'traffic-shadow':
      return <Radio className={className} />;
    case 'priority-routing':
      return <Sliders className={className} />;
    case 'maintenance-mode':
      return <PauseCircle className={className} />;
    case 'request-termination':
      return <EyeOff className={className} />;

    // 5. Request Transformation
    case 'request-header-transform':
    case 'request_transformer':
      return <Sliders className={className} />;
    case 'request-query-transform':
    case 'request-body-transform':
      return <FileText className={className} />;
    case 'uri-rewrite':
    case 'host-rewrite':
    case 'method-rewrite':
      return <ArrowRightLeft className={className} />;
    case 'json-transform':
    case 'xml-json-transform':
      return <Binary className={className} />;
    case 'grpc-transcode':
    case 'graphql-rest-transform':
      return <RefreshCw className={className} />;

    // 6. Response Transformation
    case 'response-header-transform':
    case 'header_masking':
      return <Sliders className={className} />;
    case 'response-body-transform':
    case 'response-rewrite':
      return <FileText className={className} />;
    case 'response-mask':
      return <EyeOff className={className} />;
    case 'json-filter':
      return <Filter className={className} />;
    case 'compression-gzip':
    case 'compression-brotli':
    case 'brotli_compress':
      return <Minimize2 className={className} />;
    case 'error-transform':
      return <ShieldAlert className={className} />;

    // 7. Observability
    case 'prometheus':
    case 'metrics':
      return <Activity className={className} />;
    case 'opentelemetry':
    case 'distributed_tracing':
      return <Network className={className} />;
    case 'zipkin':
      return <Activity className={className} />;
    case 'datadog':
    case 'datadog_apm':
      return <LineChart className={className} />;
    case 'access-log':
    case 'access_logger':
    case 'http-logger':
    case 'syslog-logger':
      return <FileText className={className} />;
    case 'kafka-logger':
    case 'loki-logger':
    case 'elasticsearch-logger':
      return <Database className={className} />;
    case 'request-id':
      return <Hash className={className} />;
    case 'audit-log':
      return <ShieldCheck className={className} />;

    // 8. Resilience & Upstream
    case 'circuit-breaker':
      return <Zap className={className} />;
    case 'retry-policy':
      return <Repeat className={className} />;
    case 'timeout-policy':
      return <Timer className={className} />;
    case 'outlier-detection':
      return <Filter className={className} />;
    case 'active-health-check':
    case 'passive-health-check':
      return <HeartPulse className={className} />;
    case 'fallback-upstream':
      return <Shuffle className={className} />;
    case 'hedged-request':
      return <Radio className={className} />;
    case 'upstream-affinity':
      return <Fingerprint className={className} />;
    case 'adaptive-concurrency':
      return <Gauge className={className} />;

    // 9. Cache & Content
    case 'proxy-cache':
    case 'cache_accelerator':
      return <Database className={className} />;
    case 'redis-cache':
      return <HardDrive className={className} />;
    case 'cache-purge':
      return <Trash2 className={className} />;
    case 'etag':
    case 'conditional-request':
      return <Archive className={className} />;
    case 'static-response':
    case 'mock-response':
      return <FileText className={className} />;
    case 'response-buffering':
      return <Sliders className={className} />;

    // 10. Integration & Runtime
    case 'aws-lambda':
    case 'azure-functions':
      return <CloudLightning className={className} />;
    case 'webhook':
      return <Webhook className={className} />;
    case 'serverless-pre-function':
    case 'serverless-post-function':
    case 'lua_jit_runtime':
      return <Terminal className={className} />;
    case 'external-plugin':
    case 'wasm_filter':
      return <Cpu className={className} />;
    case 'kafka-proxy':
    case 'mqtt-proxy':
    case 'websocket_guard':
      return <Radio className={className} />;

    // 11. AI Gateway
    case 'ai-proxy':
      return <Bot className={className} />;
    case 'ai-multi-provider':
      return <Shuffle className={className} />;
    case 'ai-token-rate-limit':
      return <Scale className={className} />;
    case 'ai-prompt-guard':
      return <ShieldAlert className={className} />;
    case 'ai-semantic-cache':
      return <BrainCircuit className={className} />;
    case 'ai-content-moderation':
      return <MessageSquare className={className} />;

    default:
      // Category fallbacks
      switch (category) {
        case 'security_engine':
        case 'security':
          return <ShieldAlert className={className} />;
        case 'authentication':
        case 'auth':
          return <Lock className={className} />;
        case 'authorization_security':
          return <ShieldCheck className={className} />;
        case 'traffic_control':
        case 'traffic':
          return <Sliders className={className} />;
        case 'request_transformation':
          return <ArrowRightLeft className={className} />;
        case 'response_transformation':
          return <Sparkles className={className} />;
        case 'observability':
          return <Activity className={className} />;
        case 'resilience_upstream':
          return <HeartPulse className={className} />;
        case 'cache_content':
          return <Database className={className} />;
        case 'integration_runtime':
        case 'runtime':
          return <Cpu className={className} />;
        case 'ai_gateway':
          return <BrainCircuit className={className} />;
        default:
          return <Blocks className={className} />;
      }
  }
}
