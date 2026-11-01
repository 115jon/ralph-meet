# Mobile backlog

The working list for `apps/mobile`. Items move to **Done** with their PR.
Source: the mobile parity/UX audit (2026-11-01), approved mockups, and bugs
found on real phones. Design calls already made are noted so they aren't
reopened.

## Bugs

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

- [ ] Nothing in flight.

## Next

- [ ] Call screen follow-ups (deferred from the upgrades): swipe up on the
      filmstrip to open the chat drawer; the keyboard dropping a staged share
      into the filmstrip; soundboard favorites (add/remove) and MyInstants
      search; "Mute and deafen sounds" and "People in this call" in the call
      settings sheet; the web's "only hear a share's audio while it is
      focused" rule (the phone plays share audio at its stream volume).

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

- [ ] Per-user volume and Mute for me on someone else's voice (0–200%,
      react-native-webrtc track gain; above 100% saturates), hearing another
      person's soundboard clip, join/leave tones from someone else joining.

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
- Call screen upgrades (mockup `calls.html` 03–04, all A): long-press a
  tile for the person sheet (volume 0–200% with stream volume, mute for me,
  mute their soundboard, profile, Message; your own tile: mic and camera),
  chat drawer over the call, soundboard sheet (favorites, server clips,
  defaults; plays for everyone, long-press previews), call settings with
  join/leave tones (also in Settings › Calls) and mute all soundboards,
  pinch/double-tap zoom on a staged video with readout, minimap and Fit,
  picture-in-picture with Mute and Leave while video is on screen only,
  call-screen-only rotation with a full-bleed landscape stage.
- Fixes: with no conversation open the drawer fills the screen (no empty chat
  peek, no swipe to it); a conversation that disappears closes cleanly.
  Sheets drag: down to close (the scrim fades with it), long ones up to
  full height, the list handing its top edge to the sheet.
- DM calls with ringing (mockup `calls.html` 01–02, all A): call key +
  confirm, Calling region in the DM, native ringing over the lock screen,
  heads-up and in-app sheet, Answer/Decline from the notification, missed
  calls, call records (#131).
