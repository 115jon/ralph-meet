import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import path from "path";
import { defineConfig, type Plugin } from "vite";

const shimDir = path.resolve(import.meta.dirname, "src/shims");

/**
 * Resolves `cloudflare:workers` to a no-op shim ONLY in the client
 * environment. TanStack Router's auto-generated route tree imports all
 * route files (including server-only API routes) in the client bundle.
 * Those API routes import `cloudflare:workers` which doesn't exist in
 * the browser — this plugin intercepts the import and returns a harmless
 * shim. The worker/SSR environment is unaffected and uses the real module.
 */
/**
 * Map of modules that only exist in the desktop/worker environment
 * to their client-side no-op shims.
 */
const clientShims: Record<string, string> = {
  "cloudflare:workers": path.resolve(shimDir, "cloudflare-workers.ts"),
  "@tauri-apps/plugin-updater": path.resolve(shimDir, "tauri-plugin-updater.ts"),
  "@tauri-apps/plugin-process": path.resolve(shimDir, "tauri-plugin-process.ts"),
};

function clientEnvironmentShims(): Plugin {
  return {
    name: "client-environment-shims",
    resolveId(id) {
      if (this.environment?.name === "client" && id in clientShims) {
        return clientShims[id];
      }
    },
  };
}

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
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
