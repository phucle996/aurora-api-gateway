import React from 'react';
import {
  // 1. Security Engine (15)
  Shield,
  DatabaseZap,
  CodeXml,
  Terminal,
  FolderSearch,
  GlobeLock,
  Bug,
  Network,
  Bot,
  Radar,
  KeyRound,
  ScanSearch,
  EyeOff,
  SlidersHorizontal,
  ShieldCheck,

  // 2. Authentication (12)
  Lock,
  Key,
  Ticket,
  Hash,
  ShieldUser,
  UserCheck,
  FileKey2,
  Contact,
  Building2,
  ExternalLink,
  Cookie,
  Layers,

  // 3. Authorization & Security (12)
  ListChecks,
  Users,
  Scale,
  LocateFixed,
  MapPinOff,
  Globe,
  Compass,
  Share2,
  ShieldX,
  FileCheck,
  FileSignature,
  BadgeCheck,

  // 4. Traffic Control (14)
  Gauge,
  Timer,
  Cpu,
  Split,
  Wifi,
  Shrink,
  GitFork,
  GitBranch,
  Shuffle,
  Copy,
  Ghost,
  Sparkles,
  Construction,
  OctagonX,

  // 5. Request Transformation (10)
  Heading,
  Search,
  FileJson,
  Route,
  Server,
  Repeat2,
  Brackets,
  FileCode2,
  Binary,
  Hexagon,

  // 6. Response Transformation (8)
  Sliders,
  FileEdit,
  Replace,
  VenetianMask,
  Filter,
  Archive,
  FileArchive,
  AlertOctagon,

  // 7. Observability (12)
  Activity,
  Waypoints,
  GitCommit,
  LineChart,
  FileText,
  Radio,
  Scroll,
  Boxes,
  Flame,
  SearchCode,
  Fingerprint,
  History,

  // 8. Resilience & Upstream (10)
  ZapOff,
  RotateCw,
  Hourglass,
  Crosshair,
  HeartPulse,
  Stethoscope,
  LifeBuoy,
  FastForward,
  Magnet,
  TrendingUp,

  // 9. Cache & Content (8)
  HardDrive,
  Zap,
  Trash2,
  Barcode,
  GitPullRequest,
  File,
  FileQuestion,
  Disc,

  // 10. Integration & Runtime (8)
  CloudLightning,
  Cloud,
  Webhook,
  PlayCircle,
  CheckCircle2,
  Plug,
  Workflow,
  Antenna,

  // 11. AI Gateway (6)
  Brain,
  Orbit,
  Coins,
  ScanEye,
  BrainCircuit,
  MessageSquareWarning,

  // Fallbacks
  Blocks,
  ShieldAlert,
} from 'lucide-react';

interface ExtensionIconProps {
  id: string;
  category?: string;
  className?: string;
}

