import { api } from '../fetcher';

export interface RouteItem {
  id: string;
  name: string;
  host: string;
  path: string;
  upstream_name: string;
  enabled: boolean;
  strip_path: boolean;
  websocket: boolean;
  priority: number;
  plugins_json: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface ListRoutesParams extends Record<string, string | number | boolean | null | undefined> {
  search?: string;
  host?: string;
  upstream_name?: string;
  page?: number;
  limit?: number;
}

export interface ListRoutesResponse {
  items: RouteItem[];
  total: number;
}

export interface CreateRoutePayload {
  name: string;
  host: string;
  path: string;
  upstream_name: string;
  enabled?: boolean;
  strip_path?: boolean;
  websocket?: boolean;
  priority?: number;
  plugins_json?: string;
  description?: string;
}

export interface UpdateRoutePayload {
  name: string;
  host: string;
  path: string;
  upstream_name: string;
  enabled?: boolean;
  strip_path?: boolean;
  websocket?: boolean;
  priority?: number;
  plugins_json?: string;
  description?: string;
}

export const routesApi = {
  list: (params?: ListRoutesParams) => api.get<ListRoutesResponse>('/api/v1/routes', params),
  get: (id: string) => api.get<RouteItem>(`/api/v1/routes/${id}`),
  create: (payload: CreateRoutePayload) => api.post<RouteItem>('/api/v1/routes', payload),
  update: (id: string, payload: UpdateRoutePayload) => api.put<RouteItem>(`/api/v1/routes/${id}`, payload),
  toggle: (id: string, enabled: boolean) => api.put<{ message: string; enabled: boolean }>(`/api/v1/routes/${id}/status`, { enabled }),
  delete: (id: string) => api.delete<{ status: string; id: string }>(`/api/v1/routes/${id}`),
};
