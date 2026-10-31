import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const sourceRoot = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.test.toml" },
    }),
  ],
  test: {
    include: ["realtime/__tests__/**/*.worker.test.ts"],
    setupFiles: ["./realtime/test-setup.ts"],
    // The Durable Objects import Effect Schema (src/lib/gateway-protocol).
    // Pre-bundled, it loads as one module instead of hundreds per test file.
    deps: { optimizer: { ssr: { enabled: true, include: ["effect"] } } },
  },
  resolve: {
    alias: {
      "@": path.resolve(sourceRoot),
    },
  },
});
