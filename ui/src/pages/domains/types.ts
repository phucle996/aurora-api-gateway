export type DomainStatus = 'Active' | 'Inactive';

export type TlsType = "Let's Encrypt" | 'Custom Cert' | 'mTLS' | 'Self-signed';

export interface DomainActivity {
  id: string;
  type: 'updated' | 'rule' | 'created' | 'policy' | 'security';
  title: string;
  description: string;
  timestamp: string;
  color: 'emerald' | 'blue' | 'slate' | 'amber' | 'purple';
}

export interface UpstreamServer {
  url: string;
  weight: number;
  maxFails: number;
  failTimeout: string;
  healthy: boolean;
}

export interface DomainNodeBinding {
  nodeId: string;
  nodeName: string;
  ip: string;
  ports: number[];
  status: 'Synced' | 'Pending' | 'Error';
  lastSynced: string;
}

export interface DomainItem {
  id: string;
  domain: string;
  rootDomain: string;
  status: DomainStatus;
  tlsType: TlsType;
  tlsExpiry?: string;
  tlsAutoRenew?: boolean;
  minTlsVersion?: 'TLSv1.2' | 'TLSv1.3';
  hstsEnabled?: boolean;
  ocspStapling?: boolean;
  clientCaSubject?: string;
  upstream: string;
  upstreamServers?: UpstreamServer[];
  upstreamAlgorithm?: 'round_robin' | 'ip_hash' | 'least_conn';
  healthCheckPath?: string;
  httpVersion?: 'HTTP/1.1' | 'HTTP/2' | 'HTTP/3' | 'HTTP/1.0';
  enableWebSocket?: boolean;
  enableSse?: boolean;
  enableGrpc?: boolean;
  rulesCount: number;
  policiesCount: number;
  ipRulesCount: number;
  rateLimitsCount: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  description: string;
  nodeBindings?: DomainNodeBinding[];
  recentActivities?: DomainActivity[];
}
