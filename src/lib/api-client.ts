import {
  getAppSessionState,
  recoverAppSession,
} from "@/lib/app-session-recovery";
import {
  getDesktopAuthHandoffToken,
  getDesktopToken,
  getStoredKovaAuthSessionToken,
  waitForDesktopToken,
} from "@/lib/desktop-auth";
import { apiUrl, isTauri } from "@/lib/platform";
import { KOVA_AUTH_PUBLISHABLE_KEY } from "@/lib/kova-auth-config";
import { clog } from "@/lib/console-logger";

const log = clog("api-client");

/**
 * Statuses callers treat as answers, not faults: 401 (signed out, session
 * probe) and 404 (bad invite, missing share). The caller decides what to
 * show; logging them as console errors only adds noise to every page.
 */
const EXPECTED_FAILURE_STATUSES = new Set([401, 404]);

function logHttpFailure(status: number, message: string, ...args: unknown[]) {
  if (EXPECTED_FAILURE_STATUSES.has(status)) log.debug(message, ...args);
  else log.error(message, ...args);
}

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

function createHttpResponseError(
  res: Response,
  json: any,
  fallbackMessage: string,
): Error {
  const message =
    (json &&
      typeof json === "object" &&
      typeof json.error === "string" &&
      json.error) ||
    (json &&
      typeof json === "object" &&
      typeof json.message === "string" &&
      json.message) ||
    fallbackMessage;

  const error = new Error(message);
  (error as any).code =
    json && typeof json === "object" ? json.code : undefined;
  (error as any).status = res.status;
  return error;
}

async function getInitialBearerToken(): Promise<string | null> {
  if (!isTauri()) {
    return getStoredKovaAuthSessionToken() ?? (await waitForDesktopToken(750));
  }

  const existing = getDesktopAuthHandoffToken();
  if (existing) return existing;

  return waitForDesktopToken();
}

/**
 * A 401 for `rejectedToken`: ask Kova for a fresh app token (one mint shared
 * by every refused call, see app-session-recovery). The fresh token to retry
 * with, or null. On desktop a session that is gone for good is the
 * device-code sign-in's job, so it throws DESKTOP_AUTH_REQUIRED.
 */
async function recoverFrom401(
  rejectedToken: string | null,
): Promise<string | null> {
  const freshToken = await recoverAppSession(rejectedToken);
  if (freshToken && freshToken !== rejectedToken) return freshToken;
  if (isTauri() && getAppSessionState() === "signed-out") {
    throw createDesktopAuthRequiredError();
  }
  return null;
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
 * On a 401 it asks Kova for a fresh app session token from the still-valid
 * auth-domain session and retries the request once (web and desktop).
 */
interface ApiFetchInit extends RequestInit {
  skipAuth?: boolean;
}

async function apiFetch<T>(
  input: RequestInfo | URL,
  init?: ApiFetchInit,
): Promise<T> {
  const requestStartedAt = Date.now();
  const { skipAuth = false, ...fetchInit } = init ?? {};
  // Prefix relative paths with the platform-appropriate base URL
  const resolved =
    typeof input === "string" && input.startsWith("/") ? apiUrl(input) : input;
  const initialToken = skipAuth ? null : await getInitialBearerToken();

  if (!skipAuth && isTauri() && !initialToken) {
    throw createDesktopAuthRequiredError();
  }
  if (!skipAuth && !isTauri() && !initialToken) {
    throw createAuthRequiredError();
  }

  /** The bearer the last request carried. */
  let sentToken: string | null = null;
  const doFetch = (token?: string | null) => {
    const authHeaders: Record<string, string> = {};
    const t = skipAuth ? null : (token ?? getClientBearerToken());
    sentToken = t;
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
        "Content-Type": "application/json",
        ...authHeaders,
        ...fetchInit.headers,
      },
    });
  };

  let res: Response;
  try {
    res = await doFetch(initialToken);
  } catch (error) {
    log.error("Network request failed", {
      url: String(resolved),
      method: fetchInit.method ?? "GET",
      error,
    });
    throw error;
  }
  log.info("Response", {
    url: String(resolved),
    status: res.status,
    ok: res.ok,
    contentType: res.headers.get("content-type"),
    durationMs: Date.now() - requestStartedAt,
  });

  // 401 recovery: mint a fresh app token and retry once.
  if (!skipAuth && res.status === 401) {
    log.warn("401 received; attempting session recovery", {
      url: String(resolved),
    });
    const freshToken = await recoverFrom401(sentToken);
    log.info("Session recovery finished", {
      url: String(resolved),
      hasFreshToken: !!freshToken,
    });
    if (freshToken) {
      try {
        res = await doFetch(freshToken);
      } catch (error) {
        log.error("Retry network request failed", {
          url: String(resolved),
          method: fetchInit.method ?? "GET",
          error,
        });
        throw error;
      }
      log.info("Retry response", {
        url: String(resolved),
        status: res.status,
        ok: res.ok,
        contentType: res.headers.get("content-type"),
        durationMs: Date.now() - requestStartedAt,
      });
    }
  }

  // Handle empty responses (204 No Content, etc.) without attempting JSON parse
  const contentLength = res.headers.get("content-length");
  if (res.status === 204 || contentLength === "0") {
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
      logHttpFailure(
        res.status,
        `HTTP Error ${res.status}: ${res.statusText} on ${resolved}`,
      );
      throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
    }
    log.error(`Parse error on ${resolved}`, err);
    throw new Error("Failed to parse API response");
  }

  if (!res.ok) {
    logHttpFailure(
      res.status,
      `Failed ${resolved} with status ${res.status}:`,
      json,
    );
    throw createHttpResponseError(
      res,
      json,
      `HTTP Error ${res.status}: ${res.statusText}`,
    );
  }

  if (
    json &&
    typeof json === "object" &&
    "error" in json &&
    typeof json.error === "string"
  ) {
    const error = new Error(json.error || "Unknown API Error");
    (error as any).code = json.code;
    (error as any).status = res.status;
    throw error;
  }

  log.info("Response body shape", {
    url: String(resolved),
    kind: Array.isArray(json) ? "array" : typeof json,
    count: Array.isArray(json) ? json.length : undefined,
    keys:
      json && typeof json === "object" && !Array.isArray(json)
        ? Object.keys(json).slice(0, 12)
        : undefined,
  });

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
    return apiFetch<T>(url, {
      method: "GET",
      signal: opts.signal,
      headers: opts.headers,
      skipAuth: opts.skipAuth,
    });
  }

  const key = apiGetDedupeKey(url, opts);
  const existing = inFlightGetRequests.get(key);
  if (existing) return existing as Promise<T>;

  const request = apiFetch<T>(url, {
    method: "GET",
    headers: opts?.headers,
    skipAuth: opts?.skipAuth,
  }).finally(() => {
    inFlightGetRequests.delete(key);
  });
  inFlightGetRequests.set(key, request);
  return request;
}

