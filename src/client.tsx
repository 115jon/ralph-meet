import { afterLoadIdle } from "@/lib/idle";

async function bootstrap() {
  // React Scan's toolbar is a dev aid for a desk browser. On a phone (dev
  // previews through a door) it collapses to a ">" tab on the left edge
  // that reads as part of the composer, so touch screens skip it.
  if (
    import.meta.env.DEV &&
    !window.location.pathname.startsWith("/ui-fixtures") &&
    window.matchMedia("(pointer: fine)").matches
  ) {
    const { scan } = await import("react-scan");
    scan({ enabled: true });
  }

  const [{ StartClient }, { hydrateRoot }] = await Promise.all([
    import("@tanstack/react-start/client"),
    import("react-dom/client"),
  ]);

  hydrateRoot(document, <StartClient />);

  // Once the page has loaded and the browser is idle, download (not run) the
  // chunks this visitor will probably need next.
  afterLoadIdle(() => {
    void import("@/lib/prefetch").then((mod) => mod.prefetchLikelyNext());
  });
}

void bootstrap();
