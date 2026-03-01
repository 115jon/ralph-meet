import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
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
      // CJS→ESM shims: use-sync-external-store is CJS-only but React 18+
      // has useSyncExternalStore built-in. Alias to our ESM shim that
      // re-exports from React to avoid workerd CJS interop issues.
      "use-sync-external-store/shim/with-selector": path.resolve(
        __dirname,
        "src/shims/use-sync-external-store-with-selector.ts"
      ),
      "use-sync-external-store/shim": path.resolve(
        __dirname,
        "src/shims/use-sync-external-store.ts"
      ),
      "use-sync-external-store": path.resolve(
        __dirname,
        "src/shims/use-sync-external-store.ts"
      ),
    },
  },
});
