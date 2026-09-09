export type ExtensionCategory =
  | 'all'
  | 'security'
  | 'observability'
  | 'traffic'
  | 'runtime'
  | 'auth';

export interface ExtensionItem {
  id: string;
  name: string;
  category: 'security' | 'observability' | 'traffic' | 'runtime' | 'auth';
  description: string;
  version: string;
  enabled: boolean;
  config_json: string;
  schema_json?: string;
  is_builtin: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ExtensionsApiResponse {
  extensions: ExtensionItem[];
  total: number;
}

export interface ExtensionStatsData {
  total: number;
  enabled: number;
  disabled: number;
  byCategory: Record<string, number>;
}
