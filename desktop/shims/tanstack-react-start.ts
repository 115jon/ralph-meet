/**
 * Shim for `@tanstack/react-start` in the desktop SPA build.
 *
 * The web app's route files (e.g., chat.tsx) import `createServerFn`
 * from this module. In the desktop SPA, server functions are never
 * executed — the desktop uses token-based auth instead. This shim
 * provides a no-op stub so the module resolves without errors.
 */
import { clog } from "@/lib/console-logger";

const log = clog("Desktop Shim");

export function createServerFn() {
  const builder = {
    inputValidator() {
      return builder;
    },
    handler(_fn: (...args: any[]) => any) {
      // In desktop SPA mode, server functions are never called.
      // If invoked, they log a warning and throw.
      return async (..._args: any[]) => {
        log.warn("createServerFn called — this is a no-op in desktop mode");
        throw new Error("Server functions are not available in desktop mode");
      };
    },
  };

  return builder;
}

// Re-export any other used items as no-ops
export function createMiddleware() {
  return { server: createServerFn };
}
