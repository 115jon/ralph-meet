async function bootstrap() {
  if (
    import.meta.env.DEV &&
    !window.location.pathname.startsWith("/ui-fixtures")
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
