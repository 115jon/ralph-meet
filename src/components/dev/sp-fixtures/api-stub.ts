/**
 * Fetch stub for the settings and profile fixtures (design-audit units
 * 15/16). Each fixture installs a route table for its lifetime; anything that
 * doesn't match passes through. The API client refuses to send without a
 * session token, so a placeholder is stored while a stub is installed (a real
 * token is left alone).
 */

import {
  clearStoredKovaAuthSessionToken,
  getStoredKovaAuthSessionToken,
  setStoredKovaAuthSessionToken,
} from "@/lib/desktop-auth";
import { useEffect, useState } from "react";

export type StubReply =
  | { status?: number; body?: unknown; delayMs?: number; pending?: boolean }
  | undefined;

export type StubRoute = {
  /** Matched against the request path (no origin, no query). */
  path: RegExp;
  method?: string;
  reply: (request: { url: URL; method: string; body: unknown }) => StubReply;
};

export const NOW = Date.parse("2026-10-22T14:32:00Z");
export const at = (minutesAgo: number) =>
  new Date(NOW - minutesAgo * 60_000).toISOString();
export const inMinutes = (minutes: number) =>
  new Date(Date.now() + minutes * 60_000).toISOString();

export const ok = (body: unknown, delayMs = 60): StubReply => ({
  status: 200,
  body,
  delayMs,
});
export const fail = (status: number, error = "Fixture failure"): StubReply => ({
  status,
  body: { error },
  delayMs: 60,
});
/** Never resolves: a loading state that stays put for the screenshot. */
export const pending = (): StubReply => ({ pending: true });

function installStub(routes: StubRoute[]) {
  const placeholder = getStoredKovaAuthSessionToken()
    ? null
    : "ui-fixture-session";
  if (placeholder) setStoredKovaAuthSessionToken(placeholder);
  const original = window.fetch;
  window.fetch = async (input, init) => {
    const href =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const url = new URL(href, window.location.origin);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const route = routes.find(
      (candidate) =>
        candidate.path.test(url.pathname) &&
        (!candidate.method || candidate.method === method),
    );
    if (!route) return original(input, init);
    let body: unknown = null;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const reply = route.reply({ url, method, body }) ?? ok({ ok: true });
    if (reply?.pending) return new Promise<Response>(() => {});
    await new Promise((resolve) => setTimeout(resolve, reply?.delayMs ?? 60));
    return new Response(JSON.stringify(reply?.body ?? { ok: true }), {
      status: reply?.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return () => {
    window.fetch = original;
    if (placeholder) clearStoredKovaAuthSessionToken();
  };
}

/**
 * Install `routes` before the first render of the children (so their
 * mount-time fetches hit the stub) and remove them on unmount.
 */
export function useApiStub(routes: StubRoute[]) {
  const [uninstall] = useState(() =>
    typeof window === "undefined" ? () => {} : installStub(routes),
  );
  useEffect(() => uninstall, [uninstall]);
}

/** Extra fixture query params the route doesn't validate. */
export function fixtureParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}
