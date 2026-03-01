// Type declaration for the cloudflare:workers virtual module
// This module is available at runtime inside workerd but has no npm package.
// See: https://developers.cloudflare.com/workers/runtime-apis/nodejs/

declare module "cloudflare:workers" {
  const env: CloudflareEnv;
  export { env };
}
