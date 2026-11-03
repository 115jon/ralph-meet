// ── Desktop deep links ───────────────────────────────────────────────────────
// The desktop shell (desktop/src-tauri/src/main_window.rs) routes every
// `yap://` or `ralphmeet://` link (second launch, deep-link plugin, cold start) into one
// event, `rm://deep-link` with `{ url }`, after dropping repeats. Links that
// arrive before the page listens are queued in Rust and handed over by
// `take_pending_deep_links`. This module is the page's one listener; see
// docs/desktop/window-shell.md. The page reaches it through
// `getHost().deepLinks` (src/lib/host).

import { invokeCommand, listenEvent } from "@/lib/host/tauri-gateway";
import type { DeepLinkSubscription } from "@/lib/host/types";
import { isRecord } from "@/lib/persisted-guard";

export const DESKTOP_DEEP_LINK_EVENT = "rm://deep-link";

/**
 * The desktop app's link schemes: `yap:`, and Ralph Meet's `ralphmeet:`, which
 * the installer still points at the app so links shared before the rename work.
 */
const DESKTOP_DEEP_LINK_PROTOCOLS: readonly string[] = ["yap:", "ralphmeet:"];

export interface DesktopDeepLinkPayload {
  url: string;
}

type DeepLinkHandler = (url: string) => void;

let handler: DeepLinkHandler | null = null;
/** Links that arrived while no handler was subscribed. */
let buffered: string[] = [];
let started: Promise<void> | null = null;

function deliver(url: string) {
  if (handler) handler(url);
  else buffered.push(url);
}

/** The URL of an event payload, or null when it is not a `{ url }` object. */
export function readDeepLinkPayload(payload: unknown): string | null {
  if (!isRecord(payload) || typeof payload.url !== "string") return null;
  return payload.url;
}

/** The invite code of `yap://invite/<code>` (or `ralphmeet://`), or null. */
export function inviteCodeFromDeepLink(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (
      !DESKTOP_DEEP_LINK_PROTOCOLS.includes(parsed.protocol) ||
      parsed.hostname !== "invite"
    ) {
      return null;
    }
    return parsed.pathname.replace(/^\//, "") || null;
  } catch {
    return null;
  }
}

/** Attach the page's one event listener and collect queued links. Once per page. */
function start(): Promise<void> {
  started ??= (async () => {
    await listenEvent(DESKTOP_DEEP_LINK_EVENT, (payload) => {
      const url = readDeepLinkPayload(payload);
      if (url) deliver(url);
    });
    const pending = await invokeCommand("take_pending_deep_links");
    for (const url of pending) deliver(url);
  })().catch((error: unknown) => {
    started = null;
    throw error;
  });
  return started;
}

/**
 * Receive desktop deep links. One handler at a time (the latest wins); links
 * that arrive between handlers are kept for the next one. Returns the
 * unsubscribe function and a promise that settles once listening started.
 */
export function subscribeDesktopDeepLinks(
  next: DeepLinkHandler,
): DeepLinkSubscription {
  handler = next;
  const queued = buffered;
  buffered = [];
  for (const url of queued) next(url);

  return {
    unsubscribe: () => {
      if (handler === next) handler = null;
    },
    ready: start(),
  };
}

/** Test-only: forget the listener so a test can start it again. */
export function resetDesktopDeepLinksForTests() {
  handler = null;
  buffered = [];
  started = null;
}
