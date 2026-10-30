/**
 * Dev server config for the UI Lab when it runs behind a public DevDoor URL
 * (*.115jon.com). It wraps the normal config and tightens what a public dev
 * server must not expose:
 *  - fs.strict: true, so /@fs/ cannot read files outside the workspace;
 *  - a deny list for the secrets and local state inside it (.dev.vars,
 *    .env*, .wrangler/), which Vite only enforces when strict is on;
 *  - a guard that refuses every other dot-path and Vite's dev-tool
 *    endpoints (open-in-editor, the Worker debugger page);
 *  - only *.115jon.com (plus localhost) may connect;
 *  - Vite's default HMR (no localhost pin), so hot reload works through the door;
 *  - a keepalive so Cloudflare does not close an idle HMR socket (~125s).
 *
 * Run: pnpm exec vite --config vite.lab.config.ts --port 5190
 */
import { defineConfig, mergeConfig, type Plugin, type UserConfig } from "vite";
import baseConfig from "./vite.config";

// Setting fs.deny replaces Vite's defaults, so the first four repeat them.
const FS_DENY = [
  ".env",
  ".env.*",
  "*.{crt,pem}",
  "**/.git/**",
  ".dev.vars",
  ".dev.vars.*",
  ".npmrc",
  "**/.wrangler/**",
];

// The deny list is not enough on its own: `/.dev.vars?import&raw` still
// returned the file with fs.strict on. So the guard below refuses every
// dot-path (except the folders Vite and the web need) and Vite's dev-tool
// endpoints before any other middleware sees the request.
const ALLOWED_DOT_SEGMENTS = new Set([".vite", ".pnpm", ".well-known"]);
const LOCAL_ONLY_PREFIXES = ["/__open-in-editor", "/__debug", "/__inspect"];
const NO_STORE = "private, no-store";

function isRefused(url: string): boolean {
  let path = url.split("?")[0] ?? "/";
  for (let i = 0; i < 3; i++) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      return true;
    }
    if (decoded === path) break;
    path = decoded;
  }
  path = path.replace(/\\/g, "/").toLowerCase();
  return (
    LOCAL_ONLY_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
    path
      .split("/")
      .some(
        (segment) =>
          segment.startsWith(".") &&
          segment !== "." &&
          segment !== ".." &&
          !ALLOWED_DOT_SEGMENTS.has(segment),
      )
  );
}

const devdoorGuard = (): Plugin => ({
  name: "devdoor-guard",
  apply: "serve",
  enforce: "pre",
  configureServer(server) {
    server.middlewares.stack.unshift({
      route: "",
      handle: (req, res, next) => {
        // Cloudflare's zone Browser Cache TTL rewrites Vite's `no-cache` to
        // a 4h max-age and the edge caches .css paths, so browsers kept stale
        // modules. `private, no-store` is never rewritten or edge-cached.
        const setHeader = res.setHeader.bind(res);
        res.setHeader = (name, value) =>
          setHeader(
            name,
            name.toLowerCase() === "cache-control" ? NO_STORE : value,
          );
        setHeader("Cache-Control", NO_STORE);
        if (!isRefused(req.url ?? "/")) return next();
        res.statusCode = 403;
        res.end("Forbidden");
      },
    });
  },
});

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
    plugins: [devdoorGuard(), devdoorKeepalive()],
    server: {
      allowedHosts: [".115jon.com", "localhost"],
      fs: { strict: true, deny: FS_DENY },
    },
  });
  // mergeConfig deep-merges; drop the localhost HMR pin outright.
  if (merged.server) delete merged.server.hmr;
  return merged;
});
