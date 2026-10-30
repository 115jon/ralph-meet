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
}

void bootstrap();
