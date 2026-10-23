import {
  getCachedCollectiblesCatalog,
  loadCollectiblesCatalog,
  subscribeCollectiblesCatalog,
} from "@/lib/collectibles-catalog-client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * The shared collectibles catalog. Reads the client cache synchronously and
 * asks the server once on mount (the client lib dedupes and backs off).
 */
export function useCollectiblesCatalog() {
  const catalog = useSyncExternalStore(
    subscribeCollectiblesCatalog,
    getCachedCollectiblesCatalog,
    () => null,
  );
  const [error, setError] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadCollectiblesCatalog()
      .then(() => {
        if (!cancelled) setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Couldn't load collectibles.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { catalog, error, loading: !catalog && !settled };
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () =>
      typeof window !== "undefined" && !!window.matchMedia
        ? window.matchMedia(REDUCED_MOTION_QUERY).matches
        : false,
    () => false,
  );
}

/**
 * Whether the element is on screen (with a margin). Animated previews use it
 * to stop decoding APNG/video frames once they scroll away.
 */
export function useInView<T extends Element>(rootMargin = "120px") {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(Boolean(entry?.isIntersecting)),
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin]);

  return [ref, inView] as const;
}
