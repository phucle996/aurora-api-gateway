import { api } from '../fetcher';
import type { UpstreamItem } from '../../pages/upstreams/types';

export interface CreateUpstreamPayload {
  name: string;
  description?: string;
  architecture_type: string;
  algorithm: string;
  servers: Array<{
    id: string;
    address: string;
    weight: number;
    maxFails?: number;
    failTimeout?: string;
    backup?: boolean;
    healthy: boolean;
  }>;
  external_fqdn?: string;
  sni_override?: boolean;
  dynamic_dns?: boolean;
  internal_ssl: {
    enabled: boolean;
    verifyCert: boolean;
    sniHost?: string;
    caCert?: string;
    mTLS?: boolean;
    clientCertName?: string;
    clientCert?: string;
    clientKey?: string;
  };
  probes: Array<{
    id: string;
    type: string;
    path: string;
    expectedStatus?: number;
    intervalSec?: number;
    timeoutSec?: number;
  }>;
  transport: {
    requestCompression?: 'none' | 'gzip' | 'deflate';
    compressionMinBytes?: number;
    compressionLevel?: number;
    httpVersion: string;
    enableWebSocket: boolean;
    enableSse: boolean;
    enableGrpc: boolean;
    keepAliveConnections?: number;
  };
}

export interface ListUpstreamsResponse {
  items: UpstreamItem[];
  total: number;
  page: number;
  limit: number;
}

function normalizeUpstream(item: any): UpstreamItem {
  return {
    ...item,
    id: String(item.id),
    name: item.name,
    description: item.description,
    type: item.architecture_type || item.type || 'Single Server',
    algorithm: item.algorithm || 'round_robin',
    servers: item.servers || [],
    externalFqdn: item.external_fqdn || item.externalFqdn,
    sniOverride: item.sni_override ?? item.sniOverride,
    dynamicDns: item.dynamic_dns ?? item.dynamicDns,
    internalSsl: item.internal_ssl ? {
      enabled: Boolean(item.internal_ssl.enabled),
      verifyCert: Boolean(item.internal_ssl.verifyCert),
      sniHost: item.internal_ssl.sniHost,
      caCert: item.internal_ssl.caCert,
      mTLS: Boolean(item.internal_ssl.mTLS),
      clientCertName: item.internal_ssl.clientCertName,
      clientCert: item.internal_ssl.clientCert,
      clientKeyConfigured: Boolean(item.internal_ssl.clientKeyConfigured),
    } : (item.internalSsl || { enabled: false, verifyCert: false }),
    probes: item.probes || [],
    transport: item.transport || {
      httpVersion: 'HTTP/1.1',
      enableWebSocket: false,
      enableSse: false,
      enableGrpc: false,
    },
    boundDomainsCount: item.bound_domains_count ?? item.boundDomainsCount ?? 0,
    createdAt: item.created_at || item.createdAt || '',
    updatedAt: item.updated_at || item.updatedAt || '',
  };
}

export const upstreamsApi = {
  list: async (params?: { search?: string; type?: string; page?: number; limit?: number }) => {
    const res = await api.get<ListUpstreamsResponse>('/api/v1/upstreams', params);
    return {
      ...res,
      items: (res.items || []).map(normalizeUpstream),
    };
  },
  getById: async (id: number | string) => {
    const res = await api.get<any>(`/api/v1/upstreams/${id}`);
    return normalizeUpstream(res);
  },
  create: (payload: CreateUpstreamPayload) =>
    api.post<UpstreamItem>('/api/v1/upstreams', payload),
  update: (id: number | string, payload: CreateUpstreamPayload) =>
    api.put<UpstreamItem>(`/api/v1/upstreams/${id}`, payload),
  delete: (id: number | string) =>
    api.delete<{ status: string; id: number }>(`/api/v1/upstreams/${id}`),
};
