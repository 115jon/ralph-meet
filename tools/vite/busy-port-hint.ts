import { createConnection } from "node:net";
import type { Plugin, ViteDevServer } from "vite";

/**
 * Prints `message(port)` when the dev server's port is taken. With
 * `strictPort`, Vite only says "Port N is already in use", which does not
 * tell anyone how to run on another port.
 *
 * vite-plugin-killer-instincts fails before Vite listens, so this probes the
 * port itself and must come before that plugin. The listen error is the
 * fallback for configs without it.
 */
export function busyPortHint(message: (port: number) => string): Plugin {
  let shown = false;
  const show = (server: ViteDevServer) => {
    if (shown) return;
    shown = true;
    server.config.logger.error(message(server.config.server.port ?? 0));
  };

  return {
    name: "ralph-busy-port-hint",
    apply: "serve",
    async configureServer(server) {
      server.httpServer?.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") show(server);
      });
      const { port, strictPort } = server.config.server;
      if (strictPort && port && (await isPortTaken(port))) show(server);
    },
  };
}

function isPortTaken(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}
