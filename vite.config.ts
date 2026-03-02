import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

const shimDir = path.resolve(import.meta.dirname, "src/shims");

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
