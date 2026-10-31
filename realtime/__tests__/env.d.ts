// `env` from "cloudflare:workers" is typed as `Cloudflare.Env`. The test
// worker's bindings come from wrangler.test.toml and the CI-only .dev.vars,
// so the secrets the tests read are declared here.
declare global {
  namespace Cloudflare {
    interface Env {
      CALLS_APP_SECRET: string;
      REALTIME_TICKET_SECRET: string;
    }
  }
}

export {};
