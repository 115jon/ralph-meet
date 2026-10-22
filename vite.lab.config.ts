/**
 * Dev server config for the UI Lab when it runs behind a public DevDoor URL
 * (*.115jon.com). It wraps the normal config and tightens what a public dev
 * server must not expose:
 *  - fs.strict: true, so /@fs/ cannot read files outside the workspace;
 *  - only *.115jon.com (plus localhost) may connect;
 *  - Vite's default HMR (no localhost pin), so hot reload works through the door;
 *  - a keepalive so Cloudflare does not close an idle HMR socket (~125s).
 *
 * Run: pnpm exec vite --config vite.lab.config.ts --port 5190
 */
import { defineConfig, mergeConfig, type Plugin, type UserConfig } from "vite";
import baseConfig from "./vite.config";

const devdoorKeepalive = (): Plugin => ({
  name: "devdoor-keepalive",
  apply: "serve",
  configureServer(server) {
    const timer = setInterval(
      () => server.ws.send({ type: "custom", event: "devdoor:keepalive" }),
      30_000,
    );
    server.httpServer?.once("close", () => clearInterval(timer));
  },
});

export default defineConfig((env) => {
  const base = typeof baseConfig === "function" ? baseConfig(env) : baseConfig;
  const merged = mergeConfig(base as UserConfig, {
    plugins: [devdoorKeepalive()],
    server: {
      allowedHosts: [".115jon.com", "localhost"],
      fs: { strict: true },
    },
  });
  // mergeConfig deep-merges; drop the localhost HMR pin outright.
  if (merged.server) delete merged.server.hmr;
  return merged;
});
