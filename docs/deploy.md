# Deploying the web Worker

The web app is one Cloudflare Worker, `ralph-meet` (TanStack Start built with
`@cloudflare/vite-plugin`, plus the `MEETING_ROOM`, `VOICE_ROOM` and
`RATE_LIMITER` Durable Objects). [`.github/workflows/deploy-web.yml`](../.github/workflows/deploy-web.yml)
deploys it: a Worker Preview first, then production.

## What runs when

On every push to `main`, after the CI workflow succeeds, `deploy-web` checks out
that commit and runs:

1. `pnpm run build`. Every later step uses this one build.
2. `node scripts/write-preview-config.mjs`, which writes
   `dist/server/wrangler.preview.json` (see [Durable Object migrations](#durable-object-migrations-in-previews)).
3. `node scripts/migrate-preview-d1.mjs`, which applies pending migrations to
   the preview D1 database.
4. `wrangler preview --name main`, which updates the Preview named `main`.
5. `node scripts/smoke-web.mjs <preview URL>`. If it fails, the run stops here.
6. Production, only when the [kill switch](#kill-switch) is on and the commit is
   still the tip of `main`:
   1. Record the version production is serving (`wrangler deployments list`).
   2. `wrangler d1 migrations apply ralph-chat-db --remote`.
   3. `wrangler deploy --env=""`, the same build as the Preview.
   4. `node scripts/smoke-web.mjs <production URL>`.
   5. If the deploy or that smoke test fails, `wrangler rollback` to the
      recorded version, smoke test again, and fail the run.

The job summary lists the Preview URL, the Preview deployment, the production
version before and after, and every smoke test table.

Runs share the concurrency group `deploy-web-production` and never cancel each
other. GitHub keeps only the newest waiting run, so a burst of pushes deploys the
latest one.

### Manual runs

Run **Deploy web** from the Actions tab (`workflow_dispatch`):

- `ref`: a branch, tag or SHA to build, preview and deploy. This skips the
  "tip of main" check, so it can redeploy an older commit on purpose.
- `rollback_version_id`: a Worker version id. The workflow skips the build and
  runs `wrangler rollback <id>`, then smoke tests production.
- `production_url`: optional, overrides the URL that the production smoke test
  uses.

## Kill switch

Production steps run only when the repository variable `WEB_DEPLOY_ENABLED` is
`true`. With any other value, or unset, the workflow still builds, deploys and
smoke tests the Preview, then stops before production and says why in the
summary. Manual rollbacks (`rollback_version_id`) are not gated by the switch,
so turning deploys off never takes away the way back.

```sh
gh variable set WEB_DEPLOY_ENABLED --body true    # turn production deploys on
gh variable set WEB_DEPLOY_ENABLED --body false   # turn them off
```

## Rolling back

Find the version to return to:

```sh
pnpm exec wrangler deployments list
```

Then either run the workflow with `rollback_version_id`, or roll back locally:

```sh
pnpm exec wrangler rollback <version-id> --message "why"
```

A rollback changes the Worker code and its configuration only. D1 migrations
are not reverted, so every migration must keep working with the previous
version of the code. A rollback to a version from before a Durable Object
migration may be refused; check `wrangler rollback`'s output.

## Manual deploy (fallback)

`pnpm run deploy:main` still works from a local checkout logged in with
`wrangler login`: it applies production migrations, builds and runs
`wrangler deploy --env=""`. It skips the Preview and the smoke tests, so run
`node scripts/smoke-web.mjs <production URL>` afterwards.

## Preview resources

`wrangler preview` uses only the `previews` block of `wrangler.toml`, never the
production bindings:

| Binding                                      | Preview resource                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| `DB`                                         | D1 `ralph-chat-db-preview`                                                         |
| `CACHE`                                      | KV namespace `ralph-meet-cache-preview`                                            |
| `BUCKET`                                     | R2 bucket `ralph-chat-attachments-preview`                                         |
| `BACKGROUND_TASKS`                           | Not bound: a Preview cannot consume a queue, so the Worker runs those tasks inline |
| `MEETING_ROOM`, `VOICE_ROOM`, `RATE_LIMITER` | A new Durable Object namespace per Preview                                         |

`previews.vars` copies the production vars except two. `KOVA_AUTH_URL` and
`VITE_KOVA_AUTH_URL` are left out, so the Worker falls back to
`DEFAULT_KOVA_AUTH_URL` in `src/lib/site-defaults.ts`, the same value as
production. `wrangler preview` warns that both are missing; that is expected.
`REALTIME_ALLOWED_ORIGINS` leaves out the production origin. A Preview always
accepts WebSockets from its own origin.

The Preview URL is `https://main-ralph-meet.<account subdomain>.workers.dev`.
Previews are public by default.

### What does not work in a Preview

- **Secrets.** Previews do not inherit production secrets. Until they are set,
  realtime admission, calls, TURN and GIF search fail in Previews, while pages
  and plain API reads still work. To set one for all new Previews:
  `pnpm exec wrangler preview base-config secret put <NAME>`. For an existing
  Preview: `pnpm exec wrangler preview secret put <NAME> --name main`. The names
  are listed at the top of `wrangler.toml`.
- **Background tasks.** A Queue consumer cannot target a Preview, so tasks sent
  to `BACKGROUND_TASKS` stay in the preview queue and never run.
- **Cron triggers.** They run on production only.
- **Sign-in.** It works only from origins allowed on the Kova app, and a
  Preview origin is not one of them.

### Preview D1 migrations

`wrangler.preview-migrations.toml` names the preview database for
`wrangler d1 migrations`. It must name the same database as
`[[previews.d1_databases]]` in `wrangler.toml`. The `migrations/` folder starts
at `004` and assumes the base tables exist, so on an empty database
`scripts/migrate-preview-d1.mjs` first loads `d1_schema.sql` and records every
migration file as applied. After that it only applies new migrations. Keep
`d1_schema.sql` in step with `migrations/`.

### Durable Object migrations in Previews

A Preview replays the top-level Durable Object migrations into an empty
namespace. Production's `v4-transfer-from-ralph-meet-do` step transferred the
classes in from the retired `ralph-meet-do` Worker, which no longer has them,
so the transfer fails for every new Preview (API error 10074).
`scripts/write-preview-config.mjs` writes a copy of the generated config in
which that step creates the same classes as new SQLite classes, under the same
tag. Production deploys use the unmodified `dist/server/wrangler.json`. A new
top-level migration needs no change to the script.

## Smoke test

```sh
node scripts/smoke-web.mjs <baseUrl> [--label <name>]
```

It checks that `/api/healthz` returns 200, that `/`, `/sign-in` and `/activate`
return the HTML app shell, that a hashed `/assets/*.js` from the page is served
as JavaScript, that `/api/users/me` without auth returns 401, that an unknown
invite returns a JSON 404 (a D1 query), and that `/api/gateway` without a
WebSocket upgrade returns a 4xx. Each check is retried (`SMOKE_ATTEMPTS`,
default 6, `SMOKE_RETRY_DELAY_MS`, default 5000) with a per-request timeout
(`SMOKE_TIMEOUT_MS`, default 15000). It exits 1 and prints a table when a
check fails.

## Required settings

| Kind     | Name                    | Purpose                                                                                                                                   |
| -------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Secret   | `CLOUDFLARE_API_TOKEN`  | Workers Scripts, D1, KV, R2 and Queues edit; Account Settings, User Details and Memberships read.                                         |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account.                                                                                                                   |
| Variable | `WEB_DEPLOY_ENABLED`    | Kill switch. `true` enables production steps.                                                                                             |
| Variable | `WEB_PRODUCTION_URL`    | Optional. Production base URL for the smoke test. Without it, the workflow uses `DEFAULT_PUBLIC_WEB_URL` from `src/lib/site-defaults.ts`. |

The token is passed only to the steps that call Cloudflare.
