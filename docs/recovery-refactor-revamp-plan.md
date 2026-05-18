# Ralph Meet Recovery, Refactor, and Revamp Plan

Last updated: 2026-05-18

## Immediate Recovery Tasks

### 1. Restore desktop deployed-dev routing

Problem: `desktop/package.json` had `dev:deployed` running the same command as
`dev`, so the desktop Vite proxy defaulted to `http://localhost:5173`. When the
local Worker dev server was not running, every `/api` and `/ws` request failed
with `ECONNREFUSED` or `ETIMEDOUT`.

Implemented recovery:

- `npm run dev:deployed` now runs Tauri with a deployed config overlay.
- The overlay starts Vite with `--mode deployed`.
- `.env.deployed` sets `VITE_API_BASE_URL=https://meet.115jon.site`.
- `desktop/vite.config.ts` now respects `process.env.VITE_API_BASE_URL` before
  falling back to `.env` files or local dev.
- `desktop/README.md` documents the local and deployed desktop dev modes.

Follow-up tasks:

- Add a startup log in `desktop/vite.config.ts` that prints the proxy target.
- Add a preflight health check for `dev:deployed` that requests
  `https://meet.115jon.site/api/health` or the closest available endpoint.
- Add a separate `dev:local` alias if the team wants explicit local/deployed
  symmetry.

### 2. Audit restore fallout

Problem: the working tree contains valuable in-progress desktop, voice, and SFU
changes mixed with logs, backups, recovery files, and generated build metadata.
Accidental `git restore` usage makes it risky to assume current files are either
complete or disposable.

Recommended tasks:

- Preserve the current working tree before more surgery:
  `git diff > recovery/current-working-tree.patch`.
- Sort untracked files into keep, archive, and ignore buckets.
- Move useful logs into `recovery/logs/` or delete them after extracting
  findings.
- Decide whether `recovery/*.ts`, `recovery/*.rs`, and `recovery/*.toml` are
  historical snapshots or source material to reapply.
- Add ignore rules for local logs, HAR captures, `.tsbuildinfo`, and temporary
  backup files if they are not intentionally versioned.

Implemented recovery:

- Removed local logs, HAR captures, temporary recovery snapshots, and backup
  files from the working tree.
- Added ignore rules for debug logs, HAR captures, backups, and `recovery/`.
- Kept intentional source/config/doc additions visible in Git status.

### 3. Fix desktop source-specific screen share

Problem: selected application/window sharing could route through Chromium/CEF
legacy `chromeMediaSourceId` constraints before native capture, especially when
desktop audio was off. In practice this can map a requested fullscreen
application to the full desktop across both monitors.

Implemented recovery:

- Desktop window and monitor picker selections now prefer the native
  source-specific capture path.
- The picker passes `sourceKind` (`window`, `monitor`, or `device`) through the
  UI and voice layer.
- Chromium selected-source constraints are limited to non-native device capture;
  the standard system picker remains the fallback if native capture fails.

### 4. Keep desktop auth handoff on loading UI

Problem: on native auth handoff, the desktop app could briefly show the login
screen before the deep-link/session token finished resolving.

Implemented recovery:

- `DesktopLogin` now starts in a resolving state.
- While resolving, it renders the existing `SplashScreen` loading animation.
- The sign-in UI appears only after the short desktop token handoff window
  expires without a token.

## Architecture Refactors

### 1. Formalize platform boundaries

Current signs:

- Web, desktop, mobile, and Worker code share `src/` heavily.
- Desktop Vite has its own config and shims.
- `src/lib/platform.ts` centralizes URL decisions, but runtime behavior still
  depends on scattered build flags and proxy assumptions.

Tasks:

- Create `src/platform/` modules for `web`, `desktop`, `mobile`, and `worker`.
- Keep shared pure helpers in `src/shared/`.
- Make platform config a typed object with `apiOrigin`, `wsOrigin`, `publicWebOrigin`,
  and `assetOrigin`.
- Add unit tests for URL resolution in web, desktop dev local, desktop dev
  deployed, desktop production, and mobile dev.

### 2. Split chat orchestration from UI rendering

Current signs:

- `ChatPageClient.tsx` coordinates routing, modals, call flow, channel selection,
  read state, voice switching, and layout.
- `useChatPageLogic` and Zustand stores help, but page-level orchestration is
  still broad.

Tasks:

- Extract call and voice switching decisions into `useVoiceSessionGuard`.
- Extract modal state into a reducer with explicit event names.
- Move read-state and notification side effects into dedicated services/hooks.
- Keep `ChatPageClient` focused on layout composition.

### 3. Create a dedicated realtime domain layer

Current signs:

- Chat gateway, voice gateway, SFU client, and Durable Object broadcasts each
  have their own message flow.
