/**
 * Client-side shim for `cloudflare:workers`.
 *
 * TanStack Router's auto-generated route tree imports all route files
 * (including server-only API routes) in the client environment.
 * The Cloudflare Vite plugin only resolves `cloudflare:workers` in
 * the SSR/worker environment, so this shim provides a no-op `env`
 * object for the client side to prevent import failures.
 *
 * The actual `cloudflare:workers` module is used at runtime on the server.
 */
export const env: Record<string, any> = {};
