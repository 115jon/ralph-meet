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

type ServerFnBuilder<TInput = unknown> = {
  inputValidator<TNext>(
    validator: (data: TNext) => TNext,
  ): ServerFnBuilder<TNext>;
  handler<TOutput>(
    handler: (context: { data: TInput }) => TOutput | Promise<TOutput>,
  ): (...args: unknown[]) => Promise<TOutput>;
};

export function createServerFn(_options?: {
  method?: "GET" | "POST";
}): ServerFnBuilder {
  const builder: ServerFnBuilder = {
    inputValidator<TNext>(
      _validator: (data: TNext) => TNext,
    ): ServerFnBuilder<TNext> {
      return builder as unknown as ServerFnBuilder<TNext>;
    },
    handler<TOutput>(
      _handler: (context: { data: unknown }) => TOutput | Promise<TOutput>,
    ): (...args: unknown[]) => Promise<TOutput> {
      // In mobile SPA mode, server functions are never called. If invoked,
      // log a warning and throw instead of failing while constructing routes.
      return async (..._args: unknown[]) => {
        log.warn("createServerFn called - this is a no-op in mobile mode");
        throw new Error("Server functions are not available in mobile mode");
      };
    },
  };
  return builder;
}

// Re-export any other used items as no-ops
export function createMiddleware() {
  return { server: createServerFn };
}
