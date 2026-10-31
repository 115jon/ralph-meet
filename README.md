# Ralph Meet

Ralph Meet is an open-source real-time communication application for chat,
voice, video, screen sharing, and user-authorized game capture.

[Web app](https://meet.115jon.site) ·
[Windows releases](https://github.com/115jon/ralph-meet/releases) ·
[Source repository](https://github.com/115jon/ralph-meet)

## Highlights

- Chat, voice, video, screen sharing, and room-based collaboration.
- A Windows desktop client built with Tauri and a custom CEF/Chromium
  runtime.
- Optional game capture using a separately licensed OBS Studio `win-capture`-
  derived component.
- Cloudflare-backed realtime services with a web client and desktop client.

## Getting started

Open the [web app](https://meet.115jon.site), or download the latest Windows
installer from the [GitHub Releases page](https://github.com/115jon/ralph-meet/releases).

Release notes and version history are kept in [CHANGELOG.md](CHANGELOG.md).

## Desktop release contents

The desktop client includes a custom CEF/Chromium runtime and an in-repository
Tauri fork. The optional capture feature ships separately built
OBS-derived hook and helper binaries. Their source, attribution, license text,
and written source offer are documented in
[`desktop/src-tauri/resources/obs-capture`](desktop/src-tauri/resources/obs-capture)
and [desktop third-party notices](desktop/THIRD_PARTY_LICENSES.md).

The capture component injects a graphics hook into a user-selected game process
to capture that process. It is not a security scanner, exploit tool, or bypass
tool.

## Documentation and policies

- [Privacy Policy](PRIVACY.md)
- [Code Signing Policy](CODE_SIGNING_POLICY.md)
- [Security Policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Desktop third-party notices](desktop/THIRD_PARTY_LICENSES.md)

## Development

Install dependencies with the repository's pinned package manager and run the
available validation commands:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

Formatting is `oxfmt`, linting is `oxlint` (config in `oxlint.config.ts`, with the
vendored anti-slop rules under `tools/oxlint/anti-slop`), and `lefthook` runs
format, lint and typecheck on commit. `pnpm format` rewrites files, `pnpm lint:fix`
applies safe lint fixes.

`pnpm perf` builds and runs Lighthouse CI against `vite preview` (config in
`lighthouserc.cjs`, reports in `.lighthouseci/reports`). Set
`LHCI_KOVA_SESSION_TOKEN` to include the signed-in chat shell.

### Local sign-in (Kova app)

`pnpm dev` signs in with the **Ralph Meet (dev)** Kova app. `pnpm dev:prod-auth`
signs in with the live **Ralph Meet** app instead, on port 5199. The startup log
prints one `[ralph] Kova sign-in: …` line naming the app in use.

`RALPH_AUTH=dev|prod` (default `dev`) is read by `vite.config.ts` in `vite dev`
only. It takes the matching publishable key from `wrangler.toml` (dev:
`[env.mobile-dev.vars]`, prod: top-level `[vars]`) and gives the browser and the
local worker the same value, so they cannot disagree. That value beats
`VITE_KOVA_AUTH_PUBLISHABLE_KEY` in `.env.local` and `.dev.vars`, so you don't
need to set it there. `vite build` and deploys ignore `RALPH_AUTH` and keep the
live key from `[vars]`.

Prod sign-in only works from an origin listed on the live Kova app (its
`allowed_origins` and `redirect_uris`). Localhost is not listed by default.

### Deploying the web app

Pushes to `main` deploy through the **Deploy web** workflow: build, a Worker
Preview named `main`, a smoke test, then production with an automatic rollback
if the production smoke test fails. Production steps run only while the
repository variable `WEB_DEPLOY_ENABLED` is `true`. `pnpm deploy:main` remains
the manual fallback. See [docs/deploy.md](docs/deploy.md) for the steps,
rollbacks, Preview resources and required settings.

Do not use locally built desktop or CEF artifacts as release-signing inputs.
Release provenance must be verified by the repository's release workflow.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Changes
to installer behavior, release workflows, signing configuration,
authentication, CEF provenance, policies, or game capture require maintainer
review.

## License

Ralph Meet-owned source is distributed under the GNU General Public License,
version 3 or later (`GPL-3.0-or-later`). The OBS-derived capture component
remains separately licensed under GPL-2.0-only. The canonical root license is
in [LICENSE](LICENSE).