/**
 * POST request helper (JSON body).
 */
export async function apiPost<T, B = unknown>(
  url: string,
  body: B,
  opts?: ApiOptions,
): Promise<T> {
  return apiFetch<T>(url, {
    method: "POST",
    body: JSON.stringify(body),
    signal: opts?.signal,
    headers: opts?.headers,
    skipAuth: opts?.skipAuth,
  });
}

/**
 * PUT request helper (JSON body).
 */
export async function apiPut<T, B = unknown>(
  url: string,
  body: B,
  opts?: ApiOptions,
): Promise<T> {
  return apiFetch<T>(url, {
    method: "PUT",
    body: JSON.stringify(body),
    signal: opts?.signal,
    headers: opts?.headers,
    skipAuth: opts?.skipAuth,
  });
}

/**
 * PATCH request helper (JSON body).
 */
export async function apiPatch<T, B = unknown>(
  url: string,
  body: B,
  opts?: ApiOptions,
): Promise<T> {
  return apiFetch<T>(url, {
    method: "PATCH",
    body: JSON.stringify(body),
    signal: opts?.signal,
    headers: opts?.headers,
    skipAuth: opts?.skipAuth,
  });
}

/**
 * DELETE request helper (optional JSON body).
 */
export async function apiDelete<T, B = unknown>(
  url: string,
  body?: B,
  opts?: ApiOptions,
): Promise<T> {
  return apiFetch<T>(url, {
    method: "DELETE",
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
export async function apiUpload<T>(
  url: string,
  formData: FormData,
  opts?: ApiOptions,
): Promise<T> {
  const resolved = url.startsWith("/") ? apiUrl(url) : url;
  const initialToken = await getInitialBearerToken();

  if (isTauri() && !initialToken) {
    throw createDesktopAuthRequiredError();
  }
  if (!isTauri() && !initialToken) {
    throw createAuthRequiredError();
  }

  let sentToken: string | null = null;
  const doFetch = (token?: string | null) => {
    const headers: Record<string, string> = { ...(opts?.headers ?? {}) };
    const t = token ?? getClientBearerToken();
    sentToken = t;
    if (t) {
      headers["Authorization"] = `Bearer ${t}`;
    }
    if (isTauri() && KOVA_AUTH_PUBLISHABLE_KEY) {
      headers["X-Publishable-Key"] = KOVA_AUTH_PUBLISHABLE_KEY;
    }

    return fetch(resolved, {
      method: "POST",
      body: formData,
      signal: opts?.signal,
      headers,
    });
  };

  let res = await doFetch(initialToken);

  // 401 recovery: mint a fresh app token and retry once.
  if (res.status === 401) {
    const freshToken = await recoverFrom401(sentToken);
    if (freshToken) res = await doFetch(freshToken);
  }

  let json: any;
  try {
    json = await res.json();
  } catch {
    if (!res.ok) {
      throw new Error(`Upload failed: HTTP ${res.status}`);
    }
    throw new Error("Failed to parse upload response");
  }

  if (!res.ok) {
    throw createHttpResponseError(
      res,
      json,
      `Upload failed: HTTP ${res.status}`,
    );
  }

  if (
    json &&
    typeof json === "object" &&
    "error" in json &&
    typeof json.error === "string"
  ) {
    const error = new Error(json.error || "Upload failed");
    (error as any).code = json.code;
    (error as any).status = res.status;
    throw error;
  }

  return json as T;
}
