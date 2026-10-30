# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A small private group of friends who game together. Someone opens a voice
channel and it stays open for hours while they play. Chat, screen share,
listen-together and the soundboard happen around that call. The people are
known to each other; there are no strangers to moderate and no onboarding
funnel to optimise.

## Product Purpose

Ralph Meet is an open-source real-time communication app: servers with text
and voice channels, direct messages and DM calls, video, screen sharing,
user-authorised game capture, listen-together, a soundboard and small
activities (Wordle, WarpRush). It exists so the group has its own place to
hang out instead of renting one. Success is a call that runs all evening
beside a game without the app getting in the way: low cost while idle, instant
when someone reaches for it.

## Positioning

A self-owned hangout for one friend group, with a Windows desktop client built
on Tauri and a custom CEF/Chromium runtime, OBS-derived game capture, and
Cloudflare-backed realtime (PartyTracks/SFU, Durable Objects). It is not a
general community platform and does not need to scale its interface for
thousands of members.

## Operating Context

- **First surface: the Windows desktop app.** It runs beside a game for
  hours, so frame cost, memory, idle CPU and GPU use matter more than anywhere
  else. The desktop shell loads the same React UI as the web app.
- The web app (TanStack Start on Cloudflare Workers) is the second surface;
  Tauri mobile and phone web are secondary.
- Typical session: join a voice channel, alt-tab into a game, come back to
  glance at chat, react, share a screen or start listen-together, leave hours
  later. Glanceability and low-friction voice controls matter more than
  discovery.

## Capabilities and Constraints

- Servers, categories, text and voice channels, roles and permissions,
  invites, threads, pins, search, command menu and quick switcher.
- Direct messages, friends, DM calls, presence.
- Voice and video through PartyTracks; noise suppression (RNNoise), VAD,
  camera backgrounds (MediaPipe), screen share with a desktop picker, game
  capture on desktop, focused stage, listen-together, soundboard.
- Rich embeds (link previews, TikTok, Instagram, YouTube), GIF and emoji
  pickers, uploads, shared-message pages.
- Profiles with collectibles from a shop (decorations, effects, nameplates,
  frames) and display-name fonts.
- Kova handles authentication, including device-code sign-in at `/activate`.
- Site hostnames come from config. The domain is moving from 115jon.site to
  115jon.com, so no new `.site` literals.
- A dev-only `/ui-fixtures` route renders real components with mocked data
  for every surface; it is the visual test bed.

## Brand Commitments

Confirmed by the user on 2026-10-27 as things the redesign must keep:

- **Phosphor icons** through the single `Icon` adapter (Bold idle, Fill
  active/off).
- **Studio settings layout**: You (Account, Sessions, Privacy), Calls (Voice &
  video, Soundboard, Keybinds), App (Appearance, Notifications, Desktop app),
  with search that lands on rows.
- **Custom themes**: Miku and Spider-Man (light and dark) alongside the
  default light and dark themes.

Not binding: the dithered art on auth, loading and empty states may be
replaced.

## Evidence on Hand

- Real screenshots of the product are produced from `/ui-fixtures`; there are
  no customer testimonials, metrics or press, and none should be invented.
- `DESIGN.md` records the current visual system (Talk Tree);
  `docs/design-audit.md` is the previous (Quiet Pro) pass, kept as history.

## Product Principles

1. **The call is the centre.** Everything is arranged around an evening-long
   voice session; voice state and controls are always one glance away.
2. **Cheap at rest.** Idle frames, timers, animations and re-renders cost the
   player's game; anything that runs continuously has to earn it.
3. **Familiar, then better.** Friends arrive with Discord habits. Keep those
   affordances where they work and improve on them where they don't.
4. **Made for this group.** Personality, themes and collectibles matter more
   than neutral enterprise polish.
