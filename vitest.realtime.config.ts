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
    // Worker tests share the Miniflare Durable Object runtime; isolate files
    // to avoid timing contention and cross-file state interference.
    fileParallelism: false,
    maxWorkers: 1,
  },
  resolve: {
    alias: {
      "@": path.resolve(sourceRoot),
    },
  },
});
