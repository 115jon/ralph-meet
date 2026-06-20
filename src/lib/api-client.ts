import {
  clearDesktopAuthSession,
  getDesktopAuthHandoffToken,
  getDesktopToken,
  getStoredKovaAuthSessionToken,
  refreshDesktopToken,
  waitForDesktopToken,
} from "@/lib/desktop-auth";
import { apiUrl, isTauri } from "@/lib/platform";
import { KOVA_AUTH_PUBLISHABLE_KEY } from "@/lib/kova-auth-config";
import { clog } from "@/lib/console-logger";

const log = clog("api-client");

function getClientBearerToken(): string | null {
  return getDesktopToken() ?? getStoredKovaAuthSessionToken();
}

function createDesktopAuthRequiredError(): Error {
  const error = new Error("Desktop authentication required");
  (error as any).code = "DESKTOP_AUTH_REQUIRED";
  (error as any).status = 401;
  return error;
}

function createAuthRequiredError(): Error {
  const error = new Error("Authentication required");
  (error as any).code = "AUTH_REQUIRED";
  (error as any).status = 401;
  return error;
}

const inFlightGetRequests = new Map<string, Promise<unknown>>();
let inFlightDesktopTokenRefresh: Promise<string | null> | null = null;

async function getInitialBearerToken(): Promise<string | null> {
  if (!isTauri()) {
    return getStoredKovaAuthSessionToken() ?? await waitForDesktopToken(750);
  }

  const existing = getDesktopAuthHandoffToken();
  if (existing) return existing;

  return waitForDesktopToken();
}

async function refreshDesktopTokenOnce(): Promise<string | null> {
  if (!inFlightDesktopTokenRefresh) {
    inFlightDesktopTokenRefresh = refreshDesktopToken({ force: true })
      .finally(() => {
        inFlightDesktopTokenRefresh = null;
      });
  }
  return inFlightDesktopTokenRefresh;
}

function apiGetDedupeKey(url: string, opts?: ApiOptions) {
  return JSON.stringify({
    url,
    headers: opts?.headers ?? {},
    skipAuth: opts?.skipAuth ?? false,
  });
}

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
interface ApiFetchInit extends RequestInit {
  skipAuth?: boolean;
}

export async function apiFetch<T>(input: RequestInfo | URL, init?: ApiFetchInit): Promise<T> {
  const { skipAuth = false, ...fetchInit } = init ?? {};
  // Prefix relative paths with the platform-appropriate base URL
  const resolved = typeof input === "string" && input.startsWith("/")
    ? apiUrl(input)
    : input;
  const initialToken = skipAuth ? null : await getInitialBearerToken();

  if (!skipAuth && isTauri() && !initialToken) {
    throw createDesktopAuthRequiredError();
  }
  if (!skipAuth && !isTauri() && !initialToken) {
    throw createAuthRequiredError();
  }

  const doFetch = (token?: string | null) => {
    const authHeaders: Record<string, string> = {};
    const t = skipAuth ? null : token ?? getClientBearerToken();
    if (t) {
      authHeaders["Authorization"] = `Bearer ${t}`;
    }
    if (!skipAuth && isTauri() && KOVA_AUTH_PUBLISHABLE_KEY) {
      authHeaders["X-Publishable-Key"] = KOVA_AUTH_PUBLISHABLE_KEY;
    }

    log.info("Request", {
      url: String(resolved),
      method: fetchInit.method ?? "GET",
      hasBearerToken: !!t,
    });

    return fetch(resolved, {
      ...fetchInit,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
        ...fetchInit.headers,
      }
    });
  };

  let res = await doFetch(initialToken);

  // 401 recovery: refresh the kova-auth token and retry once.
  if (!skipAuth && res.status === 401 && isTauri()) {
    log.warn("401 received; attempting token refresh", {
      url: String(resolved),
    });
    const freshToken = await refreshDesktopTokenOnce();
    log.info("Token refresh finished", {
      url: String(resolved),
      hasFreshToken: !!freshToken,
    });
    if (freshToken) {
      res = await doFetch(freshToken);
    } else {
      clearDesktopAuthSession();
      throw createDesktopAuthRequiredError();
    }
  }

  // Handle empty responses (204 No Content, etc.) without attempting JSON parse
  const contentLength = res.headers.get('content-length');
  if (res.status === 204 || contentLength === '0') {
    if (!res.ok) {
      throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
    }
    return undefined as T;
  }

  let json: any;
  try {
    json = await res.json();
  } catch (err) {
    if (!res.ok) {
      log.error(`HTTP Error ${res.status}: ${res.statusText} on ${resolved}`);
      throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
    }
    log.error(`Parse error on ${resolved}`, err);
    throw new Error('Failed to parse API response');
  }

  if (!res.ok) {
    log.error(`Failed ${resolved} with status ${res.status}:`, json);
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
  skipAuth?: boolean;
}

/**
 * GET request helper.
 */
export async function apiGet<T>(url: string, opts?: ApiOptions): Promise<T> {
  if (opts?.signal) {
    return apiFetch<T>(url, { method: 'GET', signal: opts.signal, headers: opts.headers, skipAuth: opts.skipAuth });
  }

  const key = apiGetDedupeKey(url, opts);
  const existing = inFlightGetRequests.get(key);
  if (existing) return existing as Promise<T>;

  const request = apiFetch<T>(url, { method: 'GET', headers: opts?.headers, skipAuth: opts?.skipAuth })
    .finally(() => {
      inFlightGetRequests.delete(key);
    });
  inFlightGetRequests.set(key, request);
  return request;
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
    skipAuth: opts?.skipAuth,
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
    skipAuth: opts?.skipAuth,
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
    skipAuth: opts?.skipAuth,
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
    skipAuth: opts?.skipAuth,
  });
}

/**
 * Upload helper for FormData (multipart/form-data).
 * Does NOT set Content-Type header — the browser sets it automatically
 * with the correct boundary.
 */
export async function apiUpload<T>(url: string, formData: FormData, opts?: ApiOptions): Promise<T> {
  const resolved = url.startsWith("/") ? apiUrl(url) : url;
  const initialToken = await getInitialBearerToken();

  if (isTauri() && !initialToken) {
    throw createDesktopAuthRequiredError();
  }
  if (!isTauri() && !initialToken) {
    throw createAuthRequiredError();
  }

  const doFetch = (token?: string | null) => {
    const headers: Record<string, string> = { ...(opts?.headers ?? {}) };
    const t = token ?? getClientBearerToken();
    if (t) {
      headers["Authorization"] = `Bearer ${t}`;
    }
    if (isTauri() && KOVA_AUTH_PUBLISHABLE_KEY) {
      headers["X-Publishable-Key"] = KOVA_AUTH_PUBLISHABLE_KEY;
    }

    return fetch(resolved, {
      method: 'POST',
      body: formData,
      signal: opts?.signal,
      headers,
    });
  };

  let res = await doFetch(initialToken);

  // 401 recovery: refresh the kova-auth token and retry once.
  if (res.status === 401 && isTauri()) {
    const freshToken = await refreshDesktopTokenOnce();
    if (freshToken) {
      res = await doFetch(freshToken);
    } else {
      clearDesktopAuthSession();
      throw createDesktopAuthRequiredError();
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
