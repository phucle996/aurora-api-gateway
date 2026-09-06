import type { UpstreamItem } from './types';

export const INITIAL_UPSTREAMS: UpstreamItem[] = [
  {
    id: 'ups-1',
    name: 'prod-api-cluster',
    description: 'Main production API backend cluster across AZ-1 and AZ-2',
    type: 'Load Balancer',
    algorithm: 'least_conn',
    servers: [
      { id: 'n1', address: '10.0.1.10:8080', weight: 1, healthy: true },
      { id: 'n2', address: '10.0.1.11:8080', weight: 2, healthy: true },
      { id: 'n3', address: '10.0.1.12:8080', weight: 1, healthy: true },
    ],
    internalSsl: {
      enabled: true,
      verifyCert: true,
      sniHost: 'api.internal',
      mTLS: false,
    },
    probes: [
      { id: 'p1', type: 'Readiness', path: '/health', expectedStatus: 200 },
      { id: 'p2', type: 'Liveness', path: '/live', expectedStatus: 200 },
    ],
    transport: {
      httpVersion: 'HTTP/1.1',
      enableWebSocket: true,
      enableSse: true,
      enableGrpc: false,
    },
    boundDomainsCount: 4,
    createdAt: '2026-09-01 10:00',
    updatedAt: '2026-09-06 18:30',
  },
  {
    id: 'ups-2',
    name: 'auth-service',
    description: 'Internal OAuth2 / IAM authentication and token verification service',
    type: 'Single Server',
    algorithm: 'round_robin',
    servers: [
      { id: 'n4', address: '10.0.2.15:8443', weight: 1, healthy: true },
    ],
    internalSsl: {
      enabled: true,
      verifyCert: true,
      sniHost: 'auth.internal',
      mTLS: true,
      clientCertName: 'aurora-waf-internal-client.crt',
    },
    probes: [
      { id: 'p3', type: 'Readiness', path: '/ready', expectedStatus: 200 },
    ],
    transport: {
      httpVersion: 'HTTP/1.1',
      enableWebSocket: false,
      enableSse: false,
      enableGrpc: false,
    },
    boundDomainsCount: 2,
    createdAt: '2026-09-02 14:15',
    updatedAt: '2026-09-05 09:20',
  },
  {
    id: 'ups-3',
    name: 'partner-cloud-origin',
    description: 'Third-party AWS ALB origin for enterprise partner integrations',
    type: 'External (FQDN)',
    algorithm: 'round_robin',
    servers: [
      { id: 'n5', address: 'origin-alb.us-east-1.elb.amazonaws.com', weight: 1, healthy: true },
    ],
    externalFqdn: 'origin-alb.us-east-1.elb.amazonaws.com',
    sniOverride: true,
    dynamicDns: true,
    internalSsl: {
      enabled: true,
      verifyCert: true,
      sniHost: 'origin-alb.us-east-1.elb.amazonaws.com',
      mTLS: false,
    },
    probes: [
      { id: 'p4', type: 'Readiness', path: '/healthz', expectedStatus: 200 },
    ],
    transport: {
      httpVersion: 'HTTP/2',
      enableWebSocket: false,
      enableSse: false,
      enableGrpc: true,
    },
    boundDomainsCount: 1,
    createdAt: '2026-09-04 11:00',
    updatedAt: '2026-09-06 20:10',
  },
];
