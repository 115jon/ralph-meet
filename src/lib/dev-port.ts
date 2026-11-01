/**
 * Local dev-server ports (`vite dev` only).
 *
 * The web dev server (root vite.config.ts) listens on 5173 unless
 * `RALPH_DEV_PORT` says otherwise. The desktop dev server
 * (desktop/vite.config.ts) always listens on 1420, because that port is the
 * `devUrl` in desktop/src-tauri/tauri.conf.json. Its `/api` and `/ws` proxy
 * targets the web dev server, so it reads `RALPH_DEV_PORT` too.
 *
 * Both servers use `strictPort`. The "Ralph Meet (dev)" Kova app only accepts
 * http://localhost:5173, http://127.0.0.1:5173 and http://localhost:1420 as
 * origins, so a server that quietly moved to the next free port would load
 * fine and then fail every sign-in.
 *
 * Pure, so the parsing and messages are unit tested
 * (`__tests__/dev-port.test.ts`).
 */

export const DEFAULT_WEB_DEV_PORT = 5173;
export const DESKTOP_DEV_PORT = 1420;

/** `RALPH_DEV_PORT` to a port: unset or blank is 5173; anything invalid throws. */
export function resolveWebDevPort(raw: string | undefined): number {
  const value = (raw ?? "").trim();
  if (value === "") return DEFAULT_WEB_DEV_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `RALPH_DEV_PORT must be a port number from 1 to 65535 (got ${JSON.stringify(raw)}).`,
    );
  }
  return port;
}

/** The startup error when a dev server's port is taken. */
export function describeBusyDevPort(
  server: "web" | "desktop",
  port: number,
): string {
  if (server === "desktop") {
    return (
      `[ralph] Port ${port} is already in use. Tauri dev needs exactly ` +
      `${DESKTOP_DEV_PORT}: it is the devUrl in desktop/src-tauri/tauri.conf.json ` +
      `and an allowed origin of the Kova dev app. Stop the process using it.`
    );
  }
  const next = port === 65535 ? port - 1 : port + 1;
  const signIn =
    port === DEFAULT_WEB_DEV_PORT
      ? `Kova sign-in only works on ${DEFAULT_WEB_DEV_PORT}, so on another port ` +
        `the app loads but sign-in fails.`
      : `Kova sign-in only works on ${DEFAULT_WEB_DEV_PORT}.`;
  return (
    `[ralph] Port ${port} is already in use. Stop the process using it, or ` +
    `pick another port with RALPH_DEV_PORT=${next} pnpm dev. ${signIn} ` +
    `Run desktop dev with the same RALPH_DEV_PORT so its proxy follows.`
  );
}
