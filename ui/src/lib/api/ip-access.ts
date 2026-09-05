import { api } from '../fetcher';

export const ipAccessApi = {
  list: (params?: { search?: string; type?: string; status?: string }) =>
    api.get<any[]>('/api/v1/ip-access', params),

  create: (payload: any) => api.post<any>('/api/v1/ip-access', payload),

  delete: (id: string | number) => api.delete(`/api/v1/ip-access/${id}`),
};
