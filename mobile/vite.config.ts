import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

const rootDir = path.resolve(import.meta.dirname, "..");
const shimDir = path.resolve(rootDir, "src/shims");

/**
 * Mobile-specific Vite config.
 *
 * Mirrors the desktop config but without:
 *   - Desktop-only Tauri plugin aliases (autostart, updater, window-state)
 *   - Dev server proxy (mobile connects directly to the Workers backend)
 *
 * Shares the same src/ directory for components, stores, and routes.
 */
export default defineConfig({
  root: import.meta.dirname,
  publicDir: path.resolve(rootDir, "public"),
  plugins: [
    viteReact(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
      "@kova/react": path.resolve(rootDir, "packages/kova-react/dist/index.js"),

      // ── Tauri plugin resolution ────────────────────────────────────
      // Map to this project's node_modules (not root)
      "@tauri-apps/plugin-shell": path.resolve(import.meta.dirname, "node_modules/@tauri-apps/plugin-shell"),
      "tauri-plugin-status-bar-color-api": path.resolve(import.meta.dirname, "node_modules/tauri-plugin-status-bar-color-api"),

      // ── Shims for server-only / Cloudflare-only imports ────────────
      "cloudflare:workers": path.resolve(import.meta.dirname, "shims/cloudflare-workers.ts"),
      "@tanstack/react-start/server": path.resolve(import.meta.dirname, "shims/tanstack-react-start-server.ts"),
      "@tanstack/react-start": path.resolve(import.meta.dirname, "shims/tanstack-react-start.ts"),
      // ── Desktop-only plugin shims (no-op on mobile) ────────────────
      "@tauri-apps/plugin-updater": path.resolve(import.meta.dirname, "shims/tauri-plugin-noop.ts"),
      "@tauri-apps/plugin-process": path.resolve(import.meta.dirname, "shims/tauri-plugin-noop.ts"),
      "@tauri-apps/plugin-autostart": path.resolve(import.meta.dirname, "shims/tauri-plugin-noop.ts"),

      // ── use-sync-external-store shims (shared with web config) ─────
      "use-sync-external-store/shim/with-selector": path.resolve(
        shimDir,
        "use-sync-external-store-with-selector.ts",
      ),
      "use-sync-external-store/shim/index.js": path.resolve(
        shimDir,
        "use-sync-external-store.ts",
      ),
      "use-sync-external-store/shim": path.resolve(
        shimDir,
        "use-sync-external-store.ts",
      ),
      "use-sync-external-store/with-selector.js": path.resolve(
        shimDir,
        "use-sync-external-store-with-selector.ts",
      ),
      "use-sync-external-store/with-selector": path.resolve(
        shimDir,
        "use-sync-external-store-with-selector.ts",
      ),
      "use-sync-external-store": path.resolve(
        shimDir,
        "use-sync-external-store.ts",
      ),
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    target: "chrome90", // Android WebView minimum
    rollupOptions: {
      input: path.resolve(import.meta.dirname, "index.html"),
    },
  },
  optimizeDeps: {
    entries: ["index.html"],
    exclude: ["src-tauri"],
  },
  envPrefix: ["VITE_", "TAURI_"],
  server: {
    host: "0.0.0.0",
    port: 1420,
    strictPort: true,
    hmr: {
      protocol: "ws",
      // On Android, `tauri android dev` sets __TAURI_DEV_HOST__ to the host
      // machine's LAN IP. Using "localhost" here would resolve to the Android
      // device's own loopback, breaking HMR. Fall back to localhost for
      // non-Android dev (e.g., `npm run dev:vite` for browser testing).
      host: process.env.__TAURI_DEV_HOST__ || "localhost",
      port: 1420,
    },
  },
  define: {
    __IS_MOBILE__: true,
    __IS_DESKTOP__: false,
  },
});
