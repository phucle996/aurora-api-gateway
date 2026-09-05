import { api } from '../fetcher';

export const rateLimitsApi = {
  list: (params?: { search?: string; status?: string }) =>
    api.get<any[]>('/api/v1/rate-limits', params),

  create: (payload: any) => api.post<any>('/api/v1/rate-limits', payload),

  update: (id: string | number, payload: any) =>
    api.put<any>(`/api/v1/rate-limits/${id}`, payload),

  delete: (id: string | number) => api.delete(`/api/v1/rate-limits/${id}`),
};
