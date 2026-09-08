export type UpstreamType = 'Single Server' | 'Load Balancer' | 'External (FQDN)';

export type BalancingAlgorithm = 'round_robin' | 'least_conn' | 'ip_hash';

export interface UpstreamNode {
  id: string;
  address: string;
  weight: number;
  maxFails?: number;
  failTimeout?: string;
  backup?: boolean;
  healthy: boolean;
}

export interface ProbeCheckItem {
  id: string;
  type: 'Readiness' | 'Liveness' | 'Health';
  path: string;
  expectedStatus?: number;
  intervalSec?: number;
  timeoutSec?: number;
}

export interface InternalSslConfig {
  enabled: boolean;
  verifyCert: boolean;
  sniHost?: string;
  caCert?: string;
  mTLS?: boolean;
  clientCertName?: string;
  clientCert?: string;
  clientKey?: string;
  clientKeyConfigured?: boolean;
}

export interface UpstreamTransportConfig {
  requestCompression?: 'none' | 'gzip' | 'deflate';
  compressionMinBytes?: number;
  compressionLevel?: number;
  httpVersion: 'HTTP/1.1' | 'HTTP/2' | 'HTTP/3' | 'HTTP/1.0';
  enableWebSocket: boolean;
  enableSse: boolean;
  enableGrpc: boolean;
  keepAliveConnections?: number;
  keepAliveTimeout?: number;
}

export interface UpstreamItem {
  id: string;
  name: string;
  description?: string;
  type: UpstreamType;
  algorithm: BalancingAlgorithm;
  servers: UpstreamNode[];
  externalFqdn?: string;
  sniOverride?: boolean;
  dynamicDns?: boolean;
  internalSsl: InternalSslConfig;
  probes: ProbeCheckItem[];
  transport: UpstreamTransportConfig;
  boundDomainsCount: number;
  createdAt: string;
  updatedAt: string;
}
