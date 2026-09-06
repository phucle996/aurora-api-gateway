import { api } from '../fetcher';
import type { DomainItem } from '../../pages/domains/types';

export interface ListDomainsParams extends Record<string, string | number | boolean | null | undefined> {
  search?: string;
  status?: string;
  tls_type?: string;
  tag?: string;
  page?: number;
  limit?: number;
}

export interface ListDomainsResponse {
  items: DomainItem[];
  counts: {
    total: number;
    active: number;
    inactive: number;
    mtls_enabled: number;
  };
  total_filtered: number;
  page: number;
  limit: number;
}

export const domainsApi = {
  list: (params?: ListDomainsParams) =>
    api.get<ListDomainsResponse>('/api/v1/domains', params),
};