export function ExtensionIcon({ id, category, className = 'w-5 h-5' }: ExtensionIconProps) {
  switch (id) {
    // 1. Security Engine (15) - All Unique
    case 'waf-core':
      return <Shield className={className} />;
    case 'sqli-protection':
      return <DatabaseZap className={className} />;
    case 'xss-protection':
      return <CodeXml className={className} />;
    case 'command-injection-protection':
      return <Terminal className={className} />;
    case 'path-traversal-protection':
      return <FolderSearch className={className} />;
    case 'ssrf-protection':
      return <GlobeLock className={className} />;
    case 'rce-protection':
      return <Bug className={className} />;
    case 'protocol-anomaly':
      return <Network className={className} />;
    case 'bot-detection':
      return <Bot className={className} />;
    case 'ip-reputation':
      return <Radar className={className} />;
    case 'credential-stuffing':
      return <KeyRound className={className} />;
    case 'scanner-detection':
      return <ScanSearch className={className} />;
    case 'sensitive-data-detection':
      return <EyeOff className={className} />;
    case 'custom-waf-rules':
      return <SlidersHorizontal className={className} />;
    case 'owasp-crs':
      return <ShieldCheck className={className} />;

    // 2. Authentication (12) - All Unique
    case 'basic-auth':
      return <Lock className={className} />;
    case 'key-auth':
    case 'api_key_auth':
      return <Key className={className} />;
    case 'jwt-authentication': // đã imple
      return <Ticket className={className} />;
    case 'hmac-auth':
      return <Hash className={className} />;
    case 'oauth2-auth':
      return <ShieldUser className={className} />;
    case 'openid-connect':
      return <UserCheck className={className} />;
    case 'mtls-auth':
      return <FileKey2 className={className} />;
    case 'ldap-auth':
      return <Contact className={className} />;
    case 'saml-auth':
      return <Building2 className={className} />;
    case 'forward-auth':
      return <ExternalLink className={className} />;
    case 'session-auth':
      return <Cookie className={className} />;
    case 'multi-auth':
      return <Layers className={className} />;

    // 3. Authorization & Security (12) - All Unique
    case 'acl':
      return <ListChecks className={className} />;
    case 'rbac':
      return <Users className={className} />;
    case 'opa-authz':
      return <Scale className={className} />;
    case 'ip-restriction':
      return <LocateFixed className={className} />;
    case 'geo-restriction':
    case 'geoip':
      return <MapPinOff className={className} />;
    case 'user-agent-restriction':
      return <Globe className={className} />;
    case 'referer-restriction':
      return <Compass className={className} />;
    case 'cors':
      return <Share2 className={className} />;
    case 'csrf-protection':
      return <ShieldX className={className} />;
    case 'api-schema-validator':
      return <FileCheck className={className} />;
    case 'request-signature':
      return <FileSignature className={className} />;
    case 'consumer-restriction':
      return <BadgeCheck className={className} />;

    // 4. Traffic Control (14) - All Unique
    case 'rate-limit': // đã imple 
      return <Gauge className={className} />;
    case 'connection-limit': // đã imple 
      return <Split className={className} />;
    case 'traffic-shaper': // đã imple 
      return <Wifi className={className} />;
    case 'request-size-limit': // đã imple 
      return <Shrink className={className} />;
    case 'traffic-split': // đã imple 
      return <GitFork className={className} />;
    case 'canary-release': // đã imple
      return <GitBranch className={className} />;
    case 'blue-green':
      return <Shuffle className={className} />;
    case 'request-mirror':
      return <Copy className={className} />;
    case 'traffic-shadow':
      return <Ghost className={className} />;
    case 'priority-routing':
      return <Sparkles className={className} />;
    case 'maintenance-mode':
      return <Construction className={className} />;
    case 'request-termination':
      return <OctagonX className={className} />;

    // 5. Request Transformation (10) - All Unique
    case 'request-header-transform':
    case 'request_transformer':
      return <Heading className={className} />;
    case 'request-query-transform':
      return <Search className={className} />;
    case 'request-body-transform':
      return <FileJson className={className} />;
    case 'uri-rewrite':
      return <Route className={className} />;
    case 'host-rewrite':
      return <Server className={className} />;
    case 'method-rewrite':
      return <Repeat2 className={className} />;
    case 'json-transform':
      return <Brackets className={className} />;
    case 'xml-json-transform':
      return <FileCode2 className={className} />;
    case 'grpc-transcode':
      return <Binary className={className} />;
    case 'graphql-rest-transform':
      return <Hexagon className={className} />;

    // 6. Response Transformation (8) - All Unique
    case 'response-header-transform':
    case 'header_masking':
      return <Sliders className={className} />;
    case 'response-body-transform':
      return <FileEdit className={className} />;
    case 'response-rewrite':
      return <Replace className={className} />;
    case 'response-mask':
      return <VenetianMask className={className} />;
    case 'json-filter':
      return <Filter className={className} />;
    case 'compression-gzip':
      return <Archive className={className} />;
    case 'compression-brotli':
    case 'brotli_compress':
      return <FileArchive className={className} />;
    case 'error-transform':
      return <AlertOctagon className={className} />;

    // 7. Observability (12) - All Unique
    case 'prometheus':
    case 'metrics':
      return <Activity className={className} />;
    case 'opentelemetry':
    case 'distributed_tracing':
      return <Waypoints className={className} />;
    case 'zipkin':
      return <GitCommit className={className} />;
    case 'datadog':
    case 'datadog_apm':
      return <LineChart className={className} />;
    case 'access-log':
    case 'access_logger':
      return <FileText className={className} />;
    case 'http-logger':
      return <Radio className={className} />;
    case 'syslog-logger':
      return <Scroll className={className} />;
    case 'kafka-logger':
      return <Boxes className={className} />;
    case 'loki-logger':
      return <Flame className={className} />;
    case 'elasticsearch-logger':
      return <SearchCode className={className} />;
    case 'request-id':
      return <Fingerprint className={className} />;
    case 'audit-log':
      return <History className={className} />;

    // 8. Resilience & Upstream (10) - All Unique
    case 'circuit-breaker':
      return <ZapOff className={className} />;
    case 'retry-policy':
      return <RotateCw className={className} />;
    case 'timeout-policy':
      return <Hourglass className={className} />;
    case 'outlier-detection':
      return <Crosshair className={className} />;
    case 'active-health-check':
      return <HeartPulse className={className} />;
    case 'passive-health-check':
      return <Stethoscope className={className} />;
    case 'fallback-upstream':
      return <LifeBuoy className={className} />;
    case 'hedged-request':
      return <FastForward className={className} />;
    case 'upstream-affinity':
      return <Magnet className={className} />;
    case 'adaptive-concurrency':
      return <TrendingUp className={className} />;

    // 9. Cache & Content (8) - All Unique
    case 'proxy-cache':
    case 'cache_accelerator':
      return <HardDrive className={className} />;
    case 'redis-cache':
      return <Zap className={className} />;
    case 'cache-purge':
      return <Trash2 className={className} />;
    case 'etag':
      return <Barcode className={className} />;
    case 'conditional-request':
      return <GitPullRequest className={className} />;
    case 'static-response':
      return <File className={className} />;
    case 'mock-response':
      return <FileQuestion className={className} />;
    case 'response-buffering':
      return <Disc className={className} />;

    // 10. Integration & Runtime (8) - All Unique
    case 'aws-lambda':
      return <CloudLightning className={className} />;
    case 'azure-functions':
      return <Cloud className={className} />;
    case 'webhook':
      return <Webhook className={className} />;
    case 'serverless-pre-function':
      return <PlayCircle className={className} />;
    case 'serverless-post-function':
      return <CheckCircle2 className={className} />;
    case 'external-plugin':
    case 'wasm_filter':
      return <Plug className={className} />;
    case 'kafka-proxy':
      return <Workflow className={className} />;
    case 'mqtt-proxy':
    case 'websocket_guard':
      return <Antenna className={className} />;

    // 11. AI Gateway (6) - All Unique
    case 'ai-proxy':
      return <Brain className={className} />;
    case 'ai-multi-provider':
      return <Orbit className={className} />;
    case 'ai-token-rate-limit':
      return <Coins className={className} />;
    case 'ai-prompt-guard':
      return <ScanEye className={className} />;
    case 'ai-semantic-cache':
      return <BrainCircuit className={className} />;
    case 'ai-content-moderation':
      return <MessageSquareWarning className={className} />;

    default:
      // Category generic fallbacks
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
          return <Gauge className={className} />;
        case 'request_transformation':
          return <Heading className={className} />;
        case 'response_transformation':
          return <Sliders className={className} />;
        case 'observability':
          return <Activity className={className} />;
        case 'resilience_upstream':
          return <HeartPulse className={className} />;
        case 'cache_content':
          return <HardDrive className={className} />;
        case 'integration_runtime':
        case 'runtime':
          return <Plug className={className} />;
        case 'ai_gateway':
          return <Brain className={className} />;
        default:
          return <Blocks className={className} />;
      }
  }
}
