/**
 * Scroll reveals that never hide server-rendered content.
 *
 * Elements opt in with `data-reveal`. Markup ships with no state, so without
 * JavaScript (and before hydration) everything is simply visible. After
 * mount, anything already inside the viewport is marked `in` with no
 * transition, and everything below the fold is marked `out` and watched by
 * one IntersectionObserver; crossing into view flips it to `in` once. The
 * CSS lives in styles.css under "Landing page" and honours reduced motion.
 *
 * `data-reveal-delay` (ms) staggers siblings that enter together.
 */

import { useEffect, type RefObject } from "react";

export function useRevealOnScroll(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver !== "function") return;

    const nodes = Array.from(
      root.querySelectorAll<HTMLElement>("[data-reveal]"),
    );
    if (nodes.length === 0) return;

    const viewport = window.innerHeight || 0;
    const pending: HTMLElement[] = [];
    for (const node of nodes) {
      const delay = node.dataset.revealDelay;
      if (delay) node.style.setProperty("--reveal-delay", `${delay}ms`);
      const top = node.getBoundingClientRect().top;
      if (top < viewport * 0.92) {
        node.dataset.reveal = "in";
        node.dataset.revealInstant = "true";
      } else {
        node.dataset.reveal = "out";
        pending.push(node);
      }
    }
    if (pending.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const node = entry.target as HTMLElement;
          node.dataset.reveal = "in";
          observer.unobserve(node);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.08 },
    );
    for (const node of pending) observer.observe(node);
    return () => observer.disconnect();
  }, [rootRef]);
}
