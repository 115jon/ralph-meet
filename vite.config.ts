import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import path from "path";
import { defineConfig, type Plugin } from "vite";
import killerInstincts from "vite-plugin-killer-instincts";

const shimDir = path.resolve(import.meta.dirname, "src/shims");

/**
 * Map of modules that only exist in the desktop/worker environment
 * to their client-side no-op shims.
 */
const tauriShims: Record<string, string> = {
  "@tauri-apps/plugin-shell": path.resolve(shimDir, "tauri-plugin-shell.ts"),
  "@tauri-apps/plugin-updater": path.resolve(shimDir, "tauri-plugin-updater.ts"),
  "@tauri-apps/plugin-process": path.resolve(shimDir, "tauri-plugin-process.ts"),
  "@tauri-apps/plugin-autostart": path.resolve(shimDir, "tauri-plugin-autostart.ts"),
  "tauri-plugin-status-bar-color-api": path.resolve(shimDir, "tauri-plugin-status-bar-color-api.ts"),
};

function clientEnvironmentShims(): Plugin {
  return {
    name: "client-environment-shims",
    resolveId(id) {
      // 1. Shim cloudflare:workers ONLY in the client environment
      if (this.environment?.name === "client" && id === "cloudflare:workers") {
        return path.resolve(shimDir, "cloudflare-workers.ts");
      }

      // 2. Shim Tauri plugins in BOTH client and SSR environments
      // ONLY if we are NOT running inside Tauri.
      // because Tauri is never available in web/Cloudflare runtime.
      if (!process.env.TAURI_ENV_PLATFORM && id in tauriShims) {
        return tauriShims[id];
      }
    },
  };
}

export default defineConfig({
  server: {
    host: true,
    strictPort: true,
  },
  plugins: [
    killerInstincts({ autoKill: true }),
    cloudflare({
      viteEnvironment: { name: "ssr" },
      auxiliaryWorkers: [
        { configPath: "./worker/wrangler.toml" },
      ],
    }),
    clientEnvironmentShims(),
    tanstackStart({
      srcDirectory: "src",
      router: {
        routesDirectory: "routes",
        generatedRouteTree: "routeTree.gen.ts",
      },
    }),
    viteReact(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
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
});
