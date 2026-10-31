/**
 * Run `callback` at the next idle moment (or after `timeoutMs` at the latest);
 * returns a cancel function. Safari has no requestIdleCallback, so it falls
 * back to a short timer there.
 */
export function whenIdle(callback: () => void, timeoutMs = 1500): () => void {
  if (typeof window === "undefined") return () => {};
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(callback, { timeout: timeoutMs });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(callback, Math.min(timeoutMs, 200));
  return () => window.clearTimeout(handle);
}

/**
 * Run `callback` once the page has finished loading (`load` fired), then at
 * the next idle moment. Used to fetch chunks the visitor is likely to need
 * next without competing with what they are looking at.
 */
export function afterLoadIdle(
  callback: () => void,
  timeoutMs = 3000,
): () => void {
  if (typeof window === "undefined") return () => {};
  let cancelIdle: (() => void) | null = null;
  let cancelled = false;
  const start = () => {
    if (cancelled) return;
    cancelIdle = whenIdle(callback, timeoutMs);
  };
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener("load", start);
    cancelIdle?.();
  };
}
