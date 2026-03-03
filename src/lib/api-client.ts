import { getDesktopToken, refreshDesktopToken } from "@/lib/desktop-auth";
import { apiUrl, isTauri } from "@/lib/platform";

/**
 * Core fetcher that handles our API error convention.
 * If the response contains an `error` key, it throws.
 * Otherwise it returns the parsed JSON directly as T.
 *
 * Accepts an optional AbortSignal for request cancellation.
 * Automatically prefixes relative paths with the API base URL
 * for cross-platform (web / Tauri desktop) compatibility.
 *
 * On desktop, if a request returns 401, it will automatically
 * refresh the Clerk token and retry the request once.
 */
export async function apiFetch<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  // Prefix relative paths with the platform-appropriate base URL
  const resolved = typeof input === "string" && input.startsWith("/")
    ? apiUrl(input)
    : input;

  const doFetch = (token?: string | null) => {
    const desktopHeaders: Record<string, string> = {};
    if (isTauri()) {
      const t = token ?? getDesktopToken();
      if (t) {
        desktopHeaders["Authorization"] = `Bearer ${t}`;
      }
    }

    return fetch(resolved, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...desktopHeaders,
        ...init?.headers,
      }
    });
  };

  let res = await doFetch();

  // 401 recovery: refresh the Clerk token and retry once (desktop only)
  if (res.status === 401 && isTauri()) {
    const freshToken = await refreshDesktopToken();
    if (freshToken) {
      res = await doFetch(freshToken);
    }
  }

  let json: any;
  try {
    json = await res.json();
  } catch {
    if (!res.ok) {
      throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
    }
    throw new Error('Failed to parse API response');
  }

  if (json && typeof json === 'object' && 'error' in json && typeof json.error === 'string') {
    const error = new Error(json.error || 'Unknown API Error');
    (error as any).code = json.code;
    (error as any).status = res.status;
    throw error;
  }

  return json as T;
}

/** Options shared by all typed helpers */
interface ApiOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/**
 * GET request helper.
 */
export async function apiGet<T>(url: string, opts?: ApiOptions): Promise<T> {
  return apiFetch<T>(url, { method: 'GET', signal: opts?.signal, headers: opts?.headers });
}

/**
 * POST request helper (JSON body).
 */
export async function apiPost<T, B = unknown>(url: string, body: B, opts?: ApiOptions): Promise<T> {
  return apiFetch<T>(url, {
    method: 'POST',
    body: JSON.stringify(body),
    signal: opts?.signal,
    headers: opts?.headers,
  });
}

/**
 * PUT request helper (JSON body).
 */
export async function apiPut<T, B = unknown>(url: string, body: B, opts?: ApiOptions): Promise<T> {
  return apiFetch<T>(url, {
    method: 'PUT',
    body: JSON.stringify(body),
    signal: opts?.signal,
    headers: opts?.headers,
  });
}

/**
 * PATCH request helper (JSON body).
 */
export async function apiPatch<T, B = unknown>(url: string, body: B, opts?: ApiOptions): Promise<T> {
  return apiFetch<T>(url, {
    method: 'PATCH',
    body: JSON.stringify(body),
    signal: opts?.signal,
    headers: opts?.headers,
  });
}

/**
 * DELETE request helper (optional JSON body).
 */
export async function apiDelete<T, B = unknown>(url: string, body?: B, opts?: ApiOptions): Promise<T> {
  return apiFetch<T>(url, {
    method: 'DELETE',
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: opts?.signal,
    headers: opts?.headers,
  });
}

/**
 * Upload helper for FormData (multipart/form-data).
 * Does NOT set Content-Type header — the browser sets it automatically
 * with the correct boundary.
 */
export async function apiUpload<T>(url: string, formData: FormData, opts?: ApiOptions): Promise<T> {
  const resolved = url.startsWith("/") ? apiUrl(url) : url;

  const doFetch = (token?: string | null) => {
    const headers: Record<string, string> = {};
    if (isTauri()) {
      const t = token ?? getDesktopToken();
      if (t) {
        headers["Authorization"] = `Bearer ${t}`;
      }
    }

    return fetch(resolved, {
      method: 'POST',
      body: formData,
      signal: opts?.signal,
      headers,
    });
  };

  let res = await doFetch();

  // 401 recovery: refresh the Clerk token and retry once (desktop only)
  if (res.status === 401 && isTauri()) {
    const freshToken = await refreshDesktopToken();
    if (freshToken) {
      res = await doFetch(freshToken);
    }
  }

  let json: any;
  try {
    json = await res.json();
  } catch {
    if (!res.ok) {
      throw new Error(`Upload failed: HTTP ${res.status}`);
    }
    throw new Error('Failed to parse upload response');
  }

  if (json && typeof json === 'object' && 'error' in json && typeof json.error === 'string') {
    const error = new Error(json.error || 'Upload failed');
    (error as any).code = json.code;
    (error as any).status = res.status;
    throw error;
  }

  return json as T;
}
