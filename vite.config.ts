import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * Vite plugin that redirects all `use-sync-external-store` imports
 * (including subpaths like `/shim`, `/shim/index.js`, `/shim/with-selector`)
 * to a tiny ESM shim that re-exports from React 19 (which has the hook built-in).
 *
 * This is needed because the npm package is CJS-only and workerd can't load it.
 */
function useSyncExternalStoreShim(): Plugin {
  const shimPath = path.resolve(__dirname, "src/shims/use-sync-external-store.ts");

  return {
    name: "use-sync-external-store-shim",
    resolveId(source) {
      if (source === "use-sync-external-store" || source.startsWith("use-sync-external-store/")) {
        return shimPath;
      }
    },
  };
}

export default defineConfig({
  plugins: [
    useSyncExternalStoreShim(),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
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
      "@": "/src",
    },
  },
});
