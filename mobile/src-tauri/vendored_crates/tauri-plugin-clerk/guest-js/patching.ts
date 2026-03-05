// No-op module — fetch patching is handled by the pre-module-load
// interceptor (patch-mobile-fetch.ts) which must run before @clerk/clerk-js
// captures globalThis.fetch. That interceptor routes Clerk FAPI calls
// through the Rust-side fapi_proxy command, avoiding Origin injection.
//
// This module is kept because index.ts imports applyGlobalPatches().

export const applyGlobalPatches = (): void => {
  // intentionally empty
};
