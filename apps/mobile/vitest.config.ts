import path from "node:path";
import { defineConfig } from "vitest/config";

// Pure TypeScript modules only (parsers, reducers): nothing here loads
// React Native, so tests run in Node.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
