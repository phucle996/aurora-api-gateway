import { api } from '../fetcher';

export interface ExtensionItem {
  id: string;
  name: string;
  category: string;
  description: string;
  version: string;
  enabled: boolean;
  config_json: string;
  schema_json?: string;
  is_builtin: boolean;
  tags?: string[];
  default_config?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ExtensionsApiResponse {
  extensions: ExtensionItem[];
  total: number;
}

export interface UpdateExtensionStatusPayload {
  enabled: boolean;
}

export interface UpdateExtensionConfigPayload {
  config_json?: string;
  config?: Record<string, unknown>;
}

export interface UpdateExtensionSchemaPayload {
  schema_json?: string;
  schema?: Record<string, unknown>;
}

export const extensionsApi = {
  list: (params?: Record<string, string | number | boolean | null | undefined>) =>
    api.get<ExtensionsApiResponse>('/api/v1/extensions', params),
  getById: (id: string) =>
    api.get<ExtensionItem>(`/api/v1/extensions/${encodeURIComponent(id)}`),
  updateStatus: (id: string, enabled: boolean) =>
    api.put<{ message: string; id: string; enabled: boolean }>(
      `/api/v1/extensions/${encodeURIComponent(id)}/status`,
      { enabled }
    ),
  updateConfig: (id: string, payload: UpdateExtensionConfigPayload | string) =>
    api.put<{ message: string; id: string }>(
      `/api/v1/extensions/${encodeURIComponent(id)}/config`,
      typeof payload === 'string' ? { config_json: payload } : payload
    ),
  updateSchema: (id: string, payload: UpdateExtensionSchemaPayload | string) =>
    api.put<{ message: string; id: string }>(
      `/api/v1/extensions/${encodeURIComponent(id)}/schema`,
      typeof payload === 'string' ? { schema_json: payload } : payload
    ),
};
