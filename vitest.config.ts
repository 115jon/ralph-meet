import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "worker/**/*.test.ts"],
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
    },
  },
});
