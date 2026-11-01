# Mobile backlog

The working list for `apps/mobile`. Items move to **Done** with their PR.
Source: the mobile parity/UX audit (2026-11-01), approved mockups, and bugs
found on real phones. Design calls already made are noted so they aren't
reopened.

## Bugs

- [ ] **Empty chat peek clipped** — with no conversation open, the drawer
      still leaves the 16% chat peek, so "Pick a conversation" shows cut off
      at the right edge. With nothing open the drawer should be full width
      (no peek, no swipe to an empty chat). Found on a phone, v0.3.0.
- [ ] Underline / strikethrough sometimes don't draw on first mount (appears
      to be RN 0.88 text drawing; needs a minimal repro + upstream report).
- [ ] Push tap from a killed app opened the wrong channel in the dev build
      (dev launcher drops the link) — confirm on a release build.
- [ ] Your own avatar is missing in notification replies (shows a "Y").
- [ ] Two call notification channels ("Calls" and "Voice calls") — merge or
      rename.
- [ ] Jumping to an uncached message briefly flashes the loading skeleton.
- [ ] Device-code approval page says "DESKTOP SIGN-IN" for the Android app
      (web copy).

## In progress

- [ ] **DM calls with ringing** (mockup `calls.html` 01–02, all A): call key + confirm in the DM header, "Calling…" region inside the DM, ringing
      screen over the lock screen + heads-up CallStyle + in-app sheet,
      Answer/Decline from the notification, missed-call row and notification.
      Server: ring push for backgrounded phones, accept/decline endpoints,
      call outcome messages.

## Next

- [ ] **Call screen upgrades** (mockup `calls.html` 03–04, all A): per-user
      volume sheet (0–200%, mute for me, mute their soundboard), chat drawer
      over the call, soundboard sheet, join/leave tones toggle, pinch zoom on
      screen shares, picture-in-picture for video/share only, full-bleed
      landscape for shares.

## Later (from the audit)

- [ ] Pins and search.
- [ ] Notification settings per server/channel (mute, mentions only).
- [ ] Profile editing on mobile: avatar, banner, bio, pronouns.
- [ ] Bundle the web's display-name fonts; play avatar decorations exactly
      once (expo-image limits).
- [ ] Revoke invites from the app; join flow tested end to end.
- [ ] Server admin basics: create/join server, channel create/edit/order.
- [ ] Offline cache so launches don't wait on the network.
- [ ] Predictive back animation (needs native work).
- [ ] Tablet / landscape layout outside calls.
- [ ] Listen-together, activities, collectibles shop (web-only today).
- [ ] Server-side: per-server custom emoji, group DMs, user search.
- [ ] Play Store readiness (media permissions policy, store listing).
- [ ] iOS.

## Needs a real phone or a second person

- [ ] Two-person voice: hearing each other, speaking LEDs, deafen.
- [ ] Bluetooth and earpiece routing.
- [ ] Receiving camera and screen share.
- [ ] Soft-keyboard handling (composer, picker slot, custom status field).
- [ ] Haptics feel; pager smoothness on a release build.

## Done

- Scaffold, sign-in, servers/tree/chat, composer/DMs/activity, voice,
  background calls, video viewing/settings, push, signed releases (v0.1.0).
- Rail + your panel, animated media, camera + screen share, attach tray
  (v0.2.0).
- Markdown, swipe pager + gestures, emoji/GIF pickers, members/profile/
  friends, in-app links/invites/share-to-app, native notifications (v0.3.0).
