import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

const rootDir = path.resolve(import.meta.dirname, "..");
const shimDir = path.resolve(rootDir, "src/shims");

/**
 * Desktop-specific Vite config.
 *
 * Differences from the main vite.config.ts:
 *   - No @cloudflare/vite-plugin (no SSR, no Miniflare)
 *   - No tanstackStart plugin (SPA-only, client-side routing)
 *   - Uses desktop/index.html as the entry point
 *   - Shares the same src/ directory for components, stores, and routes
 */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    viteReact(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),

      // ── Shims for server-only / Cloudflare-only imports ────────────
      "cloudflare:workers": path.resolve(import.meta.dirname, "shims/cloudflare-workers.ts"),
      "@tanstack/react-start/server": path.resolve(import.meta.dirname, "shims/tanstack-react-start-server.ts"),
      "@tanstack/react-start": path.resolve(import.meta.dirname, "shims/tanstack-react-start.ts"),
      "@clerk/tanstack-react-start/server": path.resolve(import.meta.dirname, "shims/clerk-tanstack-server.ts"),
      "@clerk/tanstack-react-start": path.resolve(import.meta.dirname, "shims/clerk-tanstack.tsx"),
      "@clerk/backend": path.resolve(import.meta.dirname, "shims/clerk-backend.ts"),
      "@clerk/themes": path.resolve(import.meta.dirname, "shims/clerk-themes.ts"),

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
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:5173",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:5173",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
});
