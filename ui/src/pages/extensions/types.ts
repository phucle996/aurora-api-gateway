export type ExtensionCategory =
  | 'all'
  | 'security_engine'
  | 'authentication'
  | 'authorization_security'
  | 'traffic_control'
  | 'request_transformation'
  | 'response_transformation'
  | 'observability'
  | 'resilience_upstream'
  | 'cache_content'
  | 'integration_runtime'
  | 'ai_gateway';

export interface ExtensionItem {
  id: string;
  name: string;
  category: ExtensionCategory | string;
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

export interface ExtensionStatsData {
  total: number;
  enabled: number;
  disabled: number;
  byCategory: Record<string, number>;
}

export interface CategoryMeta {
  id: ExtensionCategory;
  label: string;
  shortLabel: string;
  description: string;
  badgeClass: string;
  iconBgClass: string;
  borderClass: string;
  colorHex: string;
}
