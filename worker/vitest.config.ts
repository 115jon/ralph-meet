import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./worker/wrangler.toml" },
    }),
  ],
  test: {
    include: ["worker/__tests__/**/*.worker.test.ts"],
    setupFiles: process.env.CI === "true" ? ["./worker/test-setup.ts"] : [],
  },
  resolve: {
    alias: {
      "@": path.resolve(sourceRoot),
    },
  },
});
