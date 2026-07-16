export interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export type SafeAreaInvoke = <T>(command: string) => Promise<T>;

export function getSafeAreaCssVariables(
  insets: SafeAreaInsets,
): Record<string, string> {
  return {
    "--safe-area-top": `${insets.top}px`,
    "--safe-area-bottom": `${insets.bottom}px`,
    "--safe-area-bottom-computed": `${Math.max(insets.bottom, 48)}px`,
    "--safe-area-left": `${insets.left}px`,
    "--safe-area-right": `${insets.right}px`,
  };
}

export function setupSafeArea(
  invoke: SafeAreaInvoke,
  documentRef: Document,
  windowRef: Window,
): () => void {
  let disposed = false;
  let refreshVersion = 0;
  const enablePromise = invoke<void>("plugin:edge-to-edge|enable");

  const applyInsets = (insets: SafeAreaInsets) => {
    const style = documentRef.documentElement.style;
    for (const [name, value] of Object.entries(
      getSafeAreaCssVariables(insets),
    )) {
      style.setProperty(name, value);
    }
  };

  const refresh = async () => {
    const version = ++refreshVersion;
    try {
      await enablePromise;
      if (disposed || version !== refreshVersion) return;
      const insets = await invoke<SafeAreaInsets>(
        "plugin:edge-to-edge|get_safe_area_insets",
      );
      if (!disposed && version === refreshVersion && insets) {
        applyInsets(insets);
      }
    } catch {
      if (!disposed) {
        console.warn("Failed to initialize edge-to-edge safe area");
      }
    }
  };

  const handleViewportChange = () => {
    void refresh();
  };

  windowRef.addEventListener("orientationchange", handleViewportChange);
  windowRef.addEventListener("resize", handleViewportChange);
  windowRef.visualViewport?.addEventListener("resize", handleViewportChange);
  void refresh();

  return () => {
    disposed = true;
    refreshVersion++;
    windowRef.removeEventListener("orientationchange", handleViewportChange);
    windowRef.removeEventListener("resize", handleViewportChange);
    windowRef.visualViewport?.removeEventListener(
      "resize",
      handleViewportChange,
    );
  };
}
