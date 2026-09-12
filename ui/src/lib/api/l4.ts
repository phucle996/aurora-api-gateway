import { api } from '../fetcher';

export interface L4ACLRule {
  cidr: string;
  action: 'allow' | 'deny';
  priority: number;
  description?: string;
}

export interface L4ServiceItem {
  id: string;
  name: string;
  protocol: string; // 'tcp' | 'udp'
  listen_port: number;
  forward_target_type: 'upstream' | 'endpoint';
  upstream_name: string;
  direct_endpoint: string;
  acl_rules_json: string;
  proxy_timeout: string;
  proxy_connect_timeout: string;
  enabled: boolean;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface ListL4ServicesResponse {
  items: L4ServiceItem[];
  total: number;
}

export interface CreateL4ServicePayload {
  name: string;
  protocol: string;
  listen_port: number;
  forward_target_type?: 'upstream' | 'endpoint';
  upstream_name?: string;
  direct_endpoint?: string;
  acl_rules_json: string;
  proxy_timeout?: string;
  proxy_connect_timeout?: string;
  enabled?: boolean;
  description?: string;
}

export interface UpdateL4ServicePayload {
  name: string;
  protocol: string;
  listen_port: number;
  forward_target_type?: 'upstream' | 'endpoint';
  upstream_name?: string;
  direct_endpoint?: string;
  acl_rules_json: string;
  proxy_timeout?: string;
  proxy_connect_timeout?: string;
  enabled?: boolean;
  description?: string;
}

export const l4Api = {
  listServices: (params?: Record<string, string | number | boolean | null | undefined>) =>
    api.get<ListL4ServicesResponse>('/api/v1/l4/services', params),
  getService: (id: string) => api.get<L4ServiceItem>(`/api/v1/l4/services/${id}`),
  createService: (payload: CreateL4ServicePayload) =>
    api.post<L4ServiceItem>('/api/v1/l4/services', payload),
  updateService: (id: string, payload: UpdateL4ServicePayload) =>
    api.put<L4ServiceItem>(`/api/v1/l4/services/${id}`, payload),
  toggleService: (id: string, enabled: boolean) =>
    api.put<L4ServiceItem>(`/api/v1/l4/services/${id}/status`, { enabled }),
  deleteService: (id: string) =>
    api.delete<{ message: string }>(`/api/v1/l4/services/${id}`),
};
