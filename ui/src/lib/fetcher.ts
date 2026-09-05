/**
 * Aurora WAF - Universal API Fetcher & HTTP Client
 * Provides centralized base URL configuration, authentication headers,
 * request/response interceptors, query serialization, and robust error handling.
 */

// Base URL configuration (from environment variable or current host)
export const API_BASE_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) || '';

const TOKEN_STORAGE_KEY = 'aurora_admin_token';
const USER_STORAGE_KEY = 'aurora_admin_user';

export interface AuthUserInfo {
  id: string;
  username: string;
  role: string;
}

/**
 * Authentication token & user helpers
 */
export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Ignore localStorage write failure in restricted environments
  }
}

export function removeAuthToken(): void {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export function getAuthUser(): AuthUserInfo | null {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setAuthUser(user: AuthUserInfo): void {
  try {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  } catch {
    // Ignore
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch(buildUrl('/api/v1/auth/logout'), {
      method: 'POST',
      credentials: 'same-origin',
    });
  } catch {
    // Ignore network errors on logout
  }
  removeAuthToken();
  try {
    localStorage.removeItem(USER_STORAGE_KEY);
  } catch {
    // Ignore
  }
  window.location.href = '/login';
}

/**
 * Custom API Error class with HTTP status code and response payload
 */
export class ApiError extends Error {
  status: number;
  statusText: string;
  data: any;

  constructor(status: number, statusText: string, data: any, message?: string) {
    super(
      message ||
        (typeof data === 'string'
          ? data
          : data?.message || `HTTP ${status}: ${statusText}`)
    );
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
    this.data = data;
  }
}

/**
 * Fetcher request options
 */
export interface FetchOptions extends Omit<RequestInit, 'body'> {
  params?: Record<string, string | number | boolean | undefined | null>;
  body?: any;
  token?: string;
  idempotencyKey?: string;
  timeoutMs?: number;
}

/**
 * Build URL with query parameters
 */
export function buildUrl(
  endpoint: string,
  params?: Record<string, string | number | boolean | undefined | null>
): string {
  // Normalize leading slashes
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  let url = `${API_BASE_URL}${cleanEndpoint}`;

  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        searchParams.append(key, String(value));
      }
    }
    const queryString = searchParams.toString();
    if (queryString) {
      url += (url.includes('?') ? '&' : '?') + queryString;
    }
  }

  return url;
}

/**
 * Core fetcher function with timeout, auth headers, and JSON serialization
 */
export async function fetcher<T = any>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> {
  const {
    params,
    body,
    token,
    idempotencyKey,
    timeoutMs = 30000,
    headers: customHeaders = {},
    ...customConfig
  } = options;

  const url = buildUrl(endpoint, params);
  const authToken = token !== undefined ? token : getAuthToken();

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(customHeaders as Record<string, string>),
  };

  // Add Authorization header if token exists
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  // Add Idempotency-Key if provided
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  // Handle Request Body
  let requestBody: BodyInit | undefined;
  if (body !== undefined) {
    if (
      typeof body === 'string' ||
      body instanceof FormData ||
      body instanceof Blob ||
      body instanceof URLSearchParams
    ) {
      requestBody = body;
    } else {
      headers['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(body);
    }
  }

  // Setup abort controller for request timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Link signal if provided in customConfig
  if (customConfig.signal) {
    customConfig.signal.addEventListener('abort', () => controller.abort());
  }

  try {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...customConfig,
      headers,
      body: requestBody,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Handle No-Content (204)
    if (response.status === 204) {
      return null as unknown as T;
    }

    // Try parsing response as JSON or text
    const contentType = response.headers.get('content-type') || '';
    let responseData: any;

    if (contentType.includes('application/json')) {
      responseData = await response.json().catch(() => null);
    } else {
      responseData = await response.text().catch(() => '');
    }

    if (!response.ok) {
      throw new ApiError(
        response.status,
        response.statusText,
        responseData,
        typeof responseData === 'string' ? responseData : responseData?.message
      );
    }

    return responseData as T;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err instanceof ApiError) {
      throw err;
    }
    if (err.name === 'AbortError') {
      throw new ApiError(408, 'Request Timeout', null, `Request timed out after ${timeoutMs}ms`);
    }
    throw new ApiError(0, 'Network Error', null, err.message || 'Failed to fetch');
  }
}

/**
 * Convenient HTTP verb helpers
 */
export const api = {
  get: <T = any>(
    endpoint: string,
    params?: Record<string, string | number | boolean | undefined | null>,
    options?: Omit<FetchOptions, 'params'>
  ) => fetcher<T>(endpoint, { method: 'GET', params, ...options }),

  post: <T = any>(endpoint: string, body?: any, options?: FetchOptions) =>
    fetcher<T>(endpoint, { method: 'POST', body, ...options }),

  put: <T = any>(endpoint: string, body?: any, options?: FetchOptions) =>
    fetcher<T>(endpoint, { method: 'PUT', body, ...options }),

  patch: <T = any>(endpoint: string, body?: any, options?: FetchOptions) =>
    fetcher<T>(endpoint, { method: 'PATCH', body, ...options }),

  delete: <T = any>(endpoint: string, options?: FetchOptions) =>
    fetcher<T>(endpoint, { method: 'DELETE', ...options }),
};

export default api;
