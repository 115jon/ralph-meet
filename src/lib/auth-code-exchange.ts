// ── Pending sign-in code exchange ───────────────────────────────────────────
// Kova's hosted sign-ins (OAuth, magic link) come back with
// `?kova_auth_code=…&state=…`. The Kova SDK strips those params from the URL
// in its first effect and then trades the code for an app token
// (`exchange-code`). Until that answers there is no token, and an empty
// answer from anything else (get-session, the cookie mint, a 401) says
// nothing about whether the user is signed in.
//
// This module reads the code at load, before the SDK can strip it, and
// reports the exchange as pending until a token lands, the SDK reports an
// auth error, or EXCHANGE_TIMEOUT_MS passes.

import { useSyncExternalStore } from "react";
import { subscribeDesktopTokenChanges } from "@/lib/desktop-auth";

/** A code exchange that has not answered by now is not coming. */
export const EXCHANGE_TIMEOUT_MS = 15_000;

let pending = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let stopWatchingTokens: (() => void) | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of [...listeners]) listener();
}

/** The exchange answered (a token landed or the SDK gave up), or timed out. */
export function settleAuthCodeExchange(): void {
  if (!pending) return;
  pending = false;
  if (timer) clearTimeout(timer);
  timer = null;
  stopWatchingTokens?.();
  stopWatchingTokens = null;
  emit();
}

function begin(): void {
  pending = true;
  timer = setTimeout(settleAuthCodeExchange, EXCHANGE_TIMEOUT_MS);
  stopWatchingTokens = subscribeDesktopTokenChanges((token) => {
    if (token) settleAuthCodeExchange();
  });
}

/** True when `search` carries a Kova sign-in code for the SDK to exchange. */
export function hasAuthCode(search: string): boolean {
  return new URLSearchParams(search).has("kova_auth_code");
}

if (typeof window !== "undefined" && hasAuthCode(window.location.search)) {
  begin();
}

export function isAuthCodeExchangePending(): boolean {
  return pending;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Resolves once no exchange is pending (at once if none is). */
export function whenAuthCodeExchangeSettles(): Promise<void> {
  if (!pending) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = subscribe(() => {
      if (pending) return;
      unsubscribe();
      resolve();
    });
  });
}

export function useAuthCodeExchangePending(): boolean {
  return useSyncExternalStore(
    subscribe,
    isAuthCodeExchangePending,
    () => false,
  );
}

export function beginAuthCodeExchangeForTests(): void {
  settleAuthCodeExchange();
  begin();
}

export function resetAuthCodeExchangeForTests(): void {
  settleAuthCodeExchange();
  listeners.clear();
}
