import { getStoredKovaAuthSessionToken } from "@/lib/desktop-auth";

/**
 * Fetch the chunks a visitor will probably need next, once the page has
 * loaded and the browser is idle, so the next navigation or the Join button
 * does not wait on the network. The build writes the chunk lists to
 * `/prefetch-manifest.json` (tools/vite/prefetch-manifest.ts); this module
 * only chooses the groups for the current page. Prefetch downloads at the
 * lowest priority and runs nothing.
 */
export type PrefetchGroup = "chat" | "sign-in" | "room" | "room-voice";

type Manifest = Partial<Record<PrefetchGroup, readonly string[]>>;

/** What each public page leads to. `signedIn` is a hint from a stored token. */
export function groupsForPath(
  pathname: string,
  signedIn: boolean,
): PrefetchGroup[] {
  if (pathname === "/") return signedIn ? ["chat"] : ["sign-in", "room"];
  if (pathname === "/sign-in" || pathname === "/sign-up") return ["chat"];
  if (pathname === "/activate") return signedIn ? [] : ["sign-in"];
  if (pathname.startsWith("/room/")) return ["room-voice"];
  return [];
}

type NetworkInformationLike = { saveData?: boolean; effectiveType?: string };

/** Data Saver and 2G connections keep what they asked for, nothing more. */
export function canPrefetch(connection?: NetworkInformationLike): boolean {
  if (connection?.saveData) return false;
  return !/(^|-)2g$/.test(connection?.effectiveType ?? "");
}

/** Chunk URLs to fetch: the groups' files, minus any the page already has. */
export function chunksToPrefetch(
  manifest: Manifest,
  groups: readonly PrefetchGroup[],
  alreadyRequested: ReadonlySet<string>,
): string[] {
  const urls = new Set<string>();
  for (const group of groups) {
    for (const url of manifest[group] ?? []) {
      if (!alreadyRequested.has(url)) urls.add(url);
    }
  }
  return [...urls];
}

function requestedPaths(): Set<string> {
  const paths = new Set<string>();
  for (const entry of performance.getEntriesByType("resource")) {
    try {
      paths.add(new URL(entry.name).pathname);
    } catch {
      /* not a URL we can compare */
    }
  }
  for (const link of document.querySelectorAll<HTMLLinkElement>(
    'link[rel="prefetch"], link[rel="modulepreload"]',
  )) {
    paths.add(new URL(link.href, location.href).pathname);
  }
  return paths;
}

export async function prefetchLikelyNext(
  pathname: string = location.pathname,
): Promise<void> {
  if (import.meta.env.DEV) return;
  const connection = (
    navigator as Navigator & { connection?: NetworkInformationLike }
  ).connection;
  if (!canPrefetch(connection)) return;

  const groups = groupsForPath(pathname, !!getStoredKovaAuthSessionToken());
  if (groups.length === 0) return;

  let manifest: Manifest;
  try {
    const response = await fetch("/prefetch-manifest.json");
    if (!response.ok) return;
    manifest = (await response.json()) as Manifest;
  } catch {
    return; // Offline or an old deploy: nothing is lost by not prefetching.
  }

  for (const href of chunksToPrefetch(manifest, groups, requestedPaths())) {
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.as = "script";
    // Module scripts are fetched in CORS mode; match it or the browser
    // fetches the file a second time when the import runs.
    link.crossOrigin = "anonymous";
    link.href = href;
    document.head.appendChild(link);
  }
}
