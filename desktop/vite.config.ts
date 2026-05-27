import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import path from "path";
import { defineConfig, loadEnv } from "vite";

const rootDir = path.resolve(import.meta.dirname, "..");
const shimDir = path.resolve(rootDir, "src/shims");

/**
 * Desktop-specific Vite config.
 *
 * Differences from the main vite.config.ts:
 *   - No @cloudflare/vite-plugin (no SSR, no Miniflare)
 *   - No tanstackStart plugin (SPA-only, client-side routing)
 *   - Uses desktop/index.html as the entry point
 *   - Shares the same src/ directory for components, stores, and routes
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, "");
  const baseApiUrl = process.env.VITE_API_BASE_URL || env.VITE_API_BASE_URL || "http://localhost:5173";
  const baseWsUrl = baseApiUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");

  return {
    root: import.meta.dirname,
    envDir: rootDir,
    publicDir: path.resolve(rootDir, "public"),
    plugins: [
      viteReact(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        "@": path.resolve(rootDir, "src"),
        "@kova/react": path.resolve(rootDir, "../ralph-auth/packages/kova-react/src/index.ts"),

        // ── Tauri plugin resolution ────────────────────────────────────
        // These live in desktop/node_modules but are imported from ../src/.
        // Without explicit aliases, Vite walks up to root node_modules
        // (which doesn't have them). Map them directly.
        "@tauri-apps/plugin-shell": path.resolve(import.meta.dirname, "node_modules/@tauri-apps/plugin-shell"),
        "@tauri-apps/plugin-updater": path.resolve(import.meta.dirname, "node_modules/@tauri-apps/plugin-updater"),
        "@tauri-apps/plugin-process": path.resolve(import.meta.dirname, "node_modules/@tauri-apps/plugin-process"),
        "@tauri-apps/plugin-autostart": path.resolve(import.meta.dirname, "node_modules/@tauri-apps/plugin-autostart"),

        // ── Shims for server-only / Cloudflare-only imports ────────────
        "cloudflare:workers": path.resolve(import.meta.dirname, "shims/cloudflare-workers.ts"),

        // ── Shims for mobile-only Tauri plugins ─────────────────────────
        "tauri-plugin-status-bar-color-api": path.resolve(rootDir, "src/shims/tauri-plugin-status-bar-color-api.ts"),
        "@tanstack/react-start/server": path.resolve(import.meta.dirname, "shims/tanstack-react-start-server.ts"),
        "@tanstack/react-start": path.resolve(import.meta.dirname, "shims/tanstack-react-start.ts"),
        // ── use-sync-external-store shims (shared with web config) ─────
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
    server: {
      port: 1420,
      strictPort: true,
      hmr: {
        protocol: "ws",
        host: "localhost",
        clientPort: 1420,
      },
      proxy: {
        "/api": {
          target: baseApiUrl,
          changeOrigin: true,
          ws: true,
          // ── selfHandleResponse: take FULL control of the response ─────
          // Without this, http-proxy pipes proxyRes → res automatically,
          // which forces Transfer-Encoding: chunked and strips Content-Length.
          // Chromium's <video> range-request player demands Content-Length +
          // Content-Range on 206 — without both it loops infinitely with
          // ERR_REQUEST_RANGE_NOT_SATISFIABLE.
          selfHandleResponse: true,
          configure(proxy) {
            // ── Handle CORS preflight for cross-origin fetch from Tauri ──
            proxy.on("proxyReq", (_proxyReq, req, res) => {
              if (req.method === "OPTIONS") {
                (res as any).writeHead(204, {
                  "access-control-allow-origin": "*",
                  "access-control-allow-methods": "GET, OPTIONS",
                  "access-control-allow-headers": "Range, Authorization",
                  "access-control-max-age": "86400",
                });
                (res as any).end();
              }
            });

            proxy.on("proxyRes", (proxyRes, req, res) => {
              const is206Attachment =
                proxyRes.statusCode === 206 &&
                req.url?.startsWith("/api/attachments");

              if (is206Attachment) {
                // ── Buffer the full 206 body to set exact Content-Length ──
                const chunks: Buffer[] = [];
                proxyRes.on("data", (chunk: Buffer) => chunks.push(chunk));
                proxyRes.on("end", () => {
                  const body = Buffer.concat(chunks);

                  // Copy upstream headers
                  for (const [key, value] of Object.entries(proxyRes.headers)) {
                    if (value !== undefined) {
                      res.setHeader(key, value as string | string[]);
                    }
                  }

                  // Fix: chunked → fixed-length
                  res.removeHeader("transfer-encoding");
                  res.setHeader("content-length", String(body.length));

                  // Allow cross-origin access from Tauri's custom origin
                  res.setHeader("access-control-allow-origin", "*");
                  res.setHeader("access-control-expose-headers", "Content-Range, Content-Length, Accept-Ranges");

                  res.writeHead(206);
                  res.end(body);
                });
              } else {
                // ── All other responses: copy headers and pipe through ────
                for (const [key, value] of Object.entries(proxyRes.headers)) {
                  if (value !== undefined) {
                    res.setHeader(key, value as string | string[]);
                  }
                }

                // Allow cross-origin access from Tauri's custom origin
                res.setHeader("access-control-allow-origin", "*");

                res.writeHead(proxyRes.statusCode || 200);
                proxyRes.pipe(res);
              }
            });
          },
        },
        "/ws": {
          target: baseWsUrl,
          ws: true,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: "dist/client",
      emptyOutDir: true,
    },
    define: {
      __IS_MOBILE__: false,
      __IS_DESKTOP__: true,
    },
  };
});
