import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import path from "path";
import { defineConfig, type Plugin } from "vite";
import killerInstincts from "vite-plugin-killer-instincts";
import { unstable_readConfig } from "wrangler";
import { prefetchManifest } from "./tools/vite/prefetch-manifest";
import {
  describeDevAuth,
  resolveDevAuthTarget,
  selectDevAuthKey,
} from "./src/lib/dev-auth-target";

const shimDir = path.resolve(import.meta.dirname, "src/shims");
const usePolling = process.env.VITE_USE_POLLING === "true";
const pollingInterval = Number(process.env.VITE_POLLING_INTERVAL ?? "1000");
const ignoredWatchPaths = [
  "**/.git/**",
  "**/.wrangler/**",
  "**/.vite/**",
  "**/.tanstack/**",
  "**/.vinxi/**",
  "**/coverage/**",
  "**/dist/**",
  "**/target/**",
  "**/target-test/**",
  "**/node_modules/**",
  "**/__tests__/**",
  "**/*.test.*",
  "**/*.spec.*",
  "**/*.gz",
  "**/*.log",
  "**/desktop/**",
  "**/mobile/**",
  "**/.codex-logs/**",
];

/**
 * Map of modules that only exist in the desktop/worker environment
 * to their client-side no-op shims.
 */
const tauriShims: Record<string, string> = {
  "@tauri-apps/plugin-shell": path.resolve(shimDir, "tauri-plugin-shell.ts"),
  "@tauri-apps/plugin-updater": path.resolve(
    shimDir,
    "tauri-plugin-updater.ts",
  ),
  "@tauri-apps/plugin-process": path.resolve(
    shimDir,
    "tauri-plugin-process.ts",
  ),
  "@tauri-apps/plugin-autostart": path.resolve(
    shimDir,
    "tauri-plugin-autostart.ts",
  ),
  "@tauri-apps/plugin-notification": path.resolve(
    shimDir,
    "tauri-plugin-notification.ts",
  ),
  "tauri-plugin-status-bar-color-api": path.resolve(
    shimDir,
    "tauri-plugin-status-bar-color-api.ts",
  ),
};

function clientEnvironmentShims(): Plugin {
  return {
    name: "client-environment-shims",
    configResolved(config) {
      const tanstackServerDependencies = [
        "@tanstack/react-start/server",
        "@tanstack/react-start-server",
        "@tanstack/start-server-core",
      ];

      for (const environment of Object.values(config.environments)) {
        if (environment.consumer !== "server") continue;
        environment.optimizeDeps.exclude = [
          ...new Set([
            ...(environment.optimizeDeps.exclude ?? []),
            ...tanstackServerDependencies,
          ]),
        ];
      }
    },
    resolveId(id) {
      // 1. Shim cloudflare:workers ONLY in the client environment
      if (this.environment?.name === "client" && id === "cloudflare:workers") {
        return path.resolve(shimDir, "cloudflare-workers.ts");
      }

      // 2. Shim Tauri plugins in BOTH client and SSR environments
      // ONLY if we are NOT running inside Tauri.
      // because Tauri is never available in web/Cloudflare runtime.
      if (!process.env.TAURI_ENV_PLATFORM && id in tauriShims) {
        return tauriShims[id];
      }
    },
  };
}

/**
 * Local dev sign-in (`vite dev` only): RALPH_AUTH=dev (default) or prod
 * picks the Kova app, and its key reaches the client and the worker as one
 * compile-time constant, `import.meta.env.RALPH_DEV_KOVA_KEY`, read first on
 * both sides. A define beats .env.local (client) and .dev.vars / .env
 * (worker), which would otherwise override wrangler vars independently.
 * The worker's `VITE_KOVA_AUTH_PUBLISHABLE_KEY` var is set to the same key
 * too, but a .dev.vars entry still wins there, so code must read the define.
 * `vite build` skips all of this: production keeps wrangler.toml's [vars].
 */
let devAuthLogged = false;
function devAuthKey(): string {
  const target = resolveDevAuthTarget(process.env.RALPH_AUTH);
  const configPath = path.resolve(import.meta.dirname, "wrangler.toml");
  const read = (env?: string) =>
    unstable_readConfig({ config: configPath, env }, { hideWarnings: true })
      .vars?.VITE_KOVA_AUTH_PUBLISHABLE_KEY;
  const key = selectDevAuthKey(target, {
    dev: target === "dev" ? read("mobile-dev") : undefined,
    prod: target === "prod" ? read() : undefined,
  });
  if (!devAuthLogged) {
    devAuthLogged = true;
    console.info(describeDevAuth(target));
  }
  return key;
}

export default defineConfig(({ command, isPreview }) => {
  const kovaKey = command === "serve" && !isPreview ? devAuthKey() : null;
  return {
    define: kovaKey
      ? { "import.meta.env.RALPH_DEV_KOVA_KEY": JSON.stringify(kovaKey) }
      : undefined,
    server: {
      host: "0.0.0.0",
      strictPort: true,
      cors: {
        origin: ["http://tauri.localhost", "https://tauri.localhost"],
        credentials: true,
      },
      hmr: {
        protocol: "ws",
        host: "localhost",
      },
      watch: {
        usePolling,
        interval: usePolling ? pollingInterval : undefined,
        // Polling is much slower on large Windows workspaces; keep it opt-in.
        ignored: ignoredWatchPaths,
      },
      fs: {
        strict: false,
      },
    },
    build: {
      // Never inline fonts as data: URLs: the document CSP's font-src is
      // 'self' + Google Fonts, so inlined @fontsource subsets (Fredoka,
      // Press Start 2P) were blocked. Other assets keep the default limit.
      assetsInlineLimit: (filePath: string) =>
        /\.(?:woff2?|ttf|otf|eot)(?:$|\?)/i.test(filePath) ? false : undefined,
    },
    plugins: [
      killerInstincts({ autoKill: true }),
      tanstackStart({
        srcDirectory: "src",
        router: {
          routesDirectory: "routes",
          generatedRouteTree: "routeTree.gen.ts",
        },
      }),
      cloudflare({
        config:
          command === "serve"
            ? {
                ...(kovaKey
                  ? { vars: { VITE_KOVA_AUTH_PUBLISHABLE_KEY: kovaKey } }
                  : {}),
                migrations: [
                  {
                    tag: "v1-local",
                    new_sqlite_classes: [
                      "RootMeetingRoom",
                      "RootVoiceRoom",
                      "RootRateLimiterDO",
                    ],
                  },
                ],
              }
            : undefined,
        viteEnvironment: { name: "ssr" },
      }),
      clientEnvironmentShims(),
      // Chunks to fetch at idle after load, by what the visitor does next
      // (read by src/lib/prefetch.ts; see docs/performance.md).
      prefetchManifest({
        chat: ["src/routes/chat.tsx?tsr-split"],
        "sign-in": ["src/routes/sign-in.tsx?tsr-split"],
        room: ["src/routes/room.$slug.tsx?tsr-split"],
        "room-voice": ["src/components/RoomVoiceView.tsx"],
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
  };
});
