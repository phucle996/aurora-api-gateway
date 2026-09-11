import type { RouteItem } from '../../lib/api/routes';

export type { RouteItem };

export interface RouteFormState {
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
}

export const DEFAULT_ROUTE_FORM: RouteFormState = {
  name: '',
  host: '',
  path: '/',
  upstream_name: '',
  enabled: true,
  strip_path: false,
  websocket: false,
  priority: 10,
  plugins_json: '{}',
  description: '',
};
