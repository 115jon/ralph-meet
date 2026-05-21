# Desktop Audit Task Tracker

Last updated: May 21, 2026

## Already Done

- Shared media device snapshot is in place.
  - `src/lib/media-device-snapshot.ts`
  - `src/lib/useMediaDevices.ts`
  - `src/lib/local-media-manager.ts`
- Startup request coalescing is in place for duplicate GETs and desktop token refresh.
  - `src/lib/api-client.ts`
- Chat shell code splitting is in place for the heaviest always-available surfaces.
  - `src/components/chat/ChatPageClient.tsx`

## Already Partially Addressed

- Screen-share modal lazy loading.
  - Done in `src/components/chat/UserPanel.tsx`
  - Done in `src/components/chat/VoiceChannelView.tsx`
  - Done in `src/components/RoomPageClient.tsx`
  - Done in `src/components/chat/DMCallRegion.tsx`
- Bootstrap gating on desktop auth exists.
  - `src/components/chat/useChatPageLogic.ts` waits for `desktopReady`
  - This is not yet the full bootstrap orchestrator described in the audit
- Desktop settings ACL commands exist and are wired.
  - `desktop/src-tauri/src/lib.rs`
  - `desktop/src-tauri/permissions/desktop-commands.toml`

## Still Open

### 1. Authoritative screen-share source IDs

Goal: stop guessing `chromeMediaSourceId` values for picked screens/windows.

Why it matters:
- Current picker IDs are still inferred from `xcap` output.
- Fullscreen app capture can still fall back to a broader desktop source.

Next steps:
- Make the picker return the exact capture ID CEF expects.
- Add visible verification logs for selected source, capture ID, and applied track settings.

### 2. Remove or quarantine stale native screen share

Goal: keep one supported desktop capture path.

Next steps:
- Decide whether `desktop/src-tauri/src/native_share.rs` stays experimental or is removed.
- If kept, feature-flag it off the default app path.

### 3. Centralize screen-share controls

Goal: make start/stop/change source/change quality/toggle audio all flow through one controller.

Partially covered already:
- Voice dashboard and channel view now use the same modal boundary.

Still open:
- `src/components/RoomPageClient.tsx`
- `src/components/chat/DMCallRegion.tsx`
- `src/components/ContextMenu/LocalMenu.tsx`
- `src/components/StreamContextMenu.tsx`

### 4. Verify quality updates at runtime

Goal: confirm requested quality is actually applied.

Next steps:
- Log `track.getSettings()` and sender params after quality changes.
- Surface a lightweight diagnostic when the requested quality is capped.

### 5. Fix updater metadata verification

Goal: stop the update checker from failing silently on invalid release JSON.

Next steps:
- Validate `latest.json` in CI.
- Confirm the release artifact format matches the desktop updater.

### 6. Move remote debugging to dev-only config

Goal: keep `--remote-debugging-port=9222` out of production config.

### 7. Simplify desktop auth lifecycle

Goal: replace polling-heavy sync with a clearer desktop session state machine.

### 8. Extract and test the Vite proxy media behavior

Goal: preserve attachment range handling across Vite upgrades.

### 9. Document the CEF runtime contract

Goal: capture the fork, setup, and known desktop limitations in one place.

## Safe Next Slice

The next lowest-risk code slice is likely `RoomPageClient` and `DMCallRegion` lazy loading for the shared screen-share modal, because the shared modal boundary is already established in the other entry points.

## Notes

- This tracker intentionally separates "already done" from "still open" so we do not repeat work.
- The audit document remains the canonical risk register; this file is the execution checklist.