- Reconnect behavior, read-state updates, presence, and voice continuity are
  high-risk areas.

Tasks:

- Define typed realtime events in one package/module.
- Add versioned envelopes for gateway events.
- Centralize reconnect policy, jitter, backoff, and stale-session cleanup.
- Add tests for WS outage, re-identify, duplicate message handling, and read
  state convergence.

### 4. Make Worker boundaries explicit

Current signs:

- `worker/meeting-room.ts`, `worker/voice-room.ts`, and route code all interact
  with Durable Object behavior and internal fetch calls.
- Rate limiting appears in both Worker and app-side helpers.

Tasks:

- Document the Worker topology: main app Worker, auxiliary voice Worker,
  Durable Objects, R2/assets, auth service.
- Define internal fetch contracts as typed functions instead of ad hoc URLs.
- Consolidate rate-limit semantics so app routes and Worker DOs share the same
  limits and naming.

## Performance Tasks

### 1. Reduce initial request fan-out

The log shows many requests firing repeatedly at startup:
`/api/notifications`, `/api/servers`, `/api/read-states`, `/api/dms`,
`/api/friends`, channel messages, pins, members, and presence.

Tasks:

- Add a bootstrap endpoint that returns user, servers, channels, members,
  read states, DMs, friends, presence summary, and notifications in one response.
- Use stale-while-revalidate client caching for secondary panels.
- Gate channel-specific fetches until the active server/channel is known and
  stable.
- Add request deduplication for identical in-flight API calls.

### 2. Profile render hot paths

Tasks:

- Run React Profiler on server switch, channel switch, opening DMs, receiving a
  message, and joining voice.
- Measure Zustand selectors that return arrays or derived objects.
- Memoize expensive permission and mention-count computations behind stable
  selectors.
- Ensure virtualized chat rows do not re-render for unrelated store updates.

### 3. Harden media and attachment loading

Current signs:

- Desktop Vite has custom response handling for attachment range requests.
- Asset URL helpers append auth tokens for protected attachments.

Tasks:

- Add integration tests for `206 Partial Content` attachment responses.
- Verify video seeking in desktop dev local, desktop dev deployed, and packaged
  Tauri builds.
- Move range/CORS proxy behavior into a small tested helper instead of keeping
  all logic inline in Vite config.

### 4. Voice performance and resilience

Tasks:

- Add metrics around getUserMedia time, WS handshake time, SFU join time, first
  inbound RTP, and reconnect recovery time.
- Batch voice participant state updates.
- Keep signaling reconnect separate from media teardown whenever possible.
- Add visible degraded-state UI for signaling lost but audio still active.

## UI/UX Revamps

### 1. Connection and recovery states

Problem: proxy failures currently produce noisy logs, but the app experience can
feel like a silent failure or repeated loading.

Tasks:

- Add a desktop dev banner showing the active backend origin.
- Show actionable connection states: connecting, backend unavailable,
  reconnecting, partial realtime outage, recovered.
- Include a retry button and concise failure details in dev mode.

### 2. Desktop-first ergonomics

Tasks:

- Add keyboard command coverage for server switch, channel switch, mute,
  deafen, start call, search, and settings.
- Review focus rings and modal focus traps across all dialogs.
- Add compact density settings for desktop.
- Ensure title bar, tray, notifications, updater, and deep-link flows have
  clear success and error states.

### 3. Voice room clarity

Tasks:

- Separate "viewing a voice channel" from "joined a voice channel" visually.
- Make stream, camera, and screen-share state legible at a glance.
- Add clearer affordances for switching from DM call to server voice and back.
- Persist the user's preferred voice panel layout.

### 4. Settings information architecture

Tasks:

- Group settings by Account, Voice & Video, Notifications, Appearance,
  Desktop, Privacy, and Advanced.
- Move experimental toggles into Advanced.
- Add inline validation for input device/output device issues.
- Keep destructive actions in clearly separated danger sections.

## Quality Gates

Recommended checks before merging this recovery branch:

- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `cd desktop && npm run dev:deployed`
- Browser smoke test for login, server list, channel messages, DMs, voice join,
  and attachment playback.
- Tauri smoke test for updater failure handling, deep links, tray behavior, and
  desktop auth handoff.

## Suggested Implementation Order

1. Finish recovery hygiene and ignore/archive local-only artifacts.
2. Verify `dev:deployed` against `https://meet.115jon.site`.
3. Add URL-resolution tests around `src/lib/platform.ts`.
4. Implement startup request deduplication and bootstrap consolidation.
5. Extract chat page orchestration into narrower hooks.
6. Add realtime event typing and reconnect tests.
7. Run UI pass on connection states, voice state clarity, and desktop settings.
