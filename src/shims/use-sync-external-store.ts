// ESM shim — re-exports useSyncExternalStore from React (built-in since React 18).
// This avoids CJS/ESM interop issues with the `use-sync-external-store` npm package
// when running inside Cloudflare's workerd runtime via the Vite plugin.
export { useSyncExternalStore } from "react";
