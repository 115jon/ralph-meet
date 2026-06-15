import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "worker/**/*.test.ts"],
    exclude: ["node_modules", ".next", ".open-next"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts", "worker/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "cloudflare:workers": path.resolve(
        __dirname,
        "./src/test/shims/cloudflare-workers.ts"
      ),
      "@tauri-apps/plugin-shell": path.resolve(__dirname, "./src/shims/tauri-plugin-shell.ts"),
      "@tauri-apps/plugin-updater": path.resolve(__dirname, "./src/shims/tauri-plugin-updater.ts"),
      "@tauri-apps/plugin-process": path.resolve(__dirname, "./src/shims/tauri-plugin-process.ts"),
      "@tauri-apps/plugin-autostart": path.resolve(__dirname, "./src/shims/tauri-plugin-autostart.ts"),
      "@tauri-apps/plugin-notification": path.resolve(__dirname, "./src/shims/tauri-plugin-notification.ts"),
      "tauri-plugin-status-bar-color-api": path.resolve(__dirname, "./src/shims/tauri-plugin-status-bar-color-api.ts"),
    },
  },
});
