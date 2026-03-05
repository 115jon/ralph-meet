/**
 * useExternalLinkHandler — Desktop-only global click interceptor.
 *
 * On Tauri, clicking an `<a href="https://...">` navigates the webview
 * away from the app (which is catastrophic). This hook intercepts all
 * link clicks with external or `target="_blank"` hrefs and opens them
 * in the user's default system browser via `@tauri-apps/plugin-shell`.
 *
 * On web, this hook is a no-op — the browser handles links natively.
 */

import { isDesktop } from "@/lib/platform";
import { useEffect } from "react";

export function useExternalLinkHandler() {
  useEffect(() => {
    if (!isDesktop()) return;

    const handler = async (e: MouseEvent) => {
      // Walk up from the event target to find the nearest <a> element
      const anchor = (e.target as HTMLElement)?.closest?.("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      // Skip in-app navigation (relative URLs, hash links, javascript:)
      if (
        href.startsWith("/") ||
        href.startsWith("#") ||
        href.startsWith("javascript:") ||
        href.startsWith("ralphmeet://")
      ) {
        return;
      }

      // Skip blob: and data: URLs (used by file downloads, image viewers, etc.)
      if (href.startsWith("blob:") || href.startsWith("data:")) {
        return;
      }

      // External URL (http://, https://, mailto:, etc.) → open in system browser
      e.preventDefault();
      e.stopPropagation();

      try {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(href);
      } catch {
        // Fallback: if shell plugin fails, try window.open
        window.open(href, "_blank");
      }
    };

    // Use capture phase to intercept before React's synthetic event system
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, []);
}
