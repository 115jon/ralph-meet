import type { ApiResponse } from './types';

/**
 * Core fetcher that unwraps our standard ApiResponse<T> structure.
 * Throws an error if success is false, which can be caught by SWR/React Query/try-catch.
 */
export async function apiFetch<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    }
  });

  let json: ApiResponse<T>;
  try {
    json = await res.json();
  } catch (err) {
    if (!res.ok) {
      throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
    }
    throw new Error('Failed to parse API response');
  }

  if ('error' in json && typeof json.error === 'string') {
    // Standardized API Error
    const error = new Error(json.error || 'Unknown API Error');
    (error as any).code = json.code;
    (error as any).status = res.status;
    throw error;
  }

  return json.data as T;
}

/**
 * A handy wrapper for generic GET requests.
 */
export async function apiGet<T>(url: string, init?: Omit<RequestInit, 'method'>): Promise<T> {
  return apiFetch<T>(url, { ...init, method: 'GET' });
}

/**
 * A handy wrapper for generic POST requests.
 */
export async function apiPost<T, B = unknown>(url: string, body: B, init?: Omit<RequestInit, 'method' | 'body'>): Promise<T> {
  return apiFetch<T>(url, {
    ...init,
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * A handy wrapper for generic PUT requests.
 */
export async function apiPut<T, B = unknown>(url: string, body: B, init?: Omit<RequestInit, 'method' | 'body'>): Promise<T> {
  return apiFetch<T>(url, {
    ...init,
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

/**
 * A handy wrapper for generic PATCH requests.
 */
export async function apiPatch<T, B = unknown>(url: string, body: B, init?: Omit<RequestInit, 'method' | 'body'>): Promise<T> {
  return apiFetch<T>(url, {
    ...init,
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/**
 * A handy wrapper for generic DELETE requests.
 */
export async function apiDelete<T, B = unknown>(url: string, body?: B, init?: Omit<RequestInit, 'method' | 'body'>): Promise<T> {
  return apiFetch<T>(url, {
    ...init,
    method: 'DELETE',
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
