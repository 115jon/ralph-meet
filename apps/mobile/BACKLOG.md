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
- [ ] After the network drops and comes back (emulator airplane toggle,
      even 4 s), no socket reconnects: chat, room and voice all wait on
      ticket requests that never answer, and wake does nothing. RN's HTTP
      client has no timeouts and keeps the dead pooled connection; a 10 s
      ticket timeout alone did not help (every retry stalls the same way).
      `@ralph/realtime` has no timeout on its ticket phase either. Check on a
      real phone (a real network change may reset the connection). Its own
      follow-up PR.
- [ ] Reconnect grace does not protect audio (web and mobile): after a
      remote person's voice socket reconnects, the server follows their
      `ClientDisconnect` with `StopTracks` for all their tracks, so viewers
      close the audio pull and pull it again (about 1.2 s of silence). The
      grace only keeps them in the roster. Its own follow-up PR.

## In progress

- [ ] Nothing in flight.

## Next

- [ ] Call screen follow-ups (deferred from the upgrades): swipe up on the
      filmstrip to open the chat drawer; the keyboard dropping a staged share
      into the filmstrip; soundboard favorites (add/remove) and MyInstants
      search; "Mute and deafen sounds" and "People in this call" in the call
      settings sheet; the web's "only hear a share's audio while it is
      focused" rule (the phone plays share audio at its stream volume).

- [ ] iOS video keepalive: iOS has no black-frame source yet
      (`VideoKeepalivePool.supported` is Android only), so camera or share
      off on an iPhone closes the publication, and a web Chrome viewer
      pulling the next one can hit the SFU's recycled-MID failure (no video
      until they rejoin). Add a native iOS keepalive source.

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
- [ ] Receiving camera and screen share on a real phone (checked on the
      emulator against a web peer: camera layers, kept pulls, re-watch).
- [ ] Hearing each other's microphone with real audio (the emulator mic is
      silent; checked that packets flow both ways and web audio plays).
- [ ] Soft-keyboard handling (composer, picker slot, custom status field).
- [ ] Haptics feel; pager smoothness on a release build.

## Done

- Voice on the shared packages: `@ralph/voice` (session phase and one
  teardown, publication reconciler, screen share, reconnect grace) and
  `@ralph/voice-media` (the web's PartyTracks media manager and transport);
  the app's own copies are gone. Camera and share off keep their SFU track
  on a native black-frame keepalive on Android, so viewers see them come
  back (not on iOS yet: there it closes the publication, see Next). Remote
  video stays pulled once watched while the app is in front (no re-pull
  after the call screen hides), and web cameras are pulled at the layer the
  tile needs; in the background (outside PiP) every video pull closes and
  its own PartyTracks session goes, and coming back pulls on a new one. A
  leave sends `ClientDisconnect` in the same turn as the call service stops
  (no send window on a phone). Joining from the channel list watches video
  again (the call screen's watch flag was dropped before the session
  started, so no video was pulled until the screen was reopened). No 30 s presence re-send and no chat-socket
  mute mirror.
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
- Fixes: sheets now use `@lodev09/react-native-true-sheet` (native Android
  BottomSheetBehavior): one `Sheet` for every bottom sheet, including the
  other-user profile and the incoming-call ring; the hand-rolled pan,
  springs and scroll hand-off (`sheet-scroll.ts`) are gone.
- DM calls with ringing (mockup `calls.html` 01–02, all A): call key +
  confirm, Calling region in the DM, native ringing over the lock screen,
  heads-up and in-app sheet, Answer/Decline from the notification, missed
  calls, call records (#131).
