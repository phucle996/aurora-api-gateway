import { API_BASE_URL, getAuthToken } from '../fetcher';

export interface ClusterSpecInfo {
  releaseId: number;
  hash: string;
  hasSpec: boolean;
}

export const specApi = {
  getClusterSpec: async (): Promise<ClusterSpecInfo> => {
    try {
      const token = getAuthToken();
      const res = await fetch(
        `${API_BASE_URL}/api/v1/sync/spec?node_id=cluster-dashboard-probe`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }
      );
      if (res.ok) {
        const hash = res.headers.get('X-Aurora-Spec-Hash') || '';
        const releaseId = parseInt(
          res.headers.get('X-Aurora-Release-ID') || '0',
          10
        );
        return {
          releaseId,
          hash,
          hasSpec: Boolean(hash),
        };
      }
      return { releaseId: 0, hash: '', hasSpec: false };
    } catch {
      return { releaseId: 0, hash: '', hasSpec: false };
    }
  },
};
