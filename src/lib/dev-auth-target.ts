/**
 * Which Kova app local dev signs in with (`vite dev` only; builds and
 * deploys never read this). `RALPH_AUTH=dev` (the default) uses the
 * "Ralph Meet (dev)" app, `RALPH_AUTH=prod` the live "Ralph Meet" app.
 *
 * vite.config.ts resolves the target once, takes the matching publishable
 * key from wrangler.toml (dev: `[env.mobile-dev.vars]`, prod: top-level
 * `[vars]`) and hands that one value to both sides through
 * `import.meta.env.RALPH_DEV_KOVA_KEY`, which the client
 * (`kova-auth-config`) and the worker (`kova-auth-server`) read before
 * anything else, so .env.local or .dev.vars can no longer split them.
 *
 * Pure, so the selection is unit tested (`__tests__/dev-auth-target.test.ts`).
 */

export type DevAuthTarget = "dev" | "prod";

export const DEV_AUTH_APPS: Record<
  DevAuthTarget,
  { id: string; name: string; keyPrefix: string }
> = {
  dev: {
    id: "app_05dda12b6492",
    name: "Ralph Meet (dev)",
    keyPrefix: "pk_dev_",
  },
  prod: { id: "app_2db95e2369dd", name: "Ralph Meet", keyPrefix: "pk_live_" },
};

/** `RALPH_AUTH` to a target: unset or blank is `dev`; anything unknown throws. */
export function resolveDevAuthTarget(raw: string | undefined): DevAuthTarget {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "" || value === "dev" || value === "development") return "dev";
  if (value === "prod" || value === "production" || value === "live")
    return "prod";
  throw new Error(
    `RALPH_AUTH must be "dev" or "prod" (got ${JSON.stringify(raw)}).`,
  );
}

/**
 * The key for `target`, from the two wrangler var sets. Throws when it is
 * missing or carries the other app's prefix, so a wrong wrangler.toml edit
 * fails at startup instead of 401ing every request.
 */
export function selectDevAuthKey(
  target: DevAuthTarget,
  vars: { dev?: unknown; prod?: unknown },
): string {
  const key = vars[target];
  const app = DEV_AUTH_APPS[target];
  if (typeof key !== "string" || key === "") {
    throw new Error(
      `No Kova publishable key for RALPH_AUTH=${target} in wrangler.toml ` +
        (target === "dev" ? "[env.mobile-dev.vars]" : "[vars]") +
        ".",
    );
  }
  if (!key.startsWith(app.keyPrefix)) {
    throw new Error(
      `The RALPH_AUTH=${target} key in wrangler.toml is not a ${app.keyPrefix}* key.`,
    );
  }
  return key;
}

/** The one startup line: which app, never the key. */
export function describeDevAuth(target: DevAuthTarget): string {
  const app = DEV_AUTH_APPS[target];
  const toggle =
    target === "dev"
      ? "pnpm dev:prod-auth for the live app"
      : "pnpm dev for the dev app";
  return `[ralph] Kova sign-in: ${app.name} (${app.id}), RALPH_AUTH=${target}; ${toggle}`;
}
