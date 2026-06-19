import { isVideo } from "@/lib/media";
import { useEffect, useMemo, useState } from "react";

export type VideoPlaybackAvailability = "checking" | "playable" | "poster";

export interface VideoPlaybackAvailabilityRequest {
  src?: string | null;
  contentType?: string | null;
  posterUrl?: string;
  sourceUrl?: string | null;
  isAnimated?: boolean;
}

type ResolvedVideoPlaybackAvailability = Exclude<VideoPlaybackAvailability, "checking">;

const resolvedAvailabilityCache = new Map<string, ResolvedVideoPlaybackAvailability>();
const pendingAvailabilityChecks = new Map<string, Promise<ResolvedVideoPlaybackAvailability>>();
const availabilityListeners = new Map<string, Set<() => void>>();

function isProxyMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(
      url,
      typeof window !== "undefined" ? window.location.origin : "https://localhost",
    );
    return parsed.pathname === "/api/proxy-media" || parsed.pathname.endsWith("/api/proxy-media");
  } catch {
    return url.includes("/api/proxy-media?");
  }
}

export function shouldProbeVideoPlaybackAvailability(
  request: VideoPlaybackAvailabilityRequest,
): boolean {
  if (!request.src) return false;
  if (!isVideo(request.contentType)) return false;
  if (request.isAnimated) return false;
  if (!request.posterUrl) return false;
  return isProxyMediaUrl(request.src);
}

function getAvailabilityCacheKey(request: VideoPlaybackAvailabilityRequest): string | null {
  if (!shouldProbeVideoPlaybackAvailability(request) || !request.src) return null;
  return request.src;
}

function subscribeAvailability(key: string, listener: () => void): () => void {
  const listeners = availabilityListeners.get(key) ?? new Set<() => void>();
  listeners.add(listener);
  availabilityListeners.set(key, listeners);

  return () => {
    const current = availabilityListeners.get(key);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      availabilityListeners.delete(key);
    }
  };
}

function notifyAvailabilityListeners(key: string): void {
  const listeners = availabilityListeners.get(key);
  if (!listeners) return;
  for (const listener of listeners) {
    listener();
  }
}

async function probeVideoPlaybackAvailability(
  request: VideoPlaybackAvailabilityRequest,
): Promise<ResolvedVideoPlaybackAvailability> {
  if (!request.src) return "poster";

  try {
    const response = await fetch(request.src, {
      method: "GET",
      headers: {
        Range: "bytes=0-0",
      },
    });
    const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    return response.ok && contentType.startsWith("video/") ? "playable" : "poster";
  } catch {
    return "poster";
  }
}

export async function primeVideoPlaybackAvailability(
  request: VideoPlaybackAvailabilityRequest,
): Promise<ResolvedVideoPlaybackAvailability> {
  const key = getAvailabilityCacheKey(request);
  if (!key) return "playable";

  const resolved = resolvedAvailabilityCache.get(key);
  if (resolved) return resolved;

  const pending = pendingAvailabilityChecks.get(key);
  if (pending) return pending;

  notifyAvailabilityListeners(key);

  const check: Promise<ResolvedVideoPlaybackAvailability> = probeVideoPlaybackAvailability(request)
    .then((availability) => {
      resolvedAvailabilityCache.set(key, availability);
      pendingAvailabilityChecks.delete(key);
      notifyAvailabilityListeners(key);
      return availability;
    })
    .catch(() => {
      resolvedAvailabilityCache.set(key, "poster");
      pendingAvailabilityChecks.delete(key);
      notifyAvailabilityListeners(key);
      return "poster" as const;
    });

  pendingAvailabilityChecks.set(key, check);
  return check;
}

function getAvailabilitySnapshot(
  request: VideoPlaybackAvailabilityRequest,
): VideoPlaybackAvailability {
  const key = getAvailabilityCacheKey(request);
  if (!key) return "playable";

  const resolved = resolvedAvailabilityCache.get(key);
  if (resolved) return resolved;
  return "checking";
}

export function useVideoPlaybackAvailability(
  request: VideoPlaybackAvailabilityRequest,
): VideoPlaybackAvailability {
  const cacheKey = useMemo(() => getAvailabilityCacheKey(request), [
    request.contentType,
    request.isAnimated,
    request.posterUrl,
    request.sourceUrl,
    request.src,
  ]);
  const [availability, setAvailability] = useState<VideoPlaybackAvailability>(
    () => getAvailabilitySnapshot(request),
  );

  useEffect(() => {
    if (!cacheKey) {
      setAvailability("playable");
      return;
    }

    setAvailability(getAvailabilitySnapshot(request));
    const unsubscribe = subscribeAvailability(cacheKey, () => {
      setAvailability(getAvailabilitySnapshot(request));
    });
    void primeVideoPlaybackAvailability(request);
    return unsubscribe;
  }, [
    cacheKey,
    request.contentType,
    request.isAnimated,
    request.posterUrl,
    request.sourceUrl,
    request.src,
  ]);

  return availability;
}

export function clearVideoPlaybackAvailabilityCacheForTests(): void {
  resolvedAvailabilityCache.clear();
  pendingAvailabilityChecks.clear();
  availabilityListeners.clear();
}
