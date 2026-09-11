import { api } from '../fetcher';

export interface CertificateItem {
  id: string;
  name: string;
  snis_json: string;
  cert_pem: string;
  key_pem: string;
  mtls_enabled: boolean;
  client_ca_pem: string;
  verify_depth: number;
  enabled: boolean;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface ListCertificatesParams extends Record<string, string | number | boolean | null | undefined> {
  search?: string;
  page?: number;
  limit?: number;
}

export interface ListCertificatesResponse {
  items: CertificateItem[];
  total: number;
}

export interface CreateCertificatePayload {
  name: string;
  snis: string[];
  cert_pem: string;
  key_pem: string;
  mtls_enabled?: boolean;
  client_ca_pem?: string;
  verify_depth?: number;
  enabled?: boolean;
  description?: string;
}

export interface UpdateCertificatePayload {
  name: string;
  snis: string[];
  cert_pem: string;
  key_pem: string;
  mtls_enabled?: boolean;
  client_ca_pem?: string;
  verify_depth?: number;
  enabled?: boolean;
  description?: string;
}

export const certificatesApi = {
  list: (params?: ListCertificatesParams) => api.get<ListCertificatesResponse>('/api/v1/certificates', params),
  get: (id: string) => api.get<CertificateItem>(`/api/v1/certificates/${id}`),
  create: (payload: CreateCertificatePayload) => api.post<CertificateItem>('/api/v1/certificates', payload),
  update: (id: string, payload: UpdateCertificatePayload) => api.put<CertificateItem>(`/api/v1/certificates/${id}`, payload),
  toggle: (id: string, enabled: boolean) => api.patch<CertificateItem>(`/api/v1/certificates/${id}/toggle`, { enabled }),
  delete: (id: string) => api.delete<{ status: string; id: string }>(`/api/v1/certificates/${id}`),
};
