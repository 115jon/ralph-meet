/**
 * Desktop SPA entry point.
 *
 * This bypasses TanStack Start's SSR and mounts the shared React app as a
 * client-only SPA in the Tauri webview.
 */
import "./styles.css";

import { AppTitleBarContent } from "@/components/chat/AppTitleBar";
import { SplashScreen } from "@/components/SplashScreen";
import { StandaloneUpdater } from "@/components/StandaloneUpdater";
import { UpdateChecker } from "@/components/UpdateChecker";
import { ThemeProvider } from "@/components/theme-provider";
import { useDesktopSettingsStore } from "@/stores/useDesktopSettingsStore";
import { routeTree } from "@/routeTree.gen";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { StrictMode, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ReactNode } from "react";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function DesktopApp() {
  const win = getCurrentWindow();
  console.info(`[DesktopApp] Mount. Window label is: ${win.label}`);
  const isUpdater = win.label === "updater";
  const syncDesktopSettings = useDesktopSettingsStore(
    (state) => state.syncToBackend,
  );

  useEffect(() => {
    if (!isUpdater) void syncDesktopSettings();
  }, [isUpdater, syncDesktopSettings]);

  return (
    <StrictMode>
      {isUpdater ? (
        <ThemeProvider>
          <StandaloneUpdater />
        </ThemeProvider>
      ) : (
        <DesktopWindowChrome>
          <Suspense fallback={<SplashScreen />}>
            <RouterProvider router={router} />
            <UpdateChecker />
          </Suspense>
        </DesktopWindowChrome>
      )}
    </StrictMode>
  );
}

type ResizeEdge =
  | "top"
  | "right"
  | "bottom"
  | "left"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

const resizeEdgeClasses: Record<ResizeEdge, string> = {
  top: "desktop-resize-handle-top",
  right: "desktop-resize-handle-right",
  bottom: "desktop-resize-handle-bottom",
  left: "desktop-resize-handle-left",
  "top-left": "desktop-resize-handle-top-left",
  "top-right": "desktop-resize-handle-top-right",
  "bottom-left": "desktop-resize-handle-bottom-left",
  "bottom-right": "desktop-resize-handle-bottom-right",
};

const resizeEdges = Object.keys(resizeEdgeClasses) as ResizeEdge[];

function DesktopWindowChrome({ children }: { children: ReactNode }) {
  const [appWindow] = useState(() => getCurrentWindow());
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let disposed = false;
    let requestVersion = 0;

    const syncMaximizedState = () => {
      const currentRequest = ++requestVersion;
      void appWindow
        .isMaximized()
        .then((maximized) => {
          if (!disposed && currentRequest === requestVersion) {
            setIsMaximized(maximized);
          }
        })
        .catch((error: unknown) => {
          console.error(
            "[DesktopWindowChrome] Failed to read maximize state",
            error,
          );
        });
    };

    syncMaximizedState();
    let unlisten: (() => void) | undefined;
    void appWindow.onResized(syncMaximizedState).then((cleanup) => {
      if (disposed) {
        cleanup();
      } else {
        unlisten = cleanup;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [appWindow]);

  const runWindowAction = (action: () => Promise<unknown>) => {
    void action().catch((error: unknown) => {
      console.error("[DesktopWindowChrome] Window action failed", error);
    });
  };

  return (
    <div className="desktop-window-shell">
      <header
        className="desktop-window-titlebar"
        aria-label="Application title bar"
      >
        <div className="desktop-window-titlebar-leading">
          <button
            type="button"
            className="desktop-window-nav-button"
            aria-label="Go back"
            title="Go back"
            onClick={() => window.history.back()}
          >
            <span aria-hidden="true">&#8249;</span>
          </button>
          <button
            type="button"
            className="desktop-window-nav-button"
            aria-label="Go forward"
            title="Go forward"
            onClick={() => window.history.forward()}
          >
            <span aria-hidden="true">&#8250;</span>
          </button>
        </div>

        <AppTitleBarContent className="desktop-window-title" />

        <div className="desktop-window-controls">
          <WindowControlButton
            icon="minimize"
            label="Minimize"
            onClick={() =>
              runWindowAction(() => invoke("minimize_main_window"))
            }
          />
          <WindowControlButton
            icon="maximize"
            label={isMaximized ? "Restore" : "Maximize"}
            onClick={() => runWindowAction(() => appWindow.toggleMaximize())}
          />
          <WindowControlButton
            icon="close"
            label="Close"
            close
            onClick={() => runWindowAction(() => appWindow.close())}
          />
        </div>
      </header>

      <main className="desktop-window-content">{children}</main>
      {!isMaximized && <WindowResizeHandles />}
    </div>
  );
}

function WindowControlButton({
  icon,
  label,
  close = false,
  onClick,
}: {
  icon: "minimize" | "maximize" | "close";
  label: string;
  close?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`desktop-window-control${close ? " desktop-window-control-close" : ""}`}
      aria-label={label}
      onClick={onClick}
    >
      <WindowControlIcon icon={icon} />
    </button>
  );
}

function WindowControlIcon({
  icon,
}: {
  icon: "minimize" | "maximize" | "close";
}) {
  if (icon === "minimize") {
    return (
      <svg
        className="desktop-window-control-icon"
        aria-hidden="true"
        width="12"
        height="12"
        viewBox="0 0 12 12"
      >
        <rect fill="currentColor" width="10" height="1" x="1" y="6" />
      </svg>
    );
  }

  if (icon === "maximize") {
    return (
      <svg
        className="desktop-window-control-icon"
        aria-hidden="true"
        width="12"
        height="12"
        viewBox="0 0 12 12"
      >
        <rect
          width="9"
          height="9"
          x="1.5"
          y="1.5"
          fill="none"
          stroke="currentColor"
        />
      </svg>
    );
  }

  return (
    <svg
      className="desktop-window-control-icon"
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 12 12"
    >
      <polygon
        fill="currentColor"
        fillRule="evenodd"
        points="11 1.576 6.583 6 11 10.424 10.424 11 6 6.583 1.576 11 1 10.424 5.417 6 1 1.576 1.576 1 6 5.417 10.424 1"
      />
    </svg>
  );
}

function WindowResizeHandles() {
  const startResize = (edge: ResizeEdge) => {
    void invoke("start_window_resize", { edge }).catch((error: unknown) => {
      console.error("[DesktopWindowChrome] Resize action failed", error);
    });
  };

  return (
    <>
      {resizeEdges.map((edge) => (
        <div
          key={edge}
          className={`desktop-resize-handle ${resizeEdgeClasses[edge]}`}
          aria-hidden="true"
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            startResize(edge);
          }}
        />
      ))}
    </>
  );
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<DesktopApp />);
}
