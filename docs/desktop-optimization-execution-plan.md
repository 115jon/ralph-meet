# Desktop Optimization Execution Plan

Date: May 19, 2026

## Completed In This Pass

### Shared Media Device Snapshot

The desktop audio picker and local media acquisition now use one shared snapshot helper:

- `src/lib/media-device-snapshot.ts`
- `src/lib/useMediaDevices.ts`
- `src/lib/local-media-manager.ts`

This removes duplicated device enumeration, native label merging, and CEF retry logic. The device picker and post-`getUserMedia` refresh path now receive the same resolved audio inputs, audio outputs, video inputs, and native device metadata.

### Startup Request Coalescing

The API client now coalesces duplicate in-flight GET requests and desktop token refreshes:

- `apiGet()` deduplicates identical concurrent GETs that do not carry an abort signal.
- 401 token refresh recovery shares a single in-flight desktop token refresh across concurrent failed requests.

This targets the startup fan-out seen in desktop logs, where `users/me`, `servers`, `notifications`, `presence`, `read-states`, `dms`, and `friends` can all race during auth/bootstrap.

### Chat Shell Code Splitting

The chat shell now lazy-loads heavier surfaces that are not required for the first usable chat layout:

- `VoiceChannelView`
- `CallVoiceManager`
- `IncomingCallModal`
- `InviteModal`
- `ServerSettingsModal`
- `UserProfileModal`
- `AudioInteractionModal`

The Vite client build now emits separate chunks for those surfaces. In the verification build, `ChatPageClient` dropped from roughly `543 kB` to `479 kB` minified while voice/settings/call surfaces moved into demand-loaded chunks.

## Next Implementation Slices

### Bootstrap Orchestrator

Create a single desktop bootstrap action that loads account, servers, DMs, friends, notifications, presence, and read states in a controlled order. Today, several components/stores can trigger these independently.

Acceptance criteria:

- One explicit bootstrap entry point.
- Critical account/session state loads before secondary notification/presence work.
- Noncritical startup work is deferred until the first usable chat shell render.
- Bootstrap logs show one request per resource unless explicitly refreshed.

### Screen Share Controller

Create one screen-share controller API for start, stop, change source, change quality, and toggle audio. Route the voice dashboard, context menus, room view, DM call view, and stream controls through that single surface.

Acceptance criteria:

- Changing quality preserves source and audio settings.
- Toggling audio preserves source and quality.
- Changing source preserves quality unless the picker explicitly changes it.
- Runtime logs report selected source ID, capture ID, effective track settings, and sender encoding.

### Lazy Remaining Screen Modules

Continue splitting heavy screen-share surfaces from the initial chat shell.

Acceptance criteria:

- Screen picker modal is lazy-loaded.
- Desktop capture UI is lazy-loaded where possible.
- Main chat startup does not eagerly load screen-share picker code.
- Chunk boundaries are visible in the Vite build output.

### Desktop Runtime ADR

Document the CEF fork patches and supported desktop runtime contract.

Acceptance criteria:

- The media permission patch is documented with the exact reason it exists.
- DevTools/remote-debugging usage is dev-only and documented.
- The native audio command and Tauri ACL permissions are listed.
- Known CEF limitations around device IDs and screen capture are recorded.
