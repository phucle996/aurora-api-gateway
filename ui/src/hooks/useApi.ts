import { useState, useEffect, useCallback } from 'react';
import { ApiError } from '../lib/fetcher';

interface UseApiOptions<T> {
  immediate?: boolean;
  onSuccess?: (data: T) => void;
  onError?: (err: ApiError) => void;
}

export function useApi<T = any>(
  apiFn: () => Promise<T>,
  options: UseApiOptions<T> = { immediate: true }
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(options.immediate ?? true);
  const [error, setError] = useState<ApiError | null>(null);

  const execute = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFn();
      setData(result);
      if (options.onSuccess) options.onSuccess(result);
      return result;
    } catch (err: any) {
      const apiErr =
        err instanceof ApiError
          ? err
          : new ApiError(0, 'Unknown Error', null, err.message);
      setError(apiErr);
      if (options.onError) options.onError(apiErr);
      throw apiErr;
    } finally {
      setLoading(false);
    }
  }, [apiFn, options]);

  useEffect(() => {
    if (options.immediate) {
      execute().catch(() => {});
    }
  }, [execute, options.immediate]);

  return { data, loading, error, execute, refetch: execute };
}
