# Ralph Meet design audit (Quiet Pro, 2026-10-23)

Per-view audit of every reachable surface against `docs/design-system.md`.
Rules are cited by section number (for example "9.3" = hover only on fine
pointers). Nothing in this document changes code; it is the work list.

Branch state when audited: `ui/quiet-pro` after the merges of `ui/drawer`
(Base UI Drawer), `ui/search` (search redesign) and `ui/shop` (shop +
per-type collectible pickers, `DialogContent` close-button fix). Findings on
the old `SearchPanel`, `ShopView`, `CollectiblesCatalogModal` and the vaul
drawer internals are kept for the record but marked **superseded**; re-run the
audit on those four areas after the next screenshot pass rather than planning
work from them.

Screenshots: `C:\Users\jon\AppData\Local\Temp\ds-audit\<view>-<width>-<theme>.png`
(widths 390 / 768 / 1280, themes dark / light, 2x DPR; 390 and 768 captured
with touch emulation so `pointer: coarse` matched). `diag-summary.txt` in the
same folder lists, per capture, horizontal overflow and every interactive
element under 44px that lacks the `HIT` extension.

---

## 1. Method and coverage

- **Fixtures.** 21 desktop surfaces x 3 widths x 2 themes and 10 phone
  surfaces x 2 widths x 2 themes from `/ui-fixtures` (166 captures), plus the
  6 public routes (`/`, `/sign-in`, `/sign-up`, `/activate`, `/invite/$code`
  invalid, `/share/$token` gone) at 3 x 2 (36 captures). 202 PNGs total.
- **Code.** Every component under `src/components` and every route, read
  against the system by six area reviewers (shell, profiles, voice, settings,
  pickers/modals/activities, auth/public).
- **Static checker.** `node scripts/audit-design-system.mjs` (section 2).
- **Capture failures to re-shoot** (blank or dev-server error frames; the view
  was then audited from code): `shell-empty-390-dark`, `shell-dm-768-light`,
  `mobile-sidebar-768-light`, `action-sheet-390-{dark,light}`,
  `action-sheet-768-dark`, `voice-landing-1280-dark`,
  `settings-desktop-390-{dark,light}`, `settings-desktop-768-light`,
  `settings-appearance-{390,768,1280}-light`,
  `settings-notifications-1280-light`, `settings-voice-768-dark`,
  `overlay-1280-{dark,light}`, `splash-1280-light`, `home-390-light`,
  `sign-in-390-dark` (splash frame). The share page captured TanStack's
  default error page because the fixture D1 lacks the `message_shares`
  migration (that is itself finding AU-01).
- **Theme caveat.** The signed-out pages never rendered light: the theme
  provider defaults to dark (AU-05), so their "light" captures are dark
  duplicates. Light/miku/spiderman on auth pages were checked from code.

### Counts

|                                                   |                                                                                              |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Views enumerated (Appendix A)                     | 269 (pages, panels, modals, popovers, menus, floating, overlay/empty/loading/error states)   |
| Views with a fixture or live capture              | 67 (+9 search/command surfaces that exist in `UiFixtures` but were not in this pass)         |
| Views scored (area tables, section 3)             | 108                                                                                          |
| Scored <= 2 (several visible deviations or worse) | 83                                                                                           |
| Scored 0 (broken at a supported width)            | 3: Friends page @390, Share route error page, (plus settings-desktop @390 blank, unverified) |
| Being redesigned / superseded                     | 13 views (search 7, shop 6) + drawer internals                                               |
| In the user's WIP files                           | 14 views (UserPanel, ChatPageClient, DMCallRegion, SharedMessagePage, voice hook consumers)  |
| Findings                                          | 220 (6 area reports, Appendix B) + 2124 static-checker hits                                  |

---

## 2. Static checker baseline (merged tree)

`node scripts/audit-design-system.mjs` on `ui/quiet-pro` after the three
merges: **595 files scanned, 2124 findings in 150 files, 9 allowlisted.**
(Before the merges: 2317; the shop rewrite removed about 190 hits.)

| rule                      | count | severity | files | note                                                                                |
| ------------------------- | ----- | -------- | ----- | ----------------------------------------------------------------------------------- |
| tailwind-text-size        | 585   | medium   | 96    | `text-xs/sm/base/lg/xl` instead of `text-ui-*` (4.1)                                |
| bare-hover                | 352   | medium   | 62    | `hover:`/`group-hover:` without `pointer-fine:` (9.3)                               |
| off-breakpoint            | 268   | low      | 50    | `sm:`/`xl:`/`2xl:` (3.1)                                                            |
| palette-color             | 253   | medium   | 32    | `amber-*`, `slate-*`, `emerald-*`, `cyan-*`... (7.1)                                |
| dead-blur                 | 151   | low      | 66    | `backdrop-blur-*` neutralised by styles.css (6.3)                                   |
| arbitrary-shadow          | 137   | low      | 35    | hand-rolled `shadow-[...]` (6.1)                                                    |
| arbitrary-text-size       | 114   | high     | 26    | `text-[Npx]` (4.1)                                                                  |
| off-grid-spacing          | 70    | medium   | 24    | px lengths off the 4px grid (2.1)                                                   |
| raw-color                 | 66    | high     | 19    | hex / rgb() / oklch() literals (7.1)                                                |
| z-index                   | 41    | medium   | 27    | off the 0/10/20/30/50/60/70/80/100 ladder (11.1)                                    |
| vh-height                 | 33    | high     | 20    | `vh`, `h-screen`, `w-screen` (3.4)                                                  |
| arbitrary-radius          | 32    | medium   | 12    | `rounded-[Npx]` (5.1)                                                               |
| transition-all            | 12    | high     | 2     | LinkEmbed 6, UserPanel 6 (10.2)                                                     |
| lucide-import             | 5     | high     | 5     | CopyMorphIcon, DeviceCodeDisplay, chat/Icons, SharedMessagePage, DesktopLogin (8.1) |
| innerwidth-breakpoint     | 4     | high     | 2     | ListenTogetherPanel x3, useChatPageLogic x1 (3.2)                                   |
| slow-motion               | 1     | medium   | 1     | UserPanel `duration-500`                                                            |
| ease-in, hard-press-scale | 0     |          |       |                                                                                     |

Top offending files (findings): `chat/SettingsAccountTab.tsx` 193,
`chat/LinkEmbed.tsx` 128, `chat/SoundboardPicker.tsx` 125,
`chat/WarpRushActivityStage.tsx` 125, `chat/WordleActivityStage.tsx` 85,
`chat/UserPanel.tsx` 54 (WIP), `HomePageClient.tsx` 53,
`RoomSettingsModal.tsx` 53, `chat/ListenTogetherPanel.tsx` 48,
`chat/EmojiPicker.tsx` 46, `RoomPageClient.tsx` 45,
`voice/VoiceDebugScreen.tsx` 45, `auth/DeviceActivation.tsx` 44,
`chat/GifPickerModal.tsx` 44. The Studio settings panels
(`chat/settings/*`) total 13, mostly theme-swatch values that belong in the
allowlist.

Known checker gaps (false positives / misses), to fix in a later pass:
`[@media(hover:hover)_and_(pointer:fine)]:hover:` is counted as bare hover
(DeviceActivation, device-login-styles); inline `style={{ zIndex }}` values
(SoundboardPicker 259/260/1090/1100) and inline `"68vh"` strings are not seen;
`text-rm-text-primary` (a class with no `@theme` mapping, 33+ uses) is not
detected. Rules worth adding: dead colour utilities, inline z-index, `Icon`
display steps (`2xl`/`3xl`) inside controls.

---

## 3. View inventory with scores

Score: 4 on-system, 3 minor polish, 2 several visible deviations, 1
structurally off-system, 0 broken at a supported width. "Fixture" names the
`/ui-fixtures` surface or live route; "code" means audited from code only and
listed under "needs fixture" in the area report. Full per-area tables with
"how to reach" and the top issues are in Appendix B; the complete 269-row
enumeration (kind, component:line, trigger, overlay primitive, phone form,
WIP flag) is Appendix A.

| area     | view                                                        | fixture                       | score | headline                                                                                                                      |
| -------- | ----------------------------------------------------------- | ----------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------- |
| Shell    | Desktop channel shell                                       | shell                         | 2     | 33px rows, 18px drag indent, typing pill over the list, 2px header icon gap                                                   |
| Shell    | Channel sidebar list                                        | shell, mobile-sidebar         | 2     | 13px category tap target, 4 left edges (8/16/24/41), square voice avatars                                                     |
| Shell    | Server rail                                                 | shell                         | 3     | hover morphs radius full -> 16, glow shadows, z-150 tooltip                                                                   |
| Shell    | Phone channel members page                                  | shell @390                    | 2     | 64px header, 65px card rows, 21px tabs with last tab clipped                                                                  |
| Shell    | Desktop member list                                         | shell                         | 2     | hand-rolled z-20 overlay below lg, 44px rows, offline opacity-60                                                              |
| Shell    | Empty channel welcome                                       | shell-empty                   | 1     | Instrument Serif title in the shell, 72px tile with shadow + text-white                                                       |
| Shell    | DM conversation + DM sidebar                                | shell-dm                      | 2     | serif title, 53px sidebar header, selected row shadow, "Message #Ada"                                                         |
| Shell    | No channel selected                                         | no-channel                    | 1     | serif title, icon in a shadowed card, no safe-area top                                                                        |
| Shell    | Phone conversation                                          | mobile                        | 3     | 28px reactions no HIT, 29px title button, ~48px gap under embeds                                                              |
| Shell    | Phone Messages tab                                          | mobile-home-messages          | 2     | desktop DMSidebar at desktop density, no page header                                                                          |
| Shell    | Phone Notifications tab                                     | mobile-home-notifications     | 3     | 56px header, muted/80 and muted/50 text fail contrast                                                                         |
| Shell    | Phone tab bar                                               | mobile-home-\*                | 4     | on-system                                                                                                                     |
| Shell    | Context menu                                                | menus                         | 3     | rounded-[10px], hand-rolled shadow, bare group-hover icon, ring on pointer open                                               |
| Shell    | InviteModal                                                 | menus                         | 2     | uppercase field labels, custom 40px close with ring, 36px selects on phone                                                    |
| Shell    | Bottom drawer                                               | drawer                        | 3     | whole-sheet focus ring (superseded by ui/drawer)                                                                              |
| Shell    | Action sheet                                                | action-sheet (capture failed) | 3     | 20px glyphs in a 15px row                                                                                                     |
| Shell    | User panel / voice dock (WIP)                               | shell                         | 1     | legacy SVG icons, unnamed mic/deafen buttons, hex + palette, transition-all                                                   |
| Shell    | App title bar                                               | shell                         | 2     | 24px buttons no HIT, text glyphs, 700 weight                                                                                  |
| Shell    | Thread sidebar                                              | code                          | 1     | hand-rolled phone full page at z-20, 380px, 14px input                                                                        |
| Shell    | Pinned messages panel                                       | code                          | 1     | in-column z-50 overlay with blur scrim, 420px + 100vh                                                                         |
| Shell    | Notification bell popover                                   | code                          | 1     | fixed inset-0 z-50 in the header, black/60 blur scrim, 85vh                                                                   |
| Shell    | Command menu                                                | code                          | 3     | own scrim; should host in Dialog                                                                                              |
| Shell    | Unread banner                                               | code                          | 2     | solid bg-primary strip                                                                                                        |
| Shell    | Delete-message confirm                                      | code                          | 1     | hand-rolled dialog, emerald "Protip", bg-destructive text-white                                                               |
| Shell    | ChannelInviteModal                                          | code                          | 2     | Tailwind sizes, primary alpha                                                                                                 |
| Shell    | Member detail tabs                                          | code                          | 1     | rounded-xl p-3.5 cards, font-bold, hover-only jump                                                                            |
| Shell    | Voice channel status/media rows                             | code                          | 1     | sm: breakpoint, hover moves controls, rgba shadow                                                                             |
| Shell    | Read-only composer                                          | code                          | 2     | h-[44px] rounded-xl opacity-80                                                                                                |
| Profiles | Friends page                                                | friends                       | **0** | @390 header clips tabs and Add Friend; 3 left edges; white glyph invisible in light                                           |
| Profiles | DM list (friends sidebar)                                   | friends                       | 2     | elevated+shadow selected row, 13/11px text, 32px avatar buttons no HIT                                                        |
| Profiles | Phone profile sheet (other)                                 | mobile-profile                | 2     | Call shown for blocked / hidden for friends (bug), dark in light theme, 20px inset + 20px radius                              |
| Profiles | Phone profile sheet (self)                                  | mobile-profile-me             | 2     | same + dead "Note" card, 40px banner buttons no HIT                                                                           |
| Profiles | Phone You page                                              | mobile-home-you               | 3     | icon column misaligned by 6px, rounded-xl groups, banner near-black in light                                                  |
| Profiles | Shared message gone (WIP)                                   | share-gone                    | **0** | TanStack default error page with raw D1 SQL; no errorComponent                                                                |
| Profiles | Invite invalid                                              | invite-invalid                | 2     | 401 shown as "Invite Invalid / Authentication required"; glass card                                                           |
| Profiles | Desktop profile popover                                     | code                          | 1     | 4 dead controls, hand-rolled portal/scrim/focus, rounded-3xl + shadows                                                        |
| Profiles | Profile modal                                               | code                          | 1     | fake tabs, 3 solid fills, white-on-red hover, two scrollers                                                                   |
| Profiles | Account popover                                             | code                          | 1     | hand-rolled portal, rows not MENU_ITEM, Switch Accounts always disabled                                                       |
| Profiles | Profile editor wrapper                                      | code                          | 1     | bg-black/56 blur scrim, rounded-3xl, not full-screen on phone                                                                 |
| Profiles | Avatar picker / frame editor                                | code                          | 1     | portal dialog without Escape/focus trap; hover-only delete                                                                    |
| Profiles | Reaction details                                            | code                          | 2     | remove-reaction hover-only (untappable in the drawer)                                                                         |
| Profiles | Share message modal                                         | code                          | 2     | hand-rolled phone sheet, no handle/safe area                                                                                  |
| Profiles | Start call confirm                                          | code                          | 2     | inline SVG checkbox, 24px close                                                                                               |
| Voice    | Voice connected                                             | voice                         | 2     | dock overflows @390/768, 16px gap + 24px inset, 112px avatar clips in 111px tile @768                                         |
| Voice    | Voice live (muted/deafened/camera/share)                    | voice-live                    | 1     | two solid accents + solid red Leave; no safe-area on dock                                                                     |
| Voice    | Voice landing                                               | voice-landing                 | 3     | 44px Instrument Serif in the shell; no safe-area top; empty state anatomy                                                     |
| Voice    | Focused stage / stream                                      | code                          | 2     | volume panel 384px wide overflows a 390 column; 128px white glyph; shadow-2xl                                                 |
| Voice    | Members tray                                                | code                          | 2     | duplicated in RoomPageClient; bare hover; sm:                                                                                 |
| Voice    | /room/$slug meeting                                         | code                          | 1     | forked dock with up to 3 solid reds, no HIT/PRESS, ~42px overflow @390, 56px header                                           |
| Voice    | DM call (WIP)                                               | code                          | 2     | same overflowing dock, fixed inset-0 no safe areas, zinc/green palette                                                        |
| Voice    | Incoming / outgoing call                                    | code                          | 2     | incoming at z-50 (system is z-100), two different greens, black/70 scrim                                                      |
| Voice    | Voice switch / apps / status modals                         | code                          | 2     | own scrims at z-60; Warp Rush card unreadable in light                                                                        |
| Voice    | Screen share pickers                                        | code                          | 2     | z-90 black/80 scrim, bare hovers                                                                                              |
| Voice    | Audio menus / panels                                        | code                          | 2     | hand-rolled popovers off MENU_PANEL, amber/emerald/sky, hover-only slider thumb                                               |
| Voice    | Stream context menus                                        | code                          | 2     | popover on touch instead of ActionSheet; submenus never flip                                                                  |
| Voice    | VoiceDashboard strip                                        | code                          | 2     | up to 4 solid accents with the main dock; z-[60]/[70] inside a panel; hover wiggle                                            |
| Voice    | Floating preview / details / debug / reactions              | code                          | 2     | off-ladder z, loops ignore reduced motion                                                                                     |
| Settings | Studio shell                                                | settings                      | 3     | phone heading focus-ring box; 32px nav rows no HIT @768 coarse; 36px search/select                                            |
| Settings | Appearance                                                  | settings-appearance           | 3     | light-theme card shadow; rail note repeats blurb                                                                              |
| Settings | Account                                                     | settings-account              | 3     | row label 15px vs 12.6's 13px; Edit profile opens the legacy editor                                                           |
| Settings | Sessions                                                    | settings-sessions             | 2     | false empty state after a failed load; raw "Authentication required"                                                          |
| Settings | Privacy                                                     | settings-privacy              | 2     | pill segmented control 28px, rounded-[6px], shadow                                                                            |
| Settings | Voice & video                                               | settings-voice                | 3     | no loading / permission / no-device state; 20px range on coarse                                                               |
| Settings | Soundboard                                                  | settings-soundboard           | 3     | iconSize overrides; Clear with no confirm; picker at z-[1100]                                                                 |
| Settings | Keybinds                                                    | settings-keybinds             | 3     | keyboard shortcuts shown on a touch phone                                                                                     |
| Settings | Notifications                                               | settings-notifications        | 3     | light-theme card shadow                                                                                                       |
| Settings | Desktop app                                                 | settings-desktop (390 blank)  | 2     | restart confirm hand-rolls its modal; restart failure swallowed                                                               |
| Settings | ThemePreviewSidebar                                         | code                          | 1     | unnamed close button; legacy type/radius; 320px panel on phone                                                                |
| Settings | Profile editor (SettingsAccountTab)                         | code                          | 1     | dead controls; no close in no-user state; claim flow unreachable; 193 checker hits                                            |
| Settings | ServerSettingsModal (+tabs)                                 | code                          | 1     | own scrim; pill tabs, no back step on phone; errors only in console; 0/7 recipe points                                        |
| Settings | ChannelSettingsModal (+permissions)                         | code                          | 1     | copy of server shell; unnamed tri-state buttons, colour-only state; green flash                                               |
| Settings | RoleManagement / Invites / AuditLog                         | code                          | 1     | window.confirm; console-only errors; emoji empty state                                                                        |
| Settings | RoomSettingsModal                                           | code                          | 1     | duplicates Studio panels in a legacy shell; palette; inline style kills md:pt-10                                              |
| Settings | CameraSettingsModal                                         | code                          | 1     | centred dialog on phone; no error/permission state; black/85 blur scrim                                                       |
| Settings | Create server / channel / category                          | code                          | 2     | desktop branch hand-rolls scrim, h2 not DialogTitle, uppercase input                                                          |
| Settings | UpdateChecker / StandaloneUpdater                           | code                          | 1 / 2 | z-90; text-white buttons; width animation; h-screen w-screen                                                                  |
| Pickers  | EmojiPicker                                                 | code                          | 2     | rounded-3xl, own shadows + click-catcher, vh, 14px phone input, amber/emerald strips                                          |
| Pickers  | GifPickerModal                                              | code                          | 1     | favourite hover-only; expanded z-90 + black/55; pill tabs; 32px close no HIT                                                  |
| Pickers  | SoundboardPicker (+delete confirm)                          | code                          | 1     | inline z 259/260/1090/1100 + z-[1200]; hover-only actions; 39 palette hues                                                    |
| Pickers  | PickerSurface                                               | code                          | 3     | lets callers pass z overrides; otherwise on 13.1                                                                              |
| Pickers  | MessageShareModal                                           | code                          | 1     | fake phone sheet, black/60 scrim                                                                                              |
| Pickers  | PinModal / ReactionDetails / UploadSound                    | code                          | 2     | desktop branch hand-rolls scrim; off-step widths                                                                              |
| Pickers  | ExternalLinkConfirmModal                                    | code                          | 3     | 510px confirm; 20px checkbox row                                                                                              |
| Pickers  | ImageViewer (5 files)                                       | code                          | 1     | unlabelled close/prev/next; z-50/60/70 inside; solid-accent menu hover; no safe areas                                         |
| Pickers  | ImageGrid + AttachmentList                                  | code                          | 2     | hover-only delete + window.confirm; 28px targets                                                                              |
| Pickers  | VideoAttachment + controls                                  | code                          | 2     | w-screen h-screen fullscreen; 32px controls no HIT                                                                            |
| Pickers  | LinkEmbed                                                   | code                          | 1     | #00A8FC titles, 7 off-scale radii, 39 bare hovers, 42 text-[px], transition-all, hand-rolled RemoveEmbeds modal               |
| Pickers  | ThreadSidebar                                               | code                          | 1     | (see Shell)                                                                                                                   |
| Pickers  | PinnedMessagesSidebar                                       | code                          | 1     | (see Shell)                                                                                                                   |
| Pickers  | SearchPanel                                                 | code                          | 2     | **superseded by ui/search**                                                                                                   |
| Pickers  | ShopView / CollectiblesCatalogModal                         | code                          | 1     | **superseded by ui/shop**                                                                                                     |
| Pickers  | ListenTogetherPanel / NowPlaying / ResultActions / floating | code                          | 1-3   | innerWidth<1024, segmented pill, rounded-2xl/3xl + shadow cards, hand-rolled phone action sheet, z-40, touch-none on scroller |
| Pickers  | WordleActivityStage                                         | code                          | 2     | hex tiles, 3 hand-rolled dialogs, 53 Tailwind sizes                                                                           |
| Pickers  | WarpRushActivityStage                                       | code                          | 1     | 77 palette hues; needs --rm-activity-\* tokens                                                                                |
| Pickers  | DragDropOverlay / Mention autocomplete / mention tooltip    | code                          | 2     | z-50 in-panel, zoom-in from scale 0, hand-rolled tooltip                                                                      |
| Pickers  | ConnectionOverlay                                           | overlay                       | 3     | fixture never reaches the reconnect state; no safe-area pad                                                                   |
| Pickers  | Splash / LoadingScreen                                      | splash                        | 4     | timeout not cleared                                                                                                           |
| Auth     | Home (marketing)                                            | home                          | 2     | hero blank before hydration @390; 21 sm:, text-white, hex                                                                     |
| Auth     | Sign in / Sign up                                           | sign-in, sign-up              | 3     | ignores system theme; Kova bridge incomplete (error colour, 15px inputs, #fff CTA); 15-18px links                             |
| Auth     | Activate (signed out)                                       | activate                      | 2     | bounced to generic "Welcome back" with no device hint                                                                         |
| Auth     | Activate states (signed in)                                 | code                          | 2     | own Button/input: 9 text-[px], 5 rounded-[10px], 10 off-grid; white spinner invisible in light                                |
| Auth     | DesktopLogin (Tauri)                                        | code                          | 2     | 7 lucide icons; serif 30px titles vs web Figtree 24px; 30px Cancel                                                            |
| Auth     | Invite (signed in states)                                   | code                          | 1     | emerald success; "No thanks" text-xs no target                                                                                |
| Auth     | Room pre-join                                               | code                          | 1     | hover lifts button; glow shadows                                                                                              |
| Auth     | 404                                                         | code                          | 2     | min-h-screen, Tailwind sizes                                                                                                  |

---

## 4. Top 15 findings

Ordered by user impact, then by how many views one fix clears. IDs refer to
Appendix B (area prefix + the reviewer's number).

1. **Friends page is unusable at 390** (PR-01, score 0). `FriendsView.tsx:231-275`
   puts menu + title + 4 tabs + Add Friend in one non-scrolling `h-12` row;
   "Blocked" ends at x=364 and Add Friend starts at x=385, clipped. Rule 3.7,
   9.1. Fix: tabs move to a second `h-11 overflow-x-auto` strip below `md`;
   Add Friend becomes an `IconButton size="md"` in the trailing slot.
2. **Voice dock overflows at 390 and 768** (VC-01). `VoiceControls.tsx:116-121`
   lays out 438px of controls in a 390 viewport (48px hidden, Members toggle
   shows 9px) and 487px in the 456px column at 768; `overflow-x-auto
scrollbar-none` hides it with no affordance. DMCallRegion shares it and
   keeps the hidden group in flow via `invisible`. Fix: 6 controls below `md`
   (mic, deafen, camera, share, More, Leave = 370px), container query above.
3. **Public routes have no error boundary** (AU-01 / PR-05, score 0).
   `routes/share.$token.tsx:32-39` rethrows anything but 404/410 and no route,
   root included, defines `errorComponent`; visitors get TanStack's unstyled
   page with the raw `D1_ERROR` text. Fix: themed `errorComponent` on `__root`
   and `/share/$token` using the 14.1/14.3 anatomy; never render `error.message`.
4. **Signed-out invite links read as invalid** (AU-02 / PR-07).
   `InviteClient.tsx:36-40, 201-217` renders "Invite Invalid / Authentication
   required" on 401 with a 118x40 "Go to Chat" that leaves the invite. Fix:
   a "Sign in to join" state linking to `/sign-in?redirect_url=/invite/<code>`.
5. **About 30 hand-rolled overlays** (SH-02, PR-08, VC-18, ST-09, PK-02..07,
   PK-10). Eight different scrim alphas (`bg-black/50` to `/80`,
   `bg-rm-bg-primary/50`), none `bg-rm-scrim`; off-ladder z (40, 60, 70, 90,
   1090-1200); no back-button, focus trap or Escape in several
   (RemoveEmbeds, LT ResultActions, AvatarFrameEditor, Collectibles).
   Pinned/Thread/Members/Bell/CommandMenu/delete-confirm each implement a
   scrim inside the chat column. Rule 13.1, 6.5, 11.2. Fix once per family:
   `ResponsiveDialog` (confirm/form), `Sheet`/`Drawer` (side panels),
   `PickerSurface` (pickers, bell), `ActionSheet` (phone actions), `Dialog`
   workbench (viewer, profile editor).
6. **Hover-only actions with no touch path** (PK-01, PR-04, SH-52, VC-23).
   ~25 sites use `opacity-0 group-hover:opacity-100` for favourite, delete,
   unpin, jump, remove-embed, remove-reaction, remove-role and the volume
   slider thumb; on phones they cannot be reached, and a tap latches them.
   `FriendsView.tsx:451` already has the right recipe. Fix: a `REVEAL`
   constant in `ui/interaction.ts` (`pointer-coarse:opacity-100
pointer-fine:group-hover:opacity-100 group-focus-within:opacity-100`) plus
   long-press action sheets in the three pickers.
7. **More than one solid fill in the voice dock** (VC-02, VC-04, VC-31).
   `VoiceControls.tsx:30` paints camera-on and sharing as `bg-primary`
   (two accent solids + solid red Leave in `voice-live-390-dark.png`);
   `VoiceDashboard.tsx:50` repeats it (up to four solids on desktop);
   `RoomPageClient.tsx:207-288` uses solid `bg-destructive` for muted mic and
   deafen (up to three solid reds). Rule 1.1, 12.13. Needs the user's call on
   "live" (see section 7); the fix is one `dockState()` recipe consumed by all
   three docks.
8. **Programmatic focus draws a ring on non-interactive targets** (ST-01, also
   SH-20 and PR-36 for the old drawer). The unlayered `:focus-visible` rule in
   `styles.css:1129` beats `outline-none`, so `SettingsModal.tsx:287/689`
   focusing the `h2` on push, deep-link row focus (`primitives.tsx:223`,
   `rails.tsx:187`) and the phone nav all show a 2px accent box around a
   title that looks like a text field (`settings-voice-390-dark.png`). Fix:
   one rule, `[tabindex="-1"]:focus-visible { outline: none }` (or an
   `.rm-focus-target` class), keeping the focus move for screen readers.
9. **Presence colours ignore `--rm-status-*`** (PR-03, VC-13). `UserStatusDot.tsx:5-10`
   maps online to `bg-primary`, idle to `bg-warning`, dnd to `bg-destructive`;
   `UserProfileModal.tsx:65-70` uses `emerald-500`/`amber-500`; the speaking
   ring in `ParticipantCard.tsx:121` is `ring-primary` + glow. Accent now
   means both "selected" and "online/speaking" (7.3). Fix: map
   `--color-rm-status-*` in `@theme inline`, use them everywhere, speaking ring
   `ring-rm-status-online`.
10. **Desktop lists shipped at desktop density on phones** (SH-03, SH-10,
    SH-11, SH-07). Messages tab mounts `DMSidebar` as-is (32px rows and
    search, no header); the members page has a 64px header, 65px card rows
    and 21px tabs with the last tab clipped; the category collapse button is
    13px tall on the main phone nav. Rule 9.1, 12.2, 12.4. Fix: one phone
    row recipe (`min-h-12 px-4 gap-3`, 40px avatar) and `HIT` on the raw
    `<button>`s.
11. **No safe-area handling in the voice tree or fixed overlays** (VC-03,
    SH-17, PK-20, PK-35, AU-20). `VoiceChannelView.tsx:590` dock,
    `VoiceHeader.tsx:54`, `VoiceLanding.tsx:38`, `DMCallRegion.tsx:434`,
    `VoiceDebugScreen.tsx:157`, `ImageViewerToolbar`, `ConnectionOverlay`,
    `NotificationBell`, `EmptyChatArea` header: none pad with
    `var(--safe-area-*)`; the iOS home indicator covers the bottom 20px of
    Leave and Mute. Rule 3.6.
12. **Display serif inside the chat shell** (SH-01, VC-14). `ChatWelcomeContent.tsx:46/90`,
    `EmptyChatArea.tsx:37` (36px) and `VoiceLanding.tsx:68` (44px
    `text-display-lg`) use Instrument Serif; 4.4 keeps it in auth/marketing.
    Fix: `text-ui-xl font-semibold text-balance`.
13. **Profile surfaces hard-code a dark default theme** (PR-09, PR-37).
    `lib/profile-customization.ts:75-77` defaults to `#5865F2`/`#161A22`, so
    `MobileProfileSheet`, `MobileYouPage`, `UserProfilePopover`,
    `UserProfileModal` and `UserAccountPopover` render a navy sheet over a
    light app (`mobile-profile-390-light.png`). Rule 7.1, 7.5. Fix: default
    variables that point at `--rm-*` tokens.
14. **Kova auth bridge stops at colours** (AU-03, AU-04, AU-11).
    `styles.css:1784-1799` leaves the SDK's `#fff` on the primary button
    (2.1:1 on miku-dark's teal, 3.1:1 on miku-light), `--ra-color-error
#ff6b6b` (2.5:1 on light), 15px inputs (iOS zoom), 10px radius, and
    15-18px tall links/tabs. App-side primary buttons in `DeviceActivation`,
    `DesktopLogin`, `InviteClient`, `HomePageClient` hard-code `text-white`
    too. Fix: one `.auth-split [data-ra-element=...]` block plus
    `text-rm-on-accent`.
15. **Soundboard/GIF z-index above the system layer; incoming call below menus**
    (PK-06, VC-17). `SoundboardPicker.tsx:1341-1374, 2747` uses 259/260/1090/
    1100/1200 (above ConnectionOverlay and IncomingCall at 100);
    `GifPickerModal.tsx:317` z-90; `IncomingCallModal.tsx:118` sits at z-50
    under tooltips and any open dialog. Rule 11.1. Fix: pickers z-50/60 owned
    by `PickerSurface`, incoming call z-100.

Also worth knowing: `text-rm-text-primary` is used 33+ times
(`LinkEmbed` x28, `ChatHeader`, `ChatWelcomeContent`, `MemberList`,
`ServerList`, `UserPanel`, `DragDropOverlay`, `MentionAutocomplete`,
`ExternalLinkConfirmModal`, `HoveredMentionTooltip`) but `@theme inline` maps
only `--color-rm-text`, so the class generates no CSS and hover variants on it
do nothing (SH-39, PK-18). The Studio reference recipe itself ships a
light-theme card shadow (`primitives.tsx:153`) and 15px row labels where 12.6
says 13 (ST-10, ST-11), so adopters will copy both.

---

## 5. Shared causes (what a single commit can clear)

| cause                                                       | files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | findings                                                                                | section                 |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------- |
| Overlay primitives bypassed (own scrim/z/focus/back)        | ChatArea, MemberList, ThreadSidebar, PinnedMessagesSidebar, NotificationBell, CommandMenu, MessageItem (delete), LinkEmbed (RemoveEmbeds), ListenTogetherResultActions, MessageShareModal, PinModal, ReactionDetailsModal, UploadSoundModal, CreateServer/Channel/CategoryModal, DesktopPanel, SoundboardPicker (delete), WordleActivityStage x3, VoiceChannelMedia/TextStatusModal, ScreenShareModal, DesktopScreenPickerModal, OutgoingCallModal, AudioInteractionModal, CameraSettingsModal, ServerSettingsModal, ChannelSettingsModal, RoomSettingsModal, ProfileEditorModal, UserProfileModal, UserProfilePopover, UserAccountPopover, AvatarPickerModal, AvatarFrameEditor, StartCallModal, VoiceDashboard menus, VoiceDetailsPanel, AudioDeviceMenu, ImageViewer menu | SH-02, SH-26/27/29, PR-08, VC-15/17/18/22, ST-08/09/18/21/22, PK-02..07, PK-10/11/20/22 | 13.1, 6.5, 11           |
| Hand-rolled `<button>` without HIT/PRESS                    | ChannelSidebar, MemberList, MessageItem, ChatHeader, AppTitleBar, DMSidebar, DMListPanel, FriendsView, pickers, ImageViewer\*, VideoPlayerControls, AttachmentList, ImageGrid, SettingsModal nav, select.tsx, DeviceActivation, device-login-styles, InviteClient, HomePageClient                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | SH-03/14/15/44, PR-16, ST-12, PK-15, AU-11                                              | 9.1, 9.2                |
| Hover-revealed actions with no touch path                   | GifPickerModal, SoundboardPicker, PinnedMessagesSidebar, ImageGrid, AttachmentList, LinkEmbed, ReactionDetailsModal, AvatarPickerModal, UserProfilePopover, MemberList detail tabs, ContextMenuItems slider                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | PK-01, PR-04, SH-52, VC-23                                                              | 9.3                     |
| Three voice dock implementations                            | VoiceControls, VoiceDashboard, RoomPageClient                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | VC-01/02/04/05/06/31                                                                    | 12.13, 1.1              |
| Viewport `sm:` in column-width components                   | VoiceGrid, ParticipantCard, StreamLoadingIndicator, members tray, DMCallRegion, dialogs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | VC-09, VC-01@768                                                                        | 3.1                     |
| No shared sidebar row recipe                                | ChannelSidebar, DMSidebar, DMListPanel, MemberList (4 paddings, 3 selected states, 2 pill geometries; `bg-rm-bg-active` is red in spiderman)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | SH-04/05/07/13/23/42, PR-16                                                             | 12.3, 7.2               |
| Desktop lists reused on phone                               | MobileMessagesTab, MemberList phone page, DMSidebar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | SH-10/11, PR-16                                                                         | 12.4                    |
| No shared settings workbench                                | ServerSettings, ChannelSettings, RoomSettings, CameraSettings, ProfileEditor, DesktopPanel, Create\*                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ST-08/09/18/19/21/22                                                                    | 12.6, 12.8              |
| Settings reference recipe drifts from 12.6                  | primitives.tsx (shadow, 15px label, rounded-[3px], RowError icon), select.tsx coarse heights, `.rm-settings-range` 20px                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ST-10/11/12, ST shared 3-4                                                              | 12.6, 9.1               |
| Errors only in console / native confirm / raw `err.message` | ServerSettingsModal, InvitesTab, ChannelPermissionsTab, DesktopPanel, CameraCard, RoleManagement, SessionsPanel, PrivacyPanel, SettingsAccountTab, InviteClient, SharedMessagePage, share route                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | ST-14/16/17/27, AU-01/02/18                                                             | 14.3                    |
| Profile colour variables default to dark                    | profile-customization.ts + 6 consumers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | PR-09/10/17/19/33/37                                                                    | 7.5                     |
| Auth pages own private primitives                           | DeviceActivation (local Button/BTN), device-login-styles.ts, DesktopLogin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | AU-08/10/11/12/13/14/19/21                                                              | 13.2, 13.4              |
| Kova SDK bridge incomplete                                  | styles.css `.auth-split` block                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | AU-03/04/11                                                                             | 7.4, 4.6                |
| Pre-Quiet-Pro files never migrated                          | LinkEmbed, SoundboardPicker, GifPickerModal, EmojiPicker, WarpRush, Wordle, ListenTogether\*, RoomPageClient, RoomSettingsModal, SettingsAccountTab, InviteClient, HomePageClient, ShareSnapshotPreview, DemoRoomChatPanel, VoiceDebugScreen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | checker top 15                                                                          | 4.1, 9.3, 6.1, 6.3, 7.1 |
| Missing or dead tokens                                      | `text-rm-text-primary` (no mapping), `--rm-status-*` unmapped, no favourite/activity/accept tokens, `.picker-header` hard-coded red, `--rm-dur-4` 320                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | SH-39, PK-16/18/27, VC-12, PR-03                                                        | 7.2, 10.1               |
| Theme default dark for signed-out visitors                  | theme-provider.tsx:9                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | AU-05                                                                                   | 7.5                     |
| Dead code in the reachable tree                             | FriendListPanel, VoiceChannelStatusPreview, OutgoingCallModal, SettingsAccountTab `!asModal` branches, UserProfilePopover phone branch, UserAccountPopover phone centring, ui/sheet.tsx unused today                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | PR-30, ST-07, inventory                                                                 | -                       |

---

## 6. Fix plan (ordered, independently committable units)

Each unit is one commit or one small PR. "WIP" marks units that touch the
user's in-progress files (`UserPanel.tsx`, `ChatPageClient.tsx`,
`useChatPageLogic.ts`, `DMCallRegion.tsx`, `src/hooks/useVoiceChannel.ts`,
`src/lib/voice/**`, `realtime/**`, `SharedMessagePage.tsx`); those lines are
listed separately so the user can land them inside their own work. Units
tagged **re-check** depend on the merged redesigns and should be re-audited
first. Codemod units should run the checker before and after and commit the
delta.

| # | unit | scope | clears | WIP |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1 | **Tokens and primitives** (foundation, no visual churn): map `--color-rm-status-online/idle/dnd/offline` and `--color-rm-text-primary` (alias of `--color-rm-text`, or codemod the 33 uses) in `@theme inline`; `--rm-dur-4: 280ms`; `[tabindex="-1"]:focus-visible{outline:none}`; `menu.ts` `MENU_PANEL` -> `rounded-lg shadow-lg`, `MENU_ICON` -> `pointer-fine:group-hover`; `select.tsx` trigger/items `pointer-coarse:min-h-11`, content `z-50 rounded-lg`; `.rm-settings-range` 44px on coarse; `settings/primitives.tsx` drop the light card shadow, label `text-ui-sm` (or amend 12.6), icon in `RowError`; add `REVEAL` to `interaction.ts`; add `--rm-activity-wordle-*`, `--rm-activity-warp-*`, `--rm-favourite` (= accent) tokens; allowlist the theme-swatch hexes in `AppearancePanel`/`ThemePreviewSidebar`; `theme-provider` default `"system"` when unauthenticated (decision 6) | styles.css, ui/menu.ts, ui/select.tsx, ui/interaction.ts, chat/settings/primitives.tsx, theme-provider.tsx, allow.json | ST-01, ST-10/11/12, SH-35 (menu), PR-03 (tokens), SH-39/PK-18, PK-27 (tokens), VC-12 part, AU-05 | no |
| 2 | **Codemod: text sizes** `text-xs/sm/base/lg/xl/2xl` and `text-[Npx]` -> `text-ui-*` per the 4.1 table (14 -> `ui-sm`, 15 -> `ui-base`, 24/30 -> `ui-2xl`); marketing serif sizes in HomePageClient -> `text-display(-lg)`; `font-bold` on titles -> `font-semibold` | 96 files (585 + 114 hits); skip WIP + superseded | SH-34, PR-34, VC-29, PK-29, AU-12 | UserPanel 10, SharedMessagePage 6, DMCallRegion 2, ChatPageClient 1 listed for the user |
| 3 | **Codemod: hover gating** `hover:`/`group-hover:`/`peer-hover:` -> `pointer-fine:` prefix; delete `group-hover:animate-wiggle` and any hover that translates/scales (RoomPageClient:144, LinkEmbed:1692/4808, PinnedMessagesSidebar:274) | 62 files (352 hits) | SH-30, PR (18), VC-20, PK (81), AU-19 | UserPanel 24, ChatPageClient 2, DMCallRegion 1, SharedMessagePage 1 |
| 4 | **Codemod: elevation** delete every `backdrop-blur-*`/`blur-*` (151); `shadow-[...]` -> `shadow-sm                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | lg                                                                                                                     | 2xl`on floating surfaces, delete on tiles/cards/buttons (137);`drop-shadow-[...]` likewise | 66 + 35 files | SH-31/32, PR-32/33, VC-19/30, PK (73+58), AU-17 | ChatPageClient 1, DMCallRegion 1, UserPanel 1 |
| 5 | **Codemod: viewport and breakpoints** `vh` -> `dvh`, `h-screen`/`min-h-screen` -> `-dvh`, `w-screen` -> `w-full`; `sm:` -> `md:` where the intent is "phone vs not" (dialog footers, grids), container queries where the component lives in a column (VoiceGrid, ParticipantCard, StreamLoadingIndicator); `window.innerWidth < 1024` -> `useIsMobile()`/`lg` media query in ListenTogetherPanel | 20 + 50 files | VC-09, PK-13, SH-29, AU-20, VC-01@768 | useChatPageLogic:190, SharedMessagePage 2 |
| 6 | **z-index ladder** per 11.1: pickers z-50/60 owned by `PickerSurface` (remove `drawerClassName` z overrides, inline `zIndex` in SoundboardPicker, GifPicker z-90); IncomingCallModal z-100; floating players z-30; tiles `isolate` with children <= z-10; DragDropOverlay z-30; tooltip-in-rail z-80 -> `Tooltip`; HomePageClient header z-20 | 27 files + inline | SH-33, PR-31, VC-17, PK-06/20/21/28, ST-24/35 | ChatPageClient 1, DMCallRegion 1 |
| 7 | **Confirm/form dialogs -> `ResponsiveDialog`** (drop the `isMobile` forks and hand-rolled scrims; widths `md:max-w-sm                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | md                                                                                                                     | lg`; `Button variant="danger"`/`destructive`): PinModal, ReactionDetailsModal, UploadSoundModal, CreateServer/Channel/CategoryModal, DesktopPanel restart, MessageItem delete, LinkEmbed RemoveEmbeds, SoundboardPicker delete, MessageShareModal, StartCallModal, VoiceSwitchModal, VoiceChannelMedia/TextStatusModal, AudioInteractionModal, OutgoingCallModal (or delete: unreachable), InviteModal close button, ExternalLinkConfirmModal width | 18 files | SH-19/27, PR-08 part, PR-23/24/25, VC-18, ST-18/22, PK-02/07/10/11/34 | no |
| 8 | **Side panels -> `Sheet` (desktop < lg) / `Drawer` (phone)** at 360: PinnedMessagesSidebar (+host in ChatArea), ThreadSidebar, MemberList below lg, SearchPanel host (re-check), ThemePreviewSidebar; NotificationBell -> `PickerSurface`; CommandMenu -> `Dialog`+`DialogSurface`; remove in-column scrims/Escape handlers | ChatArea, MemberList, ThreadSidebar, PinnedMessagesSidebar, NotificationBell, CommandMenu, ThemePreviewSidebar | SH-02/26/29/45, PK-04/05/25/26, ST-23 | ChatPageClient (voice text-chat panel :1359-1369) |
| 9 | **Popovers -> `MENU_PANEL`/`MENU_ITEM`** (Base UI Popover, portalled, z-50, phone -> drawer/action sheet): UserProfilePopover, UserAccountPopover, AudioDeviceMenu, VoiceDashboard stream/noise menus, VoiceDetailsPanel, MentionAutocomplete, ImageViewer "more" menu, HoveredMentionTooltip -> `Tooltip`, ServerList DM tooltip -> `Tooltip`, StreamContextMenu/Local/Remote -> `ActionSheet` on touch with flipping submenus | 12 files | PR-08/17/19, VC-15/22, PK-20/22/32, SH-25 | no |
| 10 | **Sidebar row recipe** `SIDEBAR_ROW` in `ui/` (`h-8 pointer-coarse:min-h-11 px-2 gap-2.5 rounded-md text-ui-base font-medium`, selected `bg-rm-tint-2`, hover `pointer-fine:hover:bg-rm-tint-1`, 2px edge pill, `size-5` icon slot); apply to ChannelSidebar (rows, categories `px-2 pt-4 pb-1`, drag handle in the gutter, voice participant rows), DMSidebar (48px header), DMListPanel, MemberList desktop rows; replace `bg-rm-bg-active/hover` (47 uses, red in spiderman) | 4 files + ui | SH-04/05/06/07/13/23/42, PR-16 | no |
| 11 | **Phone list pages**: MobileMessagesTab gets a 48px header + `min-h-11` search + 12.4 rows; MemberList phone page 48px header, `rounded-lg bg-rm-tint-1 divide-y` groups per role, `Tabs` with coarse height and fade mask; category collapse button `min-h-11`+`HIT`; FriendsView header split + edges `px-4` + rows `min-h-12`; NotificationBell rows (secondary/muted ink, 40px avatars, `h-12` header); ChatHeader title button `HIT`, `gap-2`, `px-4`, `size="md"` | 7 files | SH-03/08/10/11/12/15/28, PR-01/12/13/15 | no |
| 12 | **Voice stage and dock**: one `dockState(rest                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | open                                                                                                                   | muted                                                                                                                                                                                                                                                                                                                                                                                                                                               | live)`recipe on`IconButton size="lg"`consumed by VoiceControls, VoiceDashboard and RoomPageClient (delete`ControlsBar`); phone dock = 6 controls + More sheet; `gap-2`; camera `state="active"`not`cameraOff`; Leave = `variant="danger"`, Stop Watching/Leave Activity = `destructive`; header as a `shrink-0 h-12 border-b`sibling (overlay only when a stream is focused); grid`gap-2 md:gap-3 p-4 md:p-6`with container-query columns/avatar; avatar fallback`bg-rm-tint-2 text-rm-text text-ui-2xl`; speaking ring `ring-rm-status-online`; name chip per 12.13; `place-content-[safe_center]`; safe-area padding on dock/headers; VoiceLanding `text-ui-xl`+ 14.1 empty state; StreamingStats "Stable" mapping from`connectionState`; accept-call green token | VoiceControls, VoiceGrid, ParticipantCard, VoiceHeader, VoiceLanding, VoiceChannelView, VoiceDashboard, RoomPageClient, IncomingCallModal, streamingStats.ts | VC-01..08, VC-10/13/14/16/21/24/25/27/28/31/32/33 | **DMCallRegion** (:434 safe areas, :49 green, :437 heights, :528 ring) and `useVoiceChannel` consumers: hand to the user |
| 13 | **Touch reveal** (`REVEAL` from unit 1 + long-press `ActionSheet`): GifPickerModal, SoundboardPicker, PinnedMessagesSidebar, ImageGrid, AttachmentList, LinkEmbed remove-embeds, ReactionDetailsModal, AvatarPickerModal, UserProfilePopover role remove, MemberList detail jump, ContextMenuItems slider thumb (always visible, `pointer-coarse:size-5`) | 11 files | PK-01, PR-04, SH-52, VC-23 | no |
| 14 | **HIT/PRESS on hand-rolled controls** (or swap to `Button`/`IconButton`): MessageItem reactions/add-reaction/reply connector, AppTitleBar, ChatHeader, DMSidebar search, DMListPanel avatars, SettingsModal nav rows (+`PRESS`, Fill icon, 600 on selected), GifPicker/Soundboard/ImageViewer/VideoPlayer/AttachmentList/ImageGrid/SensitiveMediaFrame/ThreadSidebar/LinkEmbed controls, ExternalLinkConfirm checkbox row, InviteClient/HomePageClient links, Kova links/tabs via CSS, MobileProfileSheet banner buttons, CameraCard remove | ~25 files | SH-14/15/44, PR-11/16, ST-12/30/38, PK-15/33/34, AU-11 | no |
| 15 | **Settings workbench**: extract Studio's nav + push page + header + body into `SettingsWorkbench`; rebuild ServerSettingsModal (+Roles/Bans/Invites/Audit), ChannelSettingsModal (+Permissions as labelled radiogroups with tint fills), RoomSettingsModal (render the Studio cards), CameraSettingsModal (`ResponsiveDialog` + `CameraCard`), ProfileEditor dialog (one mount, workbench size, full-screen on phone, header close in every state, footer with safe area), DesktopPanel confirm; adopt `useConfirm`/`ConfirmStrip`/`RowError`/`describeApiError()` across the family; Sessions false-empty fix; Voice & video permission/no-device/loading states; Privacy segmented -> `Tabs`/`RadioList`; Keybinds hidden on touch; Soundboard Clear confirm; AuditLog states | 14 files | ST-02..09, ST-13..22, ST-27/29/33/36/37, PR-26/27 | no |
| 16 | **Profile surfaces**: `DEFAULT_PROFILE_THEME` -> `--rm-*` variables; MobileProfileSheet `px-4`, `rounded-lg p-4 gap-4` cards, `Button size="lg"`, moderator rows `min-h-11 gap-3`, ui type, `HIT`, media-overlay colours only with a banner, fix Call for blocked/friends (`type === 1`), remove dead Note/Manage; UserProfileModal (real `Tabs` or none, one solid, Block confirm, one scroller, `RowError`); UserProfilePopover (wire or remove 4 dead controls, `rounded-lg shadow-lg`, secondary Edit button); UserAccountPopover (menu recipe, remove Switch Accounts, placeholder copy); MobileYouPage icon slot `size-5`, `rounded-lg`, selected status tint; UserPlatformIndicators muted; AvatarPicker/FrameEditor internals | 9 files | PR-02/06/09/10/11/17/18/19/26/27/28/29/35/37 | no |
| 17 | **Auth and public pages**: `.auth-split` Kova block (`--ra-color-error/success/warning`, `--ra-font-size 16px` below md, `--ra-color-border-strong`, radius 8, field edge, `formSubmitButton` colour, 44px tabs/links); DeviceActivation + DesktopLogin + device-login-styles on `Button`/`IconButton`/`Input`/`Spinner` (drop local primitives, `rounded-[10px]`, 18px stacks, `--rm-status-dnd` errors -> danger ink + 14.3 strip, white spinner); lucide -> `<Icon>` (CopyMorphIcon takes `IconName`; add timer-off/shield-x/external-link to mapping) in CopyMorphIcon, DeviceCodeDisplay, DesktopLogin, chat/Icons; `AuthSplitLayout` caption for `/activate` redirects; root + share `errorComponent`; InviteClient 401 state + 12.5 card + `Button` + success ink; HomePageClient hero `initial={false}` on SSR, header z-20 + safe area, `text-white`/hex removal; 404 page; decide 12.15 card vs flat column (decision 4) | 12 files | AU-01..21, PR-07/20 | **SharedMessagePage** (lucide `Radio`, `min-h-screen` x2, gone/loaded states, `sm:`): hand to the user |
| 18 | **Picker desktop recipe in `PickerSurface`** (`MENU_PANEL` + `rounded-lg shadow-lg`, `max-h-[min(600px,calc(100dvh-24px))]`, z owned by the surface, no per-picker click-catcher); EmojiPicker/GifPickerModal/SoundboardPicker adopt it; GIF media-type switch -> `Tabs`, voice chips tint; favourite star -> `<Icon name="star" state>` in accent ink; palette strips -> warning/success tints; phone inputs `text-ui-md`; delete `.picker-header` gradient and `.picker-panel !important` from styles.css; SoundboardPicker Listen/Upload gradients -> `Button secondary` | 4 files + styles.css | PK-12/13/14/16/17/24, SH-22, ST-35 | no |
| 19 | **LinkEmbed `EmbedFrame`**: one frame (`rounded-xl border border-rm-border bg-rm-bg-surface`), accent-ink titles (`#00A8FC` x2, `#202225`), provider radii 18/20/22/24 -> `rounded-xl`, 18 inline generic SVGs -> `<Icon>`, `transition-all` x6 -> `transition-opacity`/`transition-[filter]`, carousel dots `HIT`, 42 `text-[px]`, 39 hovers (units 2-4 cover the mechanical part); allowlist the 3rd-party brand colours that remain | LinkEmbed.tsx (5150 lines; its own PR) | PK-02/19, SH (embed gap via VirtualMessageList minHeight) | no |
| 20 | **Activities and Listen Together**: Wordle/WarpRush on `--rm-activity-*` tokens (unit 1), `Button` for Play, 3 Wordle dialogs -> `ResponsiveDialog`, WarpRush failure state anatomy; ListenTogetherPanel `useIsMobile`, `Tabs`, `rounded-lg` cards without shadow, 14.1 empty states; NowPlayingCard shadows; ResultActions -> `ActionSheet`; FloatingSoundboardManager `touch-none` on the handle only; VoiceAppsModal Warp Rush card on `bg-rm-bg-surface` | 8 files | PK-03/21/23/27, VC-11, VC-33 | no |
| 21 | **Empty / loading / error state anatomy** (14.1-14.3): EmptyChatArea (bare `Icon 3xl`, `text-ui-md`, safe-area header, `size="md"` button), ChatWelcomeContent (tile `rounded-lg` no shadow, token glyph, secondary body, `mb-4`), FriendsView tabs (icon muted, body on every tab, one action, skeleton rows), VoiceLanding, PinnedMessagesSidebar, settings no-match, AuditLogTab, InviteClient states, SharedMessagePage gone (WIP), MemberList detail tabs, GifPicker favourites, Listen Together empties, DMListPanel empty (unboxed), `Spinner` + `sr-only` everywhere a custom spinner exists (StreamLoadingIndicator, ImageViewer, FriendsView, MemberList, AuditLog) | 14 files | SH-01/17/18/46, PR-14/16, VC-27/32, PK-25/28/35, ST-29/33, AU-18 | SharedMessagePage |
| 22 | **Message row and composer details**: VirtualMessageList `minHeight` only as the virtualizer estimate (48-60px gaps under embeds), typing pill inside its band (`h-6`, `left-4`, no border/shadow), MessageItem name `font-medium`, PINNED -> `Badge` sentence case, reacted pill `bg-rm-accent-tint`, filename `text-rm-accent-ink`, hover bar per 12.12; MessageInput attach `size-8` + `lg` icon, controls `gap-2`, send `lg`, selection token, DM placeholder without `#`, send-button width animation -> opacity/scale; read-only composer; skeleton rows `bg-rm-tint-1 rounded-md`; `overscroll-contain` on the three scrollers | MessageItem, MessageInput, InputControls, VirtualMessageList, ChatArea, ChatTypingIndicator | SH-09/14/16/40/41/46/50, SH-38 | no |
| 23 | **Dead code**: delete FriendListPanel.tsx, VoiceChannelStatusPreview.tsx, OutgoingCallModal.tsx (unless unit 7 keeps it), SettingsAccountTab `!asModal` branches (:3006-3011, :4471-4552, :4554-4582 — or move claim-account into AccountPanel), UserProfilePopover :639-661/878 phone branch, UserAccountPopover :135-165; confirm whether ui/sheet.tsx stays (unit 8 uses it) | 6 files | PR-30, ST-07 | no |
| 24 | **Fixtures and captures**: add surfaces for the "needs fixture" lists (Appendix B, per area: thread/pins/bell/command/delete-confirm; profile popover/modal/editor/avatar; focused stage/tray/room/DM call/call modals/audio menus; server/channel/room/camera settings/create\*/updater; pickers/share/pin/reaction/upload/image viewer/embeds/activities; `/activate` signed-in states, `/invite` signed-in states, `/share` after the `message_shares` migration, DesktopLogin, room lobby); fix `OverlayFixture` so the reconnect copy renders; `SettingsFixture` desktop at 390 (gate Tauri calls on `env.desktop`); re-shoot the failed captures; re-audit search, shop, collectibles pickers and the Base UI drawer | UiFixtures.tsx, ui-fixtures route, fixture D1 | all "needs fixture" rows, ST-25, PK-35 | no |
| 25 | **WIP-owned changes** (for the user to land inside their branch): `UserPanel.tsx` (54 hits: `./Icons` SVGs -> `<Icon state>`, `aria-label` on mic/deafen/caret, muted = danger tint, stock `Tooltip`, `rounded-[10/12px]` -> tokens, 24 hovers, 6 `transition-all`, `duration-500`, hex/palette), `DMCallRegion.tsx` (safe areas, dock, green token, z-40, zinc), `ChatPageClient.tsx` (voice text-chat panel scrim/z, `sm:`), `useChatPageLogic.ts:190` (`innerWidth < 1024`), `SharedMessagePage.tsx` (unit 17/21 notes), `src/lib/voice/**` and `realtime/**` (no UI findings) | 5 files | SH-24, VC-03 part, VC-12 part, AU-16/18/20/21 | **yes** |

Suggested order: 1 -> 2/3/4/5/6 (codemods, one commit each, checker delta in
the message) -> 7/8/9 (overlays) -> 10/11 (rows and phone pages) -> 12
(voice) -> 13/14 (touch) -> 15 (settings) -> 16 -> 17 -> 18/19/20 -> 21/22 ->
23 -> 24. Units 7-22 are independent of each other once 1 has landed.

---

## 7. Decisions needed from the user

1. **Live camera/share fill in the voice dock.** The lab decision says one
   solid fill per view and "only Leave is solid red"; the code paints camera-on
   and sharing as solid accent (two solids + Leave; four with the sidebar
   dashboard). Options: (a) tint + Fill glyph for live (recommended, matches
   1.1/1.3), (b) solid accent on share-live only, never in VoiceDashboard.
2. **Settings row label size.** Code: `text-ui-base` (15); 12.6: `text-ui-sm`
   (13). The screenshots read well at 15 with 13px descriptions; amend 12.6
   to 15/13 or change the code before migrating server/channel/room settings.
3. **Phone settings page header.** Code: `h-14`, `text-ui-xl`, `IconButton sm`;
   12.2: 48px, `text-ui-md`, `size="md"`. Pick one; 4.1 currently lists the
   settings heading as `text-ui-xl`.
4. **Auth card.** 12.15 says `rounded-xl border p-6 max-w-[420px]`; the shipped
   sign-in is a flat 380px column with no card, and DesktopLogin titles use
   the serif at 30px while web `/activate` uses Figtree 24px. Keep the flat
   column (amend 12.15) or add the card; either way unify the title face/size.
5. **Menu radius** 10 (current `MENU_PANEL`) vs 12 (`rounded-lg`, this
   document's pick).
6. **Theme default for signed-out visitors**: `"system"` instead of `"dark"`
   so light/miku/spiderman users see the auth pages in their scheme.
7. **miku-light `--rm-on-accent`** is white on `#00a399` (3.1:1); either
   deepen the fill (as `--rm-accent-solid` already does) for every consumer or
   switch the ink to dark.
8. **`sm:` purge scale.** 268 sites; HomePageClient (marketing) and
   VoiceDebugScreen account for 56. Replace everywhere (`md:`/container
   queries) or allowlist marketing.
9. **`--rm-dur-4`** 320 -> 280 (and the 1.2s `rm-loading-exit` stays, with an
   allowlist reason).

---

## 8. Superseded by merged branches (re-check after the next capture)

- `SearchPanel.tsx` findings SH-51, PK-38, inventory rows 66-72: replaced by
  `ui/search` (`src/components/chat/search/*`). Checker on the new files: 3
  hits in `SearchPanel.tsx`, 2 in `search/SearchResultItem.tsx`.
- `ShopView.tsx` / `CollectiblesCatalogModal.tsx` findings PK-09, PK-10 (shop
  row), PK-38, inventory rows 243-248: replaced by `ui/shop`
  (`ShopView.tsx` rewrite, `src/components/chat/collectibles/*`). Checker:
  `ShopView.tsx` 6 hits (was 168); `CollectiblesCatalogModal.tsx` gone.
- Drawer internals SH-20 (whole-sheet focus ring), PR-36 (profile sheet
  `h-dvh` overrides, accent stroke on the top edge), PK shared-cause 2
  (inner-scroll items): `ui/drawer` moved to Base UI Drawer and reports those
  fixed. `drawer.tsx` has 0 checker hits. The drawer anatomy rules (12.9)
  were written against the vaul version; verify handle size, `pb-[max(16px,
safe-area)]`, `max-h-[calc(100dvh-24px)]` and the 280ms motion on the new
  primitive.
- `ui/dialog.tsx` close button: `ui/shop` made it absolutely positioned
  again, so findings that cite a drifting close button inside
  `DialogContent` are resolved; custom close buttons in InviteModal,
  UploadSoundModal, ExternalLinkConfirmModal, AvatarPickerModal remain.

---

## Appendix B. Area reports

Six reviewer reports, verbatim apart from: finding IDs prefixed by area
(SH shell, PR profiles, VC voice, ST settings, PK pickers/modals/activities,
AU auth/public); headings demoted one level; paths left as the reviewer wrote
them (relative to `src/components/` or `src/` as stated at the top of each
report). Supersession tags added where a merged branch replaced the code.

### Chat shell (SH)

> Superseded: SH-20 (drawer focus ring) and SH-51 (search pill) — `ui/drawer` and `ui/search` are merged; re-check.

Scope: shell, shell-empty, shell-dm, no-channel, mobile, mobile-sidebar, mobile-home-{servers,messages,notifications,you (tab bar only)}, menus (ContextMenu + InviteModal), drawer, action-sheet. Rules are cited from `docs/design-system.md`. Paths are relative to `F:\dev\TS\CLOUDFLARE\ralph-meet-quietpro\src\components\`. Screenshots are 2x DPR, so every px value below is CSS px.

**Capture failures (re-run before trusting the scores):**

- `shell-empty-390-dark.png` shows a Vite "Network connection lost" overlay.
- `action-sheet-390-dark`, `action-sheet-390-light`, `action-sheet-768-dark`, `shell-dm-768-light` and `mobile-sidebar-768-light` are blank.
- Because of this, the action sheet at phone width is scored from code only. `action-sheet-768-light` rendered the desktop ContextMenu instead.

#### Inventory

| View                               | How to reach               | Fixture                                    | Screens checked                                                              | Score 0-4 | Top issues (max 3, short)                                                                                                                                                                       |
| ---------------------------------- | -------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop channel shell              | open a text channel ≥768   | shell                                      | shell-1280-dark/light, shell-768-dark/light                                  | 2         | channel rows are 33px with an 18px drag-handle indent; typing pill covers the list and a 24px band above the composer stays empty; header icons are 2px apart and the pin badge is solid accent |
| Channel sidebar list               | server selected            | shell, mobile-sidebar, mobile-home-servers | shell-1280-dark, mobile-sidebar-390-dark/light, mobile-home-servers-390-dark | 2         | category header tap target is 13px; four different left edges (8/16/24/41px); voice participant avatars render square                                                                           |
| Server rail                        | always, left               | shell, mobile-home-servers                 | shell-1280-dark/light, mobile-home-servers-390-dark                          | 3         | hover changes tile shape from full to 16px; glow shadows on active tiles; hand-rolled z-150 DM tooltip                                                                                          |
| Phone channel members page         | tap channel title on phone | shell/shell-empty/shell-dm @390            | shell-390-dark/light, shell-empty-390-light                                  | 2         | header is 64px not 48; each member is a separate card (65px rows); tabs are 21px tall and the last one is clipped                                                                               |
| Desktop member list panel          | members toggle             | shell @768/1280                            | shell-1280-dark/light, shell-768-dark                                        | 2         | below lg it is a hand-rolled z-20 overlay; rows are 44px and names 13px; offline rows use opacity-60 with bare hover                                                                            |
| Empty channel welcome              | new channel                | shell-empty                                | -1280-dark/light, -768-dark, -390-light                                      | 1         | Instrument Serif title; 72px rounded-xl tile with shadow and text-white; body copy in muted                                                                                                     |
| DM conversation + DM sidebar       | Home → DM                  | shell-dm                                   | -1280-dark/light, -768-dark, -390-dark/light                                 | 2         | serif DM title; DM sidebar header is 53px, 5px off the main header line; selected DM row has a shadow; placeholder reads "Message #Ada Lovelace"                                                |
| No channel selected                | no channel                 | no-channel                                 | all 6                                                                        | 1         | serif title; icon sits in a bordered card with a shadow; phone header has no safe-area top                                                                                                      |
| Phone conversation                 | channel <768               | mobile                                     | mobile-390-dark/light, -768-dark/light                                       | 3         | reactions are 28px with no HIT; title button is 29px with no HIT; about 48px of empty space under link embeds                                                                                   |
| Phone Messages tab                 | tab bar                    | mobile-home-messages                       | -390-dark/light, -768-dark                                                   | 2         | desktop DMSidebar reused as-is: rows, avatars and search are 32px with no HIT; no page header                                                                                                   |
| Phone Notifications tab            | tab bar                    | mobile-home-notifications                  | -390-dark/light                                                              | 3         | header is 56px; snippet at muted/80 and timestamp at muted/50 fail contrast; avatars are 32 not 40                                                                                              |
| Phone tab bar                      | phone home                 | mobile-home-you                            | -390-dark/light + other tabs                                                 | 4         | on-system                                                                                                                                                                                       |
| Context menu                       | right-click                | menus, action-sheet @768                   | menus-1280-dark, menus-768-light, action-sheet-768-light                     | 3         | MENU_PANEL uses rounded-[10px] and a hand-rolled shadow; MENU_ICON uses bare group-hover; focus ring shows on pointer open                                                                      |
| InviteModal                        | server menu → Invite       | menus                                      | menus-1280-dark, -768-light, -390-dark/light                                 | 2         | field labels are uppercase eyebrows; custom 40px close button shows a ring on open; on phone the selects are 36px and the button 40px                                                           |
| Bottom drawer                      | phone invite               | drawer                                     | drawer-390-dark/light, -768-light                                            | 3         | the whole sheet shows a focus ring (superseded by ui/drawer)                                                                                                                                    |
| Action sheet                       | long-press                 | action-sheet                               | capture failed; code                                                         | 3 (code)  | icon slot forces 20px glyphs; fixture capture failed                                                                                                                                            |
| User panel / voice dock (user WIP) | sidebar bottom             | shell                                      | shell-1280-dark/light, shell-dm-768-dark                                     | 1         | legacy `./Icons` SVGs; mic/deafen/caret buttons have no accessible name; palette/hex colours, bare hover, restyled tooltips, rounded-[10/12px]                                                  |
| App title bar                      | top strip ≥md              | shell                                      | shell-1280-dark, shell-768-dark                                              | 2         | back/forward are 24px with no HIT on coarse tablets; text glyphs instead of Icon; 700 weight                                                                                                    |
| Thread sidebar                     | message → thread           | none                                       | code                                                                         | 1         | needs fixture                                                                                                                                                                                   |
| Pinned messages panel              | header pin                 | none                                       | code                                                                         | 1         | needs fixture                                                                                                                                                                                   |
| Notification bell popover          | header bell                | none                                       | code                                                                         | 1         | needs fixture                                                                                                                                                                                   |
| Command menu                       | Ctrl+K                     | none                                       | code                                                                         | 3         | needs fixture                                                                                                                                                                                   |
| Unread banner                      | unreads                    | none                                       | code                                                                         | 2         | needs fixture                                                                                                                                                                                   |
| Delete-message confirm             | message → delete           | none                                       | code                                                                         | 1         | needs fixture                                                                                                                                                                                   |
| ChannelInviteModal                 | channel → invite           | none                                       | code                                                                         | 2         | needs fixture                                                                                                                                                                                   |
| Member detail tabs                 | phone members tabs         | none                                       | code                                                                         | 1         | needs fixture                                                                                                                                                                                   |
| Voice channel status/media         | voice in use               | none                                       | code                                                                         | 1         | needs fixture                                                                                                                                                                                   |
| Read-only composer                 | no send permission         | none                                       | code                                                                         | 2         | needs fixture                                                                                                                                                                                   |

#### Findings

#### P1

- **SH-01 [P1] Empty channel / DM welcome / No channel**
  - Where: `chat/ChatWelcomeContent.tsx:46`, `:90`; `chat/EmptyChatArea.tsx:37`
  - Rule: 4.4 (display face never inside the chat shell), 14.1
  - Screenshots: `shell-empty-1280-dark.png`, `shell-dm-1280-dark.png`, `shell-dm-390-dark.png`, `no-channel-390-dark.png`, `no-channel-768-light.png`
  - What: "Welcome to #brand-new", the DM recipient name and "No channel selected" all use `font-display text-display` (Instrument Serif, 36px).
  - Fix: channel and DM welcome titles become `text-ui-xl font-semibold text-rm-text text-balance`. The no-channel title becomes `text-ui-lg font-semibold`; `md:text-ui-2xl` is allowed on wide screens.

- **SH-02 [P1] Hand-rolled overlays (pins, members on tablet, thread on phone, bell, command menu, delete confirm)**
  - Where: `chat/ChatArea.tsx:317-343`, `:433-437`; `chat/MemberList.tsx:556-561`; `chat/ThreadSidebar.tsx:169`; `chat/NotificationBell.tsx:104-127`; `CommandMenu.tsx:158-175`; `chat/MessageItem.tsx:1671-1690`
  - Rule: 13.1, 11.1, 11.2, 6.5, 6.3
  - Screenshot: `shell-768-dark.png`; the rest is code only
  - What:
    - Pins overlay is `absolute inset-0 z-50` inside the column, with a `bg-rm-bg-primary/50` scrim, `backdrop-blur-sm` and `sm:justify-end`.
    - Member list below lg is a `fixed z-20` panel with its own `fixed inset-0 z-20` scrim.
    - Thread on phone is `max-md:fixed inset-0 z-20`.
    - Bell is `fixed inset-0 z-50` inside the header, with `bg-black/60 backdrop-blur-[2px]`, `h-[85vh]` and a 48x6 handle.
    - CommandMenu and the delete confirm each build their own scrim.
  - Fix:
    - Pins, members (md to lg) and thread use `Sheet side="right"` at 360px on desktop and `Drawer direction="right"` below md.
    - Bell uses `PickerSurface`.
    - Delete confirm uses `ResponsiveDialog`.
    - CommandMenu is hosted in `Dialog` + `DialogSurface`.
    - Remove the local scrims, z-values and Escape handlers.

- **SH-03 [P1] Channel sidebar category header on phone**
  - Where: `chat/ChannelSidebar.tsx:1937-1950`; "Create channel" at `:1964-1975`
  - Rule: 9.1
  - Screenshots: `mobile-sidebar-390-dark.png`, `mobile-home-servers-390-dark.png`; diag `Collapse Information 292x13`
  - What: `pointer-coarse:min-h-11` sits on the wrapper div, but the collapse `<button>` is 13px tall, so the tappable strip on the main phone nav is 13px. "Create channel" is 20x20 with no HIT.
  - Fix: move the min-height onto the button (`pointer-coarse:min-h-11` + `HIT`). Use `IconButton size="xs"` for create.

#### P2

- **SH-04 [P2] Channel row anatomy**
  - Where: `chat/ChannelSidebar.tsx:453`, drag handle at `:476`
  - Rule: 12.3, 2.4, 13.3
  - Screenshots: `shell-1280-dark.png`, `mobile-home-servers-390-dark.png`; diag `206x33`
  - What:
    - Rows are `mx-2 px-2 py-1.5 gap-1.5`, which renders 33px. The rule is `h-8 px-2 gap-2.5`.
    - For managers, the invisible drag handle always takes width, so `#` sits 45px from the sidebar edge while category labels sit at about 11px.
    - On phone the left edges are 8 (chevron), 16 (row fill), 24 (row icon) and 41 (voice participant).
    - The icon is dimmed with `opacity-60` and has no fixed slot.
  - Fix:
    - Rows become `h-8 pointer-coarse:min-h-11 px-2 gap-2.5`; the list keeps `px-2` and the row drops `mx-2`.
    - The icon goes in a `size-5` slot with `text-rm-text-muted`.
    - The drag handle is absolutely positioned in the gutter so it takes no width.
    - Category headers use `px-2 pt-4 pb-1`, with `pt-2` on the first.

- **SH-05 [P2] Voice participant rows**
  - Where: `chat/ChannelSidebar.tsx:1736-1752`
  - Rule: 5.1, 12.13
  - Screenshots: `shell-1280-dark.png`, `mobile-sidebar-390-dark.png` (the "A"/"G" tiles are square)
  - What:
    - The initial fallback has no radius and its parent is `overflow-visible`, so a square paints.
    - The avatar is `h-[24px] w-[24px]` and the name is `text-[14px]`.
    - Rows are 34px tall.
    - Speaking state is `ring-[3px] ring-primary` plus a glow shadow.
  - Fix: avatar `size-6 rounded-full overflow-hidden`; name `text-ui-base font-medium`; row `h-8 px-2 gap-2.5`; speaking state `ring-2 ring-rm-success ring-offset-2` with no shadow.

- **SH-06 [P2] DM sidebar header height**
  - Where: `chat/DMSidebar.tsx:134-150`
  - Rule: 3.3, 2.4, 9.1
  - Screenshots: `shell-dm-1280-dark.png`, `shell-dm-768-dark.png` (the sidebar hairline is about 5px below the main header's), `mobile-home-messages-390-dark.png`
  - What: 8 + `mt-1` + `h-8` + `mb-2` + 1px border = 53px. The search button has no `type`, no HIT (365x32 on coarse) and `px-3`.
  - Fix: `flex h-12 items-center px-2 border-b`, plus safe-area top. Use an `h-8 w-full` button with `HIT` and `type="button"`.

- **SH-07 [P2] DM list rows**
  - Where: `chat/DMListPanel.tsx:90-95`, `:112`, `:143-151`; `chat/DMSidebar.tsx:154-185`
  - Rule: 12.3, 1.2, 9.1
  - Screenshots: `shell-dm-1280-dark.png`, `mobile-home-messages-390-dark.png`
  - What:
    - The selected row is `bg-rm-bg-elevated shadow-sm`.
    - Name is `text-ui-sm`, status `text-ui-2xs`, avatar initial `text-xs font-bold`.
    - Friends/Shop each sit in their own `px-2 pt-2` wrapper, so they are 8px apart; they use `lg` icons and `active:scale-[0.98]`.
    - Everything is 32px with no HIT on phone.
  - Fix:
    - Selected `bg-rm-tint-2` with no shadow.
    - Name `text-ui-base font-medium`; status `text-ui-xs text-rm-text-secondary`.
    - `md` icons in a `size-5` slot, one list with `gap-0.5`, `PRESS`.
    - Phone rows per SH-10.

- **SH-08 [P2] Header icon gap and pin badge**
  - Where: `chat/ChatHeader.tsx:186`, `:219`
  - Rule: 12.1, 13.6
  - Screenshot: `shell-1280-dark.png` (blue "1" next to red "2", buttons 2px apart)
  - What: `gap-0.5` between buttons. The pin count overrides `badge-count` with `bg-primary`.
  - Fix: `gap-2`. Use `Badge` tint (`bg-rm-accent-tint text-rm-accent-ink`) or plain `badge-count`.

- **SH-09 [P2] Typing indicator vs composer band**
  - Where: `chat/ChatArea.tsx:398`; `chat/ChatTypingIndicator.tsx:13`
  - Rule: 2.2, 2.4, 3.8
  - Screenshots: `mobile-390-dark/light.png`, `shell-1280-light.png`
  - What: `pt-6` reserves 24px, but the pill is `absolute bottom-full mb-1.5`, so it renders over the last 34px of the list and the reserved band stays empty. It is inset `left-5` (20px), which matches neither the 16px inset nor the 72px text column, and it is a bordered `shadow-sm` chip on a non-floating surface.
  - Fix: render the pill inside the band (`absolute top-0 left-4 h-6`), make the band `h-6`, and drop the border and shadow.

- **SH-10 [P2] Phone Messages tab**
  - Where: `chat/mobile/MobileMessagesTab.tsx:34-41`
  - Rule: 12.2, 12.4, 9.1
  - Screenshot: `mobile-home-messages-390-dark.png`
  - What: the desktop `DMSidebar` is mounted at desktop density with no page header. The four tabs use three different header treatments.
  - Fix: add a phone variant with a 48px header ("Messages", `text-ui-md font-semibold`), a `min-h-11` search field, and 12.4 rows (`min-h-12 px-4 gap-3`, 40px avatar).

- **SH-11 [P2] Phone members page header and rows**
  - Where: `chat/MemberList.tsx:744-770`, `:1913-1925`, `:985-1004`
  - Rule: 12.2, 12.4, 2.1, 1.1
  - Screenshots: `shell-390-dark/light.png`
  - What:
    - The header is 8 + `IconButton size="lg"` (48) + 8 = 64px.
    - Each member is a card (`bg-rm-bg-elevated px-3.5 py-3 mb-2 rounded-lg border`): 65px rows, 8px apart.
    - "Invite Members" uses a solid `bg-primary` icon disc.
    - Offline rows apply opacity and grayscale to the whole card.
  - Fix:
    - Header `h-12 px-4` + safe area, with `size="md"` buttons.
    - One `rounded-lg bg-rm-tint-1 divide-y` group per role, rows `min-h-12 px-4 gap-3`.
    - Tinted invite icon.
    - Dim only the text of offline members.

- **SH-12 [P2] Phone members tabs**
  - Where: `chat/MemberList.tsx:883-886`, `:950-969`
  - Rule: 13.5, 9.1, 9.4, 4.2
  - Screenshot: `shell-390-dark.png` ("Fil" clipped); diag `Pins 28x21`
  - What: hand-rolled tabs, 21px tall, all `font-semibold`. The indicator is `bg-primary` at `-bottom-[11px]`, the focus ring is custom, and the clipped last tab has no affordance.
  - Fix: use `Tabs` with `pointer-coarse:min-h-11`, 500/600 weights, a trailing fade mask and the global focus ring.

- **SH-13 [P2] Desktop member rows**
  - Where: `chat/MemberList.tsx:1913-1925`, `:1950`, `:1989`, `:2037`
  - Rule: 12.3, 13.3, 9.3, 7.4
  - What: `py-1.5` + 32px avatar = 44px rows. Names are 13px (`md:text-ui-sm`). Status is `text-ui-2xs`. Offline rows use `opacity-60 hover:opacity-100` (bare hover), which drops contrast below 4.5:1.
  - Fix: `h-10 px-2 gap-2.5`, `text-ui-base font-medium`, `text-ui-xs`, muted text for offline without opacity, and `pointer-fine:` hover.

- **SH-14 [P2] Message row targets**
  - Where: `chat/MessageItem.tsx:1271`, `:1329`, `:947`
  - Rule: 9.1, 9.2, 9.3, 7.4
  - Screenshot: `mobile-390-dark.png`; diag `56x28`, `333x24`
  - What: reaction pills are `h-7` with no HIT and press scale 0.96. Add-reaction is forced to `h-7 w-7`. The reply connector is 24px at `opacity-60` with bare `hover:`.
  - Fix: add `HIT`, use `PRESS`, and make the connector `text-rm-text-muted` without opacity.

- **SH-15 [P2] Phone header title button**
  - Where: `chat/ChatHeader.tsx:106-131`
  - Rule: 9.1, 9.3, 4.1
  - Diag: `94x29`
  - What: 29px with no HIT, bare `hover:opacity-80`, no `type`, and "6 Members" in `text-ui-2xs`.
  - Fix: `HIT` + `pointer-fine:` hover + `type="button"` + `text-ui-xs`.

- **SH-16 [P2] Empty space under link embeds**
  - Where: `chat/VirtualMessageList.tsx:257`
  - Rule: 2.2, 12.12
  - Screenshots: `mobile-390-dark.png` (about 48px), `shell-1280-dark.png` (about 60px)
  - What: every row gets `style={{ minHeight }}` from the estimated height. When an embed renders shorter than the estimate, the leftover shows as empty space.
  - Fix: pass the estimate only as the virtualizer's `itemSize`, or clear `minHeight` after the row is measured.

- **SH-17 [P2] No-channel empty state anatomy**
  - Where: `chat/EmptyChatArea.tsx:8`, `:9-18`, `:19`, `:34-35`
  - Rule: 14.1, 1.2, 6.2, 3.6, 12.1, 12.2
  - Screenshots: `no-channel-1280-dark.png`, `no-channel-768-light.png`, `no-channel-390-dark.png`
  - What:
    - A 24px icon sits in a bordered `shadow-sm` 48px card.
    - The header has no safe-area top.
    - The title is `text-ui-sm font-medium text-rm-text-muted`.
    - The phone menu button is `size="sm"`.
  - Fix: bare `<Icon size="3xl">` (2xl on phone) in muted, header height `calc(48px + safe-area-top)`, title `text-ui-md font-semibold text-rm-text`, `size="md"` button.

- **SH-18 [P2] Welcome tile and DM avatar**
  - Where: `chat/ChatWelcomeContent.tsx:32`, `:82`, `:87`, `:55-58`, `:71`
  - Rule: 5.1, 1.2, 6.1, 7.1, 4.3, 2.1
  - What: the tile is `h-[72px] rounded-xl border shadow-sm` with `text-white drop-shadow-[…rgba]`. The avatar has `shadow-md`. Body copy is muted. Spacing uses `mb-5`/`mt-5`.
  - Fix: `rounded-lg` with no shadow, a token glyph colour, `text-rm-text-secondary` body, and `mb-4`/`mt-4`.

- **SH-19 [P2] InviteModal form**
  - Where: `chat/InviteModal.tsx:116-119`, `:148-151`, `:96-101`, `:91-92`, `:178-186`
  - Rule: 13.4, 4.7, 12.8, 12.9, 9.1
  - Screenshots: `menus-1280-dark.png`, `menus-390-dark.png`
  - What:
    - Field labels are uppercase eyebrows.
    - `showCloseButton={false}` plus a custom 40px `IconButton` at `right-4 top-4`; it takes focus and shows the ring on pointer open.
    - `max-w-[440px]` is set but it renders 512px.
    - On phone the selects are 36px and the button 40px.
  - Fix:
    - Use `<Label>` for the field labels.
    - Use the stock close button (`size-8 top-3 right-3`) and focus the first select on open.
    - Width `md:max-w-md`.
    - `max-md:min-h-11` on the selects and the button.

- **SH-20 [P2] Drawer focus ring (superseded by ui/drawer)**
  - Where: `ui/drawer.tsx:444`
  - Rule: 9.4
  - Screenshots: `drawer-390-dark.png`, `drawer-768-light.png`, `menus-390-dark.png`
  - What: the content is focused programmatically on open, so the global focus ring outlines the whole sheet.
  - Fix: focus the title or first field instead, or suppress the ring on the popup only.

- **SH-21 [P2] Unread banner (needs fixture)**
  - Where: `chat/UnreadBanner.tsx:28`, `:40-42`
  - Rule: 1.1, 7.2, 4.1
  - What: a solid `bg-primary` strip at `mx-2 mt-1`; the `xs` button is forced to `text-ui-sm`.
  - Fix: `mx-4 h-8 rounded-md bg-rm-accent-tint text-rm-accent-ink`.

- **SH-22 [P2] GIF favorite notice (needs fixture)**
  - Where: `chat/InputControls.tsx:84`, `:99`
  - Rule: 7.1, 4.1, 4.2, 6.1, 11.2
  - What: yellow palette classes, `text-xs font-bold shadow-2xl z-50` inside the composer, and a pulsing yellow ring.
  - Fix: use `toast()`, or a hint styled with `text-rm-warning-ink`.

- **SH-23 [P2] Legacy selection tokens in lists**
  - Where: `chat/ChannelSidebar.tsx:455-456`, `chat/DMSidebar.tsx:157/175`, `chat/DMListPanel.tsx:93-94`, `chat/MemberList.tsx:1921-1922`, `chat/MessageItem.tsx:933`
  - Rule: 12.3, 7.2, 7.3
  - What: rows use `bg-rm-bg-active`/`bg-rm-bg-hover`. In the spiderman themes these are red-tinted (`rgba(229,9,20,…)`), so a selected channel reads as danger.
  - Fix: `bg-rm-tint-2` for selected, `pointer-fine:hover:bg-rm-tint-1` for hover.

- **SH-24 [P2] User panel (user WIP, flag only)**
  - Where: `chat/UserPanel.tsx:46`, `:567-650`, `:386-387`, `:483`, `:577`, `:693`, rounded-[N] sites, tooltip sites
  - Rule: 8.1, 8.4, 12.13, 7.1, 9.3, 13.7, 5.1, 10.2
  - Diag: unnamed `button""` 30x30 and 16x16
  - What:
    - Uses legacy `./Icons` SVGs that swap glyphs instead of changing state.
    - Mic/deafen/caret buttons have no `aria-label`, so they are announced without a name.
    - Muted state uses `text-red-300` and hex values.
    - Bare `hover:` throughout, `transition-all`, restyled tooltips, `text-[13px] font-bold`.
  - Fix:
    - `<Icon state="off" size="xl">` in 12.13 dock buttons, with an `aria-label` on each.
    - Muted state `bg-rm-danger-tint text-rm-danger-ink`.
    - Stock `Tooltip`.
    - Token radii and text sizes.

- **SH-25 [P2] Rail DM tooltip**
  - Where: `chat/ServerList.tsx:279`
  - Rule: 13.7, 11.1, 9.3
  - What: a hand-rolled `fixed left-[80px] z-150 … group-hover:opacity-100` tooltip.
  - Fix: use `Tooltip side="right"`, as the server tiles already do.

- **SH-26 [P2] Thread composer (needs fixture)**
  - Where: `chat/ThreadSidebar.tsx:311-330`
  - Rule: 4.6, 13.2, 9.7, 7.4
  - What: the input is `text-sm` (14px), which triggers iOS zoom. The placeholder is muted/30. Send is a hand-made `bg-primary text-xs font-bold disabled:opacity-30` button.
  - Fix: reuse the composer recipe with `max-md:text-ui-md` and `Button size="sm"`.

- **SH-27 [P2] Delete-message confirm (needs fixture)**
  - Where: `chat/MessageItem.tsx:1689-1760`
  - Rule: 12.8, 13.2, 7.1, 7.3, 4.7
  - What: title `text-lg font-bold`, `max-w-[480px]`, an uppercase `text-emerald-400` "Protip", and hand-rolled buttons with `bg-destructive text-white`.
  - Fix: `ResponsiveDialog md:max-w-sm` with `Button variant="secondary"` and `Button variant="danger"`.

- **SH-28 [P2] Notification rows**
  - Where: `chat/NotificationBell.tsx:337`, `:343`, `:282`, `:297`
  - Rule: 7.4, 7.2, 12.4
  - Screenshot: `mobile-home-notifications-390-dark.png`
  - What: the snippet is muted/80 (about 43% opacity) and the timestamp muted/50 (about 27%). Unread rows use `bg-rm-accent/5`. Avatars are 32px.
  - Fix: `text-rm-text-secondary` snippet, `text-rm-text-muted` timestamp, `bg-rm-accent-tint` unread, `size-10` avatars.

- **SH-29 [P2] Pinned messages panel (needs fixture)**
  - Where: `chat/PinnedMessagesSidebar.tsx:54`, `:56-60`, `:84`, `:90`
  - Rule: 3.1, 3.3, 3.4, 12.10, 6.3, 14.1, 14.2
  - What:
    - `sm:` breakpoints and `100vh`.
    - Width `sm:w-[420px]`.
    - Header `min-h-16 px-6` with `backdrop-blur-md`.
    - Title `font-bold text-lg`.
    - Empty state is a rotated `rounded-3xl shadow-xl` card.
  - Fix: Sheet anatomy per 12.10, empty state per 14.1, and a `Spinner` for loading.

#### P3

- **SH-30 Bare hover (9.3)**
  - Sites:
    - `chat/ChatHeader.tsx:107`
    - `chat/ChannelSidebar.tsx:476, 503, 512, 521, 540` (plus 297/317, which are `md:group-hover`)
    - `chat/MemberList.tsx:1246, 1596, 1924, 1950, 1995`
    - `chat/MessageItem.tsx:947, 994, 1012`
    - `chat/PinnedMessagesSidebar.tsx:274`
    - `chat/ServerList.tsx:240, 279, 293, 522, 523`
    - `chat/UserPanel.tsx:483, 577-581, 598, 634-635, 693-697, 711, 741-742, 791-792, 804`
    - `ui/menu.ts:32` (`MENU_ICON`)
  - Fix: prefix with `pointer-fine:`.

- **SH-31 Hand-rolled or non-floating shadows (6.1, 1.2)**
  - Hand-rolled:
    - `chat/ServerList.tsx:225, 263, 357, 387`
    - `chat/ChannelSidebar.tsx:263, 1740`
    - `chat/MessageItem.tsx:1274, 1375`
    - `chat/ChatWelcomeContent.tsx:87`
    - `chat/UserPanel.tsx:494`
    - `CommandMenu.tsx:175` (use `shadow-2xl`)
    - `ui/menu.ts:12` (use `shadow-lg`)
  - On non-floating surfaces:
    - `chat/DMListPanel.tsx:93`
    - `chat/EmptyChatArea.tsx:34`
    - `chat/ChatWelcomeContent.tsx:32, 82`
    - `chat/ChannelSidebar.tsx:1029`

- **SH-32 Dead `backdrop-blur` (6.3):** `chat/ChatArea.tsx:331`, `chat/ChannelSidebar.tsx:297, 317`, `chat/MemberList.tsx:1707, 1736`, `chat/PinnedMessagesSidebar.tsx:56`, `chat/NotificationBell.tsx:108`.

- **SH-33 Off-ladder z-index (11.1, 11.2)**
  - `chat/ServerList.tsx:279`: z-150
  - `chat/ChannelSidebar.tsx:1832`: z-40, should be 30
  - `chat/MemberList.tsx:1706, 1735`: z-5
  - `chat/ContextMenu.tsx:446`: submenu z-80, should stay 70
  - In-panel z-50: `chat/InputControls.tsx:84`, `chat/ChatArea.tsx:319`, `chat/NotificationBell.tsx:105`

- **SH-34 Type sizes (4.1)**
  - Tailwind or arbitrary sizes:
    - `chat/ChannelInviteModal.tsx:166, 199, 203, 226, 233, 259`
    - `chat/DMListPanel.tsx:112`
    - `chat/InviteModal.tsx:216`
    - `chat/ChannelSidebar.tsx:1029, 1037, 1761`
    - `chat/MessageItem.tsx:211, 260, 270, 628, 814, 994, 1288, 1299, 1699, 1705, 1738, 1752, 1759`
    - `chat/MemberList.tsx:1093, 1567` (`text-[7px]`), `1787`, `1950`
    - `chat/PinnedMessagesSidebar.tsx:60, 156, 185`
    - `chat/ServerList.tsx:275, 418, 451`
    - `chat/UserPanel.tsx:491, 521, 525, 537, 548, 605, 654, 718, 761, 811`
    - `chat/ThreadSidebar.tsx:179, 180, 209, 323, 328`
    - `CommandMenu.tsx:205`
    - `CommandMenuGroups.tsx:75` (`text-[9px]`)
  - Meta at `text-ui-2xs` that should be `text-ui-xs`:
    - `chat/MessageItem.tsx:1013, 1062, 1236`
    - `chat/ContextMenu.tsx:389-391`
    - `chat/DMListPanel.tsx:151`
    - `chat/ChannelSidebar.tsx:503`

- **SH-35 Radii (5.1, 5.3)**
  - Off-scale values:
    - `ui/menu.ts:12` (`rounded-[10px]`)
    - `chat/UserPanel.tsx:460, 482, 574, 628, 690, 735, 789`
    - `CommandMenuGroups.tsx:22` (`rounded-[5px]`)
  - `rounded-xl` on cards that should be `rounded-lg`:
    - `chat/MemberList.tsx:1204, 1285, 1358, 1430, 1527, 1633, 1797`
    - `chat/ThreadSidebar.tsx:209, 311`
    - `chat/ChatArea.tsx:411`
    - `chat/ChannelSidebar.tsx:263`
  - Rail tiles morph from `rounded-full` to `rounded-xl` on hover (rule is `rounded-lg`): `chat/ServerList.tsx:223, 355, 531`

- **SH-36 Palette / hex (7.1)**
  - `chat/InputControls.tsx:84, 99`
  - `chat/ChannelSidebar.tsx:1765`: LIVE badge `bg-[#ed4245]`, should be `bg-rm-danger text-rm-on-danger rounded-xs px-1`
  - `chat/MessageItem.tsx:1739, 1759`
  - `chat/UserPanel.tsx:386-387, 483, 577, 693`
  - `chat/NotificationBell.tsx:108`: use `bg-rm-scrim`
  - Themed banner at `chat/ChannelSidebar.tsx:1028-1048`: add an allowlist entry if intentional.

- **SH-37 Press scale below 0.97 (9.2):** `chat/ServerList.tsx:223, 261, 355, 531`, `chat/ChannelSidebar.tsx:1738`, `chat/MessageItem.tsx:252, 1271`, `chat/DMSidebar.tsx:157, 175`, `chat/MemberList.tsx:985`, `chat/UserPanel.tsx:483`. Fix: use `PRESS`.

- **SH-38 Width/height animation (10.2)**
  - `chat/InputControls.tsx:159-165`: send button animates from w-0 to w-8
  - `chat/ServerList.tsx:240, 293, 522`: rail pill animates height
  - `chat/UserPanel.tsx`: `transition-all` at 6 sites

- **SH-39 Title roles and a dead class**
  - `chat/ChatHeader.tsx:153, 165`: titles are `text-ui-base`, should be `text-ui-md font-semibold`
  - `chat/ChannelSidebar.tsx:1060-1063`: server name is `text-ui-base`
  - `chat/ChatHeader.tsx:89`: phone `px-2.5`, should be `px-4`
  - `chat/ChatHeader.tsx:101, 256`: `size="sm"` plus an `h-10 w-10` override, should be `size="md"`
  - `chat/ChatHeader.tsx:135`: conflicting `pl-1 px-2` and `-ml-2`
  - `text-rm-text-primary` has no `@theme` mapping, so it generates no CSS: `chat/ChatHeader.tsx:153, 165`, `chat/ChatWelcomeContent.tsx:46, 90`, about 10 sites in `chat/MemberList.tsx`, `chat/ServerList.tsx:223, 531`, `chat/UserPanel.tsx`. Use `text-rm-text`.

- **SH-40 Message row details (12.12, 4.7, 13.6)**
  - `chat/MessageItem.tsx:1026/1032`: name is `font-semibold`, should be `font-medium`
  - `:1035`: timestamp has `ml-0.5 mt-0.5` on top of the gap
  - `:1043-1046`: "PINNED" is uppercase with `bg-primary/10`; should be `Badge` tint, sentence case
  - `:1233`: filename is `text-primary`, should be `text-rm-accent-ink`
  - `:1273-1276`: reacted pill should use `bg-rm-accent-tint`
  - `:1060`: edit box body is `font-medium`

- **SH-41 Composer details (12.11, 8.3)**
  - `chat/MessageInput.tsx:142-147`: attach is a 28px `rounded-full` button with an `sm` icon; rule is `size-8` with `lg` (measured 28px)
  - `chat/InputControls.tsx:81`: `gap-0.5`, should be `gap-2`
  - `:173`: send icon is `sm`, should be `lg`
  - `chat/MessageInput.tsx:199`: `selection:bg-primary/30`, should use `--rm-selection`
  - `chat/MessageInput.tsx:182, 187`: DMs read "Message #Ada Lovelace"; drop the `#` when `isDM`

- **SH-42 Unread pills (12.3):** `chat/ChannelSidebar.tsx:558`, `chat/DMListPanel.tsx:107` are 4x8 and float about 10px inside the sidebar edge. Use a 2px pill flush with the edge.

- **SH-43 Context menu details (9.7, 12.7, 9.4)**
  - `chat/ContextMenu.tsx:362`: disabled rows are muted text plus opacity-45, so they are double-dimmed
  - `:312`: no `max-w-[280px]`
  - `:316-318`: `-mx-1` on the top content
  - `:446`: submenu `w-[210px] z-80`
  - `:136`/`:192`: clamp padding is 10, off the 4px grid
  - First row shows the focus ring on pointer open (`action-sheet-768-light.png`)

- **SH-44 App title bar (9.1, 8.1, 4.2)**
  - `chat/AppTitleBar.tsx:63`: `h-[24px]` should be `h-6`; border uses `/30`
  - `:67-82`: 24px buttons with no HIT; `&#8249;` text glyphs instead of Icon
  - `:31`: `font-bold`

- **SH-45 Notifications header (12.2)**
  - `chat/NotificationBell.tsx:179`: `h-14`, should be `h-12`
  - `:122`: handle is 48x6 `bg-rm-bg-hover`; rule is 36x4 `bg-rm-border-strong`

- **SH-46 Skeletons and scrollers (14.2, 3.7)**
  - `chat/VirtualMessageList.tsx:140-155`: skeletons use `bg-rm-bg-hover` and `h-3.5`; should be `bg-rm-tint-1 rounded-md`
  - No `overscroll-contain` on `chat/VirtualMessageList.tsx:1006-1016`, `chat/DMListPanel.tsx:56`, `chat/MemberList.tsx:580`

- **SH-47 Spacing (2.1, 2.5)**
  - `p-3.5`/`px-3.5`/`h-3.5`: `chat/MemberList.tsx:1285, 1358, 1430, 1527, 1915, 1964, 1977`, `chat/UserPanel.tsx:514`, `CommandMenu.tsx:194, 271`
  - `ml-7`: `chat/ChannelSidebar.tsx:568, 604, 649, 657, 676`
  - Negative margins: `chat/ChatHeader.tsx:135`, `chat/InputControls.tsx:164`, `chat/InviteModal.tsx:225`, `chat/MemberList.tsx:1982`, `chat/MessageItem.tsx:1716`, `chat/UserPanel.tsx:554`

- **SH-48 Rail token (7.2):** `chat/ServerList.tsx:214` and `chat/MobileNavigationSheet.tsx:79` use `bg-rm-bg-floating` (should be `bg-rm-server-bar`) and `w-[72px]` (should be `w-(--rm-size-rail)`).

- **SH-49 Action sheet (code)**
  - `ui/action-sheet.tsx:128`: forces 20px glyphs; `md` (18) is the step for 15px rows
  - `:86`: visible title is `text-ui-sm`
  - Otherwise matches 12.9

- **SH-50 Read-only composer (needs fixture):** `chat/ChatArea.tsx:410-413` uses `h-[44px] rounded-xl opacity-80`, a double inset on phone and `md:pb-6`.

- **SH-51 Search pill (superseded by ui/search):** `chat/ChatHeader.tsx:238-250` renders about 84px wide despite `w-[168px]`, and has no HIT at 768 coarse.

- **SH-52 Member detail tabs (needs fixture)**
  - Where: `chat/MemberList.tsx:1285-1800`
  - Cards are `rounded-xl p-3.5 bg-rm-bg-elevated`.
  - Labels use `font-bold`.
  - Spinners are custom.
  - The error tile is `rounded-2xl` with `text-[14px] font-bold`.
  - The jump action at `:1596` appears only on bare group-hover, so touch users cannot reach it.

- **SH-53 Voice status/media (needs fixture)**
  - Where: `chat/ChannelSidebar.tsx:263-330`, `:619-635`
  - Uses `sm:min-h-[108px]`.
  - Hover moves the controls (translate-y).
  - The media frame has an rgba shadow, and its buttons use blur.

#### Shared causes

- **Serif display face in the shell:** `ChatWelcomeContent`, `EmptyChatArea` (SH-01).
- **No overlay primitive:** `ChatArea`, `MemberList`, `ThreadSidebar`, `PinnedMessagesSidebar`, `NotificationBell`, `CommandMenu`, and the `MessageItem` delete dialog each implement their own scrim, z-index, blur, vh height and Escape handling (SH-02, SH-26, SH-27, SH-29). Moving them to Sheet/Drawer/ResponsiveDialog/PickerSurface fixes 6.3, 6.5, 11.x, 3.1, 3.4 and 13.1 at once.
- **Desktop lists reused on phone:** `DMSidebar` + `DMListPanel` (Messages tab) and `MemberList` (members page) ship at desktop density (SH-07, SH-10, SH-11). One phone row recipe (12.4) fixes all three.
- **No shared sidebar row recipe:** `ChannelSidebar`, `DMSidebar`, `DMListPanel` and `MemberList` use 4 paddings, 3 selected treatments and 2 pill geometries (SH-04, SH-05, SH-07, SH-13, SH-23, SH-42). A `SIDEBAR_ROW` constant in `ui/` would fix them together.
- **Legacy hover/active tokens:** `bg-rm-bg-hover`/`bg-rm-bg-active` appear 47 times across 12 files. They are red in the spiderman themes.
- **Raw `primary` alpha instead of accent tokens:** `MessageItem`, `ChannelSidebar:1750`, `MemberList:1289/1362/1433/1596`, `ChannelInviteModal:226`, `ChatHeader:219`.
- **Drift in `ui/menu.ts`:** the radius, shadow and `MENU_ICON` hover issues spread to every menu (SH-30, SH-31, SH-35). Fixing the primitive fixes them all.
- **Raw `<button>` without HIT:** `ChannelSidebar`, `MemberList`, `MessageItem`, `ChatHeader`, `AppTitleBar`, `DMSidebar`, `DMListPanel`. `Button`/`IconButton` already include HIT.
- **UserPanel (WIP):** most of the 7.1, 8.1, 9.3 and 13.7 hits in the shell come from this one file.

#### Needs fixture

- Thread sidebar
- Pinned messages panel (with loading and empty states)
- Notification bell popover, desktop and phone sheet
- Command menu
- Unread banner
- Delete-message confirm
- ChannelInviteModal
- Member detail tabs (Media/Pins/Threads/Links/Files) with loading, error and empty states
- Voice channel status, media and "Set the vibe", plus the stream hover card
- Read-only composer; composer with reply, attachments and mention autocomplete; GIF favorite notice
- Message hover toolbar and edit mode; jump-to-present; DM call region
- Server rail with DM stack, "+N" overflow, voice indicator and tooltip
- User panel with voice connected, active call and nameplate
- Re-capture: action-sheet 390 (dark and light) and 768-dark, shell-empty-390-dark, shell-dm-768-light, mobile-sidebar-768-light

---

### Friends, profiles, popovers, You page, invite/share states (PR)

> Superseded: PR-36 (profile sheet drawer overrides) — `ui/drawer` is merged; re-check.

Screen measurements are in CSS px. The design-system checker finds **201 issues in the 26 files in this area**:

| Rule                | Count |
| ------------------- | ----- |
| tailwind-text-size  | 82    |
| arbitrary-shadow    | 23    |
| dead-blur           | 22    |
| bare-hover          | 18    |
| off-breakpoint      | 12    |
| palette-color       | 11    |
| arbitrary-text-size | 9     |
| z-index             | 8     |
| off-grid-spacing    | 7     |
| raw-color           | 6     |
| vh-height           | 2     |
| lucide-import       | 1     |

#### Inventory

| View                                                       | How to reach                  | Fixture             | Screens checked                             | Score 0-4 | Top issues (max 3, short)                                                                                                                                                                |
| ---------------------------------------------------------- | ----------------------------- | ------------------- | ------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Friends page (`FriendsView`)                               | DM home, Friends              | `friends`           | 390/768/1280 dark + light                   | **0**     | At 390 the header clips the tabs and Add Friend, so you can't add a friend on a phone; three different left edges (16/24/28); the white empty-state glyph is close to invisible in light |
| DM list in the friends sidebar (`DMListPanel`)             | DM home, left column          | `friends`           | 768/1280 dark + light                       | 2         | Selected row uses elevated + shadow, not tint-2; 13/11px text, not 15/12; 32px avatar buttons have no HIT                                                                                |
| Phone profile sheet, other user (`MobileProfileSheet`)     | Phone: tap an avatar          | `mobile-profile`    | 390/768 dark + light (phone only, no 1280)  | 2         | Call shows for blocked users and hides for friends (bug); stays dark in light theme; 20px inset and 20px card radius (rule: 16/12)                                                       |
| Phone profile sheet, self                                  | Phone: tap your own avatar    | `mobile-profile-me` | 390/768 dark + light                        | 2         | Same as above, plus a dead "Note" card; 40px banner buttons have no HIT                                                                                                                  |
| Phone You page (`MobileYouPage`)                           | Phone tab bar, You            | `mobile-home-you`   | 390 dark + light (768 correctly shows chat) | 3         | Status labels and shortcut labels start 6px apart; groups use `rounded-xl`, not `-lg`; banner is near-black in light                                                                     |
| Shared message, gone state (`SharedMessagePage`, your WIP) | `/share/$token`               | `share-gone`        | 390/768/1280 dark + light                   | **0**     | Fixture shows TanStack's default error page with a raw D1 SQL error; the route has no errorComponent; the gone state is a card                                                           |
| Invite, invalid state (`InviteClient`)                     | `/invite/$code`               | `invite-invalid`    | 390/768/1280 dark + light                   | 2         | Logged-out users are told "Invite Invalid / Authentication required"; card has a shadow, 24px radius and dead blur; light shots render dark                                              |
| Desktop profile popover (`UserProfilePopover`)             | Desktop: click an avatar      | none                | code only                                   | 1         | 4 controls do nothing (3 banner buttons and a message input); hand-rolled portal, scrim and focus; shadows on cards inside the popover                                                   |
| Profile modal (`UserProfileModal`)                         | Friends context menu, Profile | none                | code only                                   | 1         | Fake tabs (Board/Connections/Activity); several solid fills and white-on-red hover; hand-rolled scrim and a floating card on phones                                                      |
| Account popover (`UserAccountPopover`)                     | Desktop user panel avatar     | none                | code only                                   | 1         | Hand-rolled portal; rows are not MENU_ITEM (14px, rounded-lg); Switch Accounts is always disabled                                                                                        |
| Profile editor (`ProfileEditorModal`)                      | Edit Profile                  | none                | code only                                   | 1         | Hand-rolled `bg-black/56` scrim, `rounded-3xl`, inline sizing; no full-screen phone layout                                                                                               |
| Avatar picker / frame editor                               | Settings, Account, Avatar     | none                | code only                                   | 1         | Frame editor is a `createPortal` dialog with no Escape or focus trap; picker's delete button only shows on hover                                                                         |
| Reaction details                                           | Reaction count                | none                | code only                                   | 2         | Remove-reaction is hover-only, so it can't be tapped in the phone drawer; desktop branch hand-rolls its scrim                                                                            |
| Share message modal                                        | Message menu, Share           | none                | code only                                   | 2         | Hand-rolled phone bottom sheet (no handle, no safe area); expiry options as a pill-button row; `sm:` breakpoints                                                                         |
| Start call confirm                                         | DM call                       | none                | code only                                   | 2         | Inline SVG checkbox; 24px close button; desktop branch hand-rolled                                                                                                                       |
| `FriendListPanel`                                          | not imported anywhere         | n/a                 | code only                                   | n/a       | Dead code: delete                                                                                                                                                                        |

#### Findings

- **PR-01 [P1] Friends page, phone header** — `src/components/chat/FriendsView.tsx:231-275` (root `overflow-hidden` at `:229`), `src/components/ui/tabs.tsx:77` — rules 3.7, 9.1, 12.2 — `friends-390-dark.png`, `friends-390-light.png` — What: at 390 the header holds menu + "Friends" + divider + 4 tabs + Add Friend in one row that doesn't scroll. "Blocked" ends near x=364 and the Add Friend icon starts at about x=385, clipped at the 390 edge. Add Friend can't be reached on phones. The diag file says `overflowX=false` only because the root clips the overflow. — Fix: below `md`, move `Tabs` to a second `h-11 overflow-x-auto scrollbar-none px-4` strip under the header. Make Add Friend an `IconButton icon="invite" size="md"` in the header's trailing slot (the labelled Button returns at `md:`). Give `Tabs` a horizontal-scroll option.
- **PR-02 [P1] Phone profile sheet, Call action** — `src/components/chat/MobileProfileSheet.tsx:588,650` — functional bug, not a design rule — `mobile-profile-390-dark.png` — What: the comment says "0 blocked, 1 friends", but the store uses 0 = friend and 1 = blocked (`FriendsView.tsx:219-222`, `UserProfileModal.tsx:454,517`). The current code hides Call for friends and shows it for blocked users. — Fix: `handleCall={relationship?.type === 1 ? undefined : handleCall}`, and correct the comment.
- **PR-03 [P1] Presence colour (every avatar)** — `src/components/chat/UserStatusDot.tsx:5-10`, `src/components/chat/UserProfileModal.tsx:65-70,315-322` — rules 7.2, 7.3 — `mobile-home-you-390-dark.png` (Online dot is accent blue), `friends-1280-dark.png` (Ada's dot is blue) — What: online is `bg-primary`, idle `bg-warning`, dnd `bg-destructive`. The `--rm-status-*` tokens exist (`styles.css:244-246`) but nothing uses them, so accent now means "online". The profile modal uses `bg-emerald-500`/`bg-amber-500` instead, so one status shows blue in five places and green in one. The dot cut-outs are always `bg-rm-bg-surface`, whatever the background behind them. — Fix: map `--color-rm-status-*` in `@theme inline` and use `bg-rm-status-*`. Delete `STATUS_CLASS_NAMES` and render `UserStatusDot` in the modal.
- **PR-04 [P1] Hover-only actions you can't reach on touch** — `ReactionDetailsModal.tsx:71`, `AvatarPickerModal.tsx:295,312`, `UserProfilePopover.tsx:410-420` (also unlabelled, about 16px), `FriendListPanel.tsx:206` (dead file) — rule 9.3 — code only — What: remove-reaction is invisible and untappable until hover (`opacity-0 pointer-events-none` until `group-hover`). In the phone drawer it can never be tapped. Delete-recent-avatar and remove-role work the same way. — Fix: reuse the recipe at `FriendsView.tsx:451` (`pointer-fine:group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100 pointer-coarse:pointer-events-auto`), ideally as a `REVEAL` constant in `ui/interaction.ts`. Give the role remove button `aria-label` and `HIT`.
- **PR-05 [P1] Shared message route errors** — `src/routes/share.$token.tsx` (the loader rethrows anything that isn't a 404/410; there is no `errorComponent`), `SharedMessagePage.tsx` (your WIP, flagged only) — rule 14.3 — all 6 `share-gone-*.png` — What: anonymous visitors get the unstyled TanStack page: a Times heading, the raw `D1_ERROR: no such table: message_shares: SQLITE_ERROR`, and an un-HIT "Hide Error" button (55x16). It looks the same in light and dark. The fixture DB is missing the migration, so the real gone state never rendered. — Fix: add a route `errorComponent` and a themed root `defaultErrorComponent` using the 14.1 empty-state layout, with generic copy and never `error.message`. Apply the D1 migrations and recapture.
- **PR-06 [P1] Desktop profile popover dead controls** — `UserProfilePopover.tsx:139-153, 962-966, 1027-1040` — rules 14, 13.3 — code only — What: the Mod View, Friends and More Options buttons have no `onClick`. The `fileAdd` button has no handler and no label. The "Message @user" input has no submit, so typed text is lost, and the emoji glyph is not a button. — Fix: replace the input with `Button variant="secondary" size="lg" w-full` "Message" that calls `openDm`. Wire Mod View to `handleToggleAssignRoles` and More Options to the member `ContextMenu`. Remove Friends and fileAdd.
- **PR-07 [P1] Invite page tells logged-out users the invite is invalid** — `InviteClient.tsx:43-46,202-217` — rule 14.3 — `invite-invalid-390-dark.png` — What: any API failure, including 401, shows "Invite Invalid" with the raw message "Authentication required". A logged-out visitor clicking a valid invite hits a dead end. — Fix: on 401, send them to sign-in with the invite as the return URL. Keep "Invalid" for 404/410 with friendly copy.
- **PR-08 [P2] Hand-rolled modal overlays (one cause, 9 files)** — rules 13.1, 6.5, 11.1 — code only — What: each of these builds its own scrim (`bg-black/50` to `/70`, never `bg-rm-scrim`), z-index and dismissal:
  - `UserProfilePopover.tsx:874-906`: portal, `z-40` scrim, `z-60` surface. Escape and outside-click are wired by hand at `:744-778`. Focus never moves into the popover.
  - `UserAccountPopover.tsx:240-265`: same pattern.
  - `UserProfileModal.tsx:204-226` and `ProfileEditorModal.tsx:19-35`: `bg-black/62` and `/56` scrims, `rounded-3xl`, inline sizing.
  - `AvatarPickerModal.tsx:172-176`: `z-50` scrim plus a `z-60` wrapper.
  - `AvatarFrameEditor.tsx:306-318`: portal `role="dialog"` at `z-70`, with no Escape and no focus trap.
  - `MessageShareModal.tsx:84-100`: its own phone bottom sheet.
  - `StartCallModal.tsx:124-139` and `ReactionDetailsModal.tsx:202-214`: ResponsiveDialog is used on phones only; the desktop branch is rebuilt by hand.

  Fix: popovers → Base UI Popover with `MENU_PANEL` (12.7) at `z-50`. Profile modal and editor → `Dialog` + `DialogSurface` with 12.8 workbench sizing, plus a full-screen phone page. The rest → `ResponsiveDialogContent` at both widths, `z-60` when opened over settings.

- **PR-09 [P2] Profile surfaces ignore light theme** — `src/lib/profile-customization.ts:75-77` (`DEFAULT_PROFILE_THEME` is `#5865F2` / `#161A22`), used by `MobileProfileSheet.tsx:522`, `MobileYouPage.tsx:103`, `UserProfilePopover.tsx:585`, `UserProfileModal.tsx:112`, `UserAccountPopover.tsx:114` — rules 7.1, 7.5 — `mobile-profile-390-light.png`, `mobile-profile-me-390-light.png` (whole sheet navy over a light app), `mobile-home-you-390-light.png` (banner fades to near-black) — Fix: when the user hasn't set a theme, return variables that point at rm tokens (`var(--rm-bg-surface)`, `var(--rm-text)`, `var(--rm-accent-solid)`, …).
- **PR-10 [P2] Phone profile sheet: inset, radius, edges** — `MobileProfileSheet.tsx:116,177,199,270,362` (inset), `:364,374,391,417,477` (cards), `:277` (Edit button), `:421-466` (moderator rows) — rules 2.2, 2.4, 5.1, 12.5 — `mobile-profile-390-dark.png` — What:
  - Content inset is `px-5` (20) but the toolbar is `p-3` (12): back button at x=12, name and cards at x=20.
  - Cards are `rounded-2xl` (20), not 12, and sit 12px apart, not 16.
  - Edit Main Profile is `rounded-2xl font-bold`.
  - Moderator rows use `px-2 gap-4 rounded-xl` with 24px icons: the gear sits 8px right of its heading, and the card has 24px of extra bottom space.

  Fix: `px-4` everywhere, toolbar `px-4 pt-[max(16px,var(--safe-area-top,0px))]`. Cards `rounded-lg p-4` in `flex flex-col gap-4`. Edit button → `Button size="lg" w-full`. Rows `-mx-2 px-2 gap-3 rounded-md min-h-11`, `md` icons, `text-rm-danger-ink`.

- **PR-11 [P2] Phone profile sheet: type, touch, layers, dead UI** — `MobileProfileSheet.tsx:71-74,116,179,200,209,303,324,368,423-435,477-483,626` — rules 4.1, 4.2, 9.1, 9.7, 11.2, 14 — `mobile-profile-me-390-dark.png`; diag lists Close profile / Edit profile at 40x40 on all 8 shots — What: `text-[28px]`, `text-[14px]` and `text-3xl`; `font-semibold` labels; `size-10` banner buttons with no `HIT`; toolbar and handle at `z-50` inside the drawer; Manage is always disabled at `opacity-60`; the "Note (only visible to you)" card is a static label. — Fix: ui type steps and `font-medium`; `HIT` on the banner buttons and remove their blur; `z-20`; remove or wire Manage (with `DISABLED`); make Note a real `Textarea` or remove it.
- **PR-12 [P2] Friends page shared edges** — `FriendsView.tsx:231,279,311,331,387` — rule 2.4 — `friends-1280-dark.png` — What: the header starts at 16px, the "ONLINE — 0" eyebrow and add-friend form at 24px (`px-6`), and row avatars at 28px (`px-4` + `px-3`). — Fix: eyebrow and form `px-4`; list `px-2` with rows `px-2`; phone rows `min-h-12 px-4 gap-3`.
- **PR-13 [P2] Friends page header anatomy** — `FriendsView.tsx:231-242` — rules 12.1, 12.2, 11.1, 3.6 — `friends-768-dark.png` — What:
  - Title is `text-ui-sm` (rule: `text-ui-md`) with `gap-3` (rule: `gap-2`).
  - Header is `z-10` and has no safe-area top, while `ChatHeader.tsx:91` handles it.
  - The phone menu button is `size="sm"` (rule: `md`).
  - The `members` Icon has no `shrink-0`, so at 768 it is crushed to about 3px wide.

  Fix: follow 12.1/12.2: `h-[calc(48px+var(--safe-area-top,0px))] pt-[var(--safe-area-top,0px)] z-20`, icon `shrink-0`, `IconButton size="md"`.

- **PR-14 [P2] Friends empty and loading states** — `FriendsView.tsx:332-378` — rules 14.1, 14.2, 7.4, 1.2 — `friends-1280-light.png`, `friends-390-light.png` — What:
  - The icon sits in a dither tile with a border and `shadow-sm`.
  - The glyph is `text-white` with a hand-rolled drop shadow. In light theme it is about 1.3:1 against the tile, close to invisible.
  - Spacing is `mt-16 gap-1`, not `py-12 px-6 gap-3`.
  - Only the "all" tab has body text, in muted rather than secondary; no tab has an action.
  - Loading is a hand-rolled `text-primary/60` spinner.

  Fix: `Icon size="3xl"` (`2xl` on phone) in `text-rm-text-muted` with no tile shadow; body text `text-ui-sm text-rm-text-secondary max-w-[36ch]` on every tab; one action button; 3 skeleton rows (`h-14 rounded-md bg-rm-tint-1 animate-pulse`).

- **PR-15 [P2] Friends rows** — `FriendsView.tsx:141,296-305,387-451` — rules 13.3, 4.1, 7.1, 9.1, 9.3, 9.5, 13.1, 13.4, 2.1 — code only — What:
  - Rows are `rounded-lg` and 60px tall (not 48/56); text is `text-sm`/`text-xs`.
  - Avatar ring is `ring-white/10` with a bare `group-hover`; the status dot border is `border-[2.5px]`.
  - The 40px avatar button has no `HIT`; the actions use a bare `group-hover`.
  - There is no long-press, so the context menu can't be reached on touch.
  - Remove uses `window.confirm`; add-friend errors show in `text-primary`.
  - The Send button overrides `size="lg"` with `h-9`.

  Fix: `rounded-md min-h-14` (`min-h-12` on phone); `text-ui-base font-medium` and `text-ui-xs text-rm-text-secondary`; `ring-rm-border` with `pointer-fine:` hovers; `HIT`; `useLongPress` (as `DMListPanel.tsx:36` does); a ResponsiveDialog confirm; `text-rm-danger-ink` with `aria-invalid`; no size override.

- **PR-16 [P2] DM list rows** — `DMListPanel.tsx:56,59,93-94,107,112,144,151` — rules 12.3, 1.2, 9.1, 14.1, 3.7 — `friends-768-dark.png`; diag shows 3 "View X's profile" buttons at 32x32 per shot — What: selected row is `bg-rm-bg-elevated shadow-sm` and hover `/50` (rule: tint-2 / tint-1, no shadow); text is `text-ui-sm` and `text-ui-2xs` (rule: `base` / `xs`); the unread pill is `left-[-4px] w-1 h-2`; avatar buttons have no `HIT`; the empty state is a bordered card with `pt-[80px]`; the scroller lacks `min-h-0 overscroll-contain`. — Fix: use the 12.3 tokens, `HIT`, the channel-style pill, an unboxed empty state and the 3.7 scroller classes.
- **PR-17 [P2] Desktop popover: elevation, type, colour** — `UserProfilePopover.tsx:59,173-174,346,404,932,937,946,969,974,996,1004,1028,1032,1047`; `ProfileSurfaceShell.tsx:28,30` — rules 1.2, 6.1, 6.2, 4.1, 4.2, 5.1, 7.1, 9.4, 12.7 — code only — What:
  - The shell is `rounded-3xl` with `shadow-[0_24px_72px…]`.
  - The bio card has a border, a shadow, `/92` alpha and blur.
  - The avatar has two hand-rolled shadows.
  - Edit Profile is a hand-tinted `bg-primary/18` button.
  - The name is `text-xl font-bold`.
  - Focus is overridden with `focus-visible:outline-none ring-primary/35`.
  - Hover/focus borders use `border-white/25`.
  - The role colour falls back to `#94a3b8`.

  Fix: shell `rounded-lg shadow-lg`; inner cards with no shadow or blur; `Button variant="secondary"`; `text-ui-lg font-semibold`; drop the focus overrides; use the profile-card-border token on hover; fall back to `var(--rm-text-muted)` (also at `MobileProfileSheet.tsx:404`).

- **PR-18 [P2] Profile modal** — `UserProfileModal.tsx:229-245,311,341,368,393,407,421-435,447,461,475,482,536,552,577-584` — rules 13.5, 13.2, 1.1, 7.1, 13.1, 3.7, 12.8, 14.3, 4.1 — code only — What:
  - Board/Connections/Activity are fake tabs.
  - There are up to 3 solid fills in one view.
  - Remove Friend and Block hover to red with white text, and Block has no confirm.
  - At `md` there are two scrollers in one column (`:242`, `:447`).
  - The close button is `size-10` at `top-5 right-5` with blur.
  - The error strip is hand-rolled `rounded-2xl`.
  - Text uses `text-[20px]`, `text-[14px]` and `text-3xl`, with `sm:` grids.

  Fix: remove the tabs or use `Tabs`; one default Button plus secondary/destructive variants; a ResponsiveDialog confirm for Block; one scroller; close `size-8 top-3 right-3`; `RowError`; ui type steps; `md:`.

- **PR-19 [P2] Account popover** — `UserAccountPopover.tsx:48,50,76,81,289,300,311,321,329,343,356,369-376,435` — rules 12.7, 1.2, 9.1, 9.3, 9.7, 7.1, 4.1 — code only — What:
  - Rows are `text-[14px] px-3 py-2.5 rounded-lg`, not MENU_ITEM.
  - Inner cards have shadow and blur.
  - The status back button is about 20px with no HIT.
  - Switch Accounts is always disabled.
  - The input uses `bg-white/10` and the focus ring `ring-white/30`.
  - Arbitrary sizes: `border-[3.5px]`, `text-[20px]`; hover is a bare `group-hover/item`.
  - Placeholder copy reads like dev text: "Support custom status!", "Today I learned...".

  Fix: `MENU_ITEM`, `MENU_LABEL` and `MENU_SEPARATOR` in one `MENU_PANEL`; `IconButton size="xs"` for back; remove Switch Accounts; tokens instead of white; placeholder "Set a custom status".

- **PR-20 [P2] Invite page cards** — `InviteClient.tsx:85,97,111-126,152,169,186-188,203-216` — rules 12.15, 1.2, 6.3, 7.1, 9.1, 13.2, 4.1 — `invite-invalid-390-dark.png` (about 24px radius, glow under the card); diag shows "Go to Chat" at 118x40 on all 6 shots — What:
  - All 5 state cards are `rounded-2xl bg-rm-bg-secondary/80 p-10 shadow-2xl ring-white/[0.06] backdrop-blur-xl`.
  - The buttons are hand-rolled: Accept is `text-white shadow-lg`, and Go to Chat has no HIT.
  - The success state uses emerald palette classes.
  - There are 14 Tailwind text sizes and `font-bold` titles.
  - The light screenshots render dark: either `/invite` doesn't get the theme or the harness can't set it there. Needs verifying.

  Fix: `rounded-xl border border-rm-border bg-rm-bg-surface p-6 max-w-[420px]`; `Button size="lg"`; `text-rm-success-ink`; ui type with `font-semibold`.

- **PR-21 [P2] Shared message page (your WIP, flagged, not edited)** — `SharedMessagePage.tsx:4,85-109,129,143` — rules 3.4, 8.1, 14.1, 14.2, 3.1, 9.3 — code only — What: `min-h-screen` twice; a lucide `Radio` icon; the gone state is a card with a `text-xl font-bold` title and no action; loading is a text card; `sm:py-14` and `px-5`; a bare `hover:underline`. — Fix: `min-h-dvh`; `<Icon>`; the 14.1 empty state with one "Open Ralph Meet" button; a `Spinner`; `px-4 py-8 md:py-16`; `pointer-fine:` hover.
- **PR-22 [P2] Share snapshot card** — `ShareSnapshotPreview.tsx:93,98,117,142,162,170,187` — rules 1.2, 7.1, 4.2, 12.12 — What: the card has `shadow-xl shadow-black/20`; the "edited" notice uses 6 amber palette classes; the author is `text-sm font-bold`; the body is `font-medium leading-[1.25]`; images are `rounded-lg`; there is a `sm:` grid and a bare `group-hover` brightness change. — Fix: no shadow; `text-rm-warning-ink bg-rm-tint-1` plus an icon; `text-ui-base font-medium` for the author and weight 400 for the body; `rounded-xl` images; `md:`; `pointer-fine:` hover.
- **PR-23 [P2] Share modal internals** — `MessageShareModal.tsx:100,105,117,131,169,193,227` — rules 12.9, 3.6, 13.5, 14.3 — What: the phone sheet is `rounded-t-xl` with no handle; the footer has no safe-area bottom; insets are `px-5`; expiry is a row of 4 `aria-pressed` buttons; the error strip is hand-rolled. — Fix: move to ResponsiveDialog (PR-08); `RadioList` for expiry; `RowError`.
- **PR-24 [P2] Start call confirm** — `StartCallModal.tsx:61-93,134,141,148-155,161` — rules 8.1, 9.3, 12.8, 2.1 — What: an inline SVG checkbox at `h-[18px]`; bare `group-hover` twice; the close button is 24px (`size="xs"`); padding is `px-4 pt-4`; width is `max-w-[440px]`. — Fix: `Checkbox`; `md:max-w-sm p-6`; close button `size-8`.
- **PR-25 [P2] Reaction details internals** — `ReactionDetailsModal.tsx:46-47,59,62,97,110,146,179,205,213,215` — rules 12.8, 13.3, 9.2, 4.1, 3.1 — What: rows are `rounded-lg` with 36px avatars; `text-sm`/`text-xs`; a hand-rolled `active:scale-[0.97]` instead of PRESS; header `px-5 py-4`; 3 `sm:` classes. — Fix: `rounded-md size-10`, ui type, `PRESS`, the 12.8 header, `md:`.
- **PR-26 [P2] Avatar picker internals** — `AvatarPickerModal.tsx:182,187-193,199,204,211,221,223,229,286,336` — rules 12.8, 9.3, 7.1, 2.1, 4.1, 14.3 — What: a `text-[24px]` title; a `size-10 rounded-xl` close button with an `lg` icon; a tile that rotates on hover (`group-hover:rotate-6`); a hard-coded blurple `rgba(88,101,242)` ring; off-grid `58px` and `150px` sizes; `text-base font-bold`; a hand-rolled error strip. — Fix: `text-ui-lg`; close button `size-8` with an `sm` icon; drop the rotate; `ring-rm-accent-ink`; `size-14` / `min-h-36`; `RowError`.
- **PR-27 [P2] Avatar frame editor internals** — `AvatarFrameEditor.tsx:319-333,396-433` — rules 12.8, 9.7, 13.2 — What: a `text-sm font-bold` title; header `px-4 py-3`; Apply forces `bg-primary … opacity-50` instead of `DISABLED`; the outline buttons are restyled. — Fix: the 12.8 header and plain `Button` variants.
- **PR-28 [P3] You page icon column** — `MobileYouPage.tsx:210,311-315,331-335` — rule 2.4 — `mobile-home-you-390-dark.png` — What: status labels start at x≈57 (bare 12px dot) and shortcut labels at x≈63 (18px icon). — Fix: put both in a fixed `flex size-5 shrink-0 items-center justify-center` slot.
- **PR-29 [P3] You page polish** — `MobileYouPage.tsx:191,202-225,207,246,256,272,299,303,328` — rules 12.4, 9.7, 14.5, 9.2, 8.2 — What: `rounded-xl` groups and tiles; `disabled:opacity-60`; the selected status shows only a check (no tint, no weight change); `[--hover-o:0.04]` overrides PRESS; tile icons are `lg`. — Fix: `rounded-lg`; `DISABLED`; selected row `bg-rm-tint-2 font-semibold`; drop the hover override; `xl` icons.
- **PR-30 [P3] Dead code** — all of `FriendListPanel.tsx` (no importers); `UserProfilePopover.tsx:639-661,878` (phones never reach the desktop popover); `UserAccountPopover.tsx:135-165` (phone centring that never runs) — Fix: delete.
- **PR-31 [P3] Off-ladder z-index** — `AvatarImage.tsx:66`, `ProfilePreviewPrimitives.tsx:54`, `ProfileSurfaceShell.tsx:100,126`, `UserProfileModal.tsx:263`, `FriendsView.tsx:395,399`, `UserProfilePopover.tsx:309` (`z-70` dropdown nested inside the popover) — rules 11.1, 11.2 — Fix: 0/10/20 inside surfaces; portal the role dropdown.
- **PR-32 [P3] Dead backdrop-blur (22)** — rule 6.3 — Fix: remove at:
  - `InviteClient.tsx:85,97,169,186,203`
  - `UserProfilePopover.tsx:59,878 (×2),1004`
  - `UserProfileModal.tsx:206,235,328`
  - `UserAccountPopover.tsx:48,311,326`
  - `ProfileSurfaceShell.tsx:28`
  - `ProfileEditorModal.tsx:21`
  - `MobileProfileSheet.tsx:72`
  - `MessageShareModal.tsx:87`
  - `ReactionDetailsModal.tsx:205`
  - `StartCallModal.tsx:128`
  - `AvatarFrameEditor.tsx:308`
- **PR-33 [P3] Hand-rolled shadows (23)** — rule 6.1 — Fix: floating shells → `shadow-lg` or `shadow-2xl`; inner elements → none. Locations:
  - `UserProfileModal.tsx:220,235,303,328,368,378,482,536`
  - `UserProfilePopover.tsx:59,173,174,1004,1047`
  - `UserAccountPopover.tsx:48,289,311,326`
  - `ProfileSurfaceShell.tsx:28,30`
  - `ProfileEditorModal.tsx:30`
  - `ProfilePreviewPrimitives.tsx:21` (plus raw rgba gradients at `:79`)
  - `AvatarPickerModal.tsx:176,286`
- **PR-34 [P3] Old type scale (91)** — rules 4.1, 4.2 — What: 82 `text-xs`…`text-3xl` plus 9 `text-[Npx]`:

  | File                 | Hits |
  | -------------------- | ---- |
  | InviteClient         | 14   |
  | UserProfilePopover   | 11   |
  | AvatarPickerModal    | 10   |
  | ShareSnapshotPreview | 9    |
  | FriendsView          | 7    |
  | FriendListPanel      | 6    |
  | ReactionDetailsModal | 6    |
  | SharedMessagePage    | 6    |
  | AvatarFrameEditor    | 5    |
  | UserProfileModal     | 5    |
  | MobileProfileSheet   | 4    |
  | UserAccountPopover   | 3    |
  | MessageShareModal    | 2    |
  | StartCallModal       | 2    |
  | DMListPanel          | 1    |

  `font-bold` (700) on names and titles breaks 4.2 at `UserProfilePopover.tsx:937,946`, `InviteClient.tsx:120,126,191,208`, `SharedMessagePage.tsx:92,105`, `ShareSnapshotPreview.tsx:117`, `AvatarFrameEditor.tsx:328`, `AvatarPickerModal.tsx:211,229`. — Fix: map to `text-ui-*` and change 700 to 600.

- **PR-35 [P3] Platform icons tinted accent when online** — `UserPlatformIndicators.tsx:69-70` — rule 7.3 — Fix: `text-rm-text-muted`.
- **PR-36 [P3] Profile sheet drawer overrides (superseded by ui/drawer)** — `MobileProfileSheet.tsx:613-626` — rules 12.9, 3.6 — `mobile-profile-390-dark.png` — What: `DrawerContent` is forced to `h-dvh max-h-none pb-0`. At full height the toolbar sits under the status bar. A 2px accent stroke runs along the sheet's top edge, probably the focus ring. — Fix: recheck after the Base UI Drawer migration.
- **PR-37 [P3] Media-overlay colours with no media** — `MobileProfileSheet.tsx:72,626` — rules 6.5, 7.1 — What: `bg-black/35 text-white` and a `bg-white/60` handle are fine over a banner image but sit on the theme gradient when there is no banner. — Fix: use them only when `banner_url` is set; otherwise `bg-rm-tint-2 text-rm-text`.

#### Shared causes

1. **A separate set of profile colour variables with a dark default.** Six surfaces read the profile colour variables (`--rm-profile-custom-*`), and the default is hard-coded dark (PR-09). Each surface then rebuilds cards and buttons with its own radii, shadows and blur (PR-10, PR-17–PR-19, PR-33). Fix the default once, then extract a `ProfileCard` and a `ProfileButton` variant.
2. **Overlay components bypassed.** Nine files, eight different scrim alphas, none using `bg-rm-scrim`. ResponsiveDialog is used only for phones, and popovers are built by hand with `createPortal` (PR-08).
3. **Status colours ignore the `--rm-status-*` tokens** (PR-03, PR-35).
4. **Hover-revealed actions with no touch fallback** (PR-04, PR-15). FriendsView already has the right recipe; make it a shared `REVEAL` constant.
5. **Off-grid insets** (`px-5`/`px-6` next to `px-4`) break shared edges (PR-10, PR-12, PR-21, PR-23).
6. **Placeholder or dead controls shipped as UI** (PR-06, PR-11, PR-18, PR-19).
7. **No error UI on public routes.** `share.$token` and `invite.$code` fall back to TanStack's default page or raw API messages (PR-05, PR-07).
8. **Outside this area:** on the `friends` shots, `DMSidebar.tsx`'s search button (215x32), Friends/Shop rows (223x32) and the titlebar back/forward buttons (24x24) have no HIT at 768 with touch. That belongs to whoever audits the shell/sidebar.

#### Needs fixture

- **Desktop profile popover**: 768/1280 dark + light, with banner, roles, mutuals, manage-roles permission with the dropdown open, and the self view.
- **Profile modal**: 390/768/1280 for each relationship type, plus the error state.
- **Account popover**: including the status submenu and custom-status editing.
- **Profile editor**: 390/768/1280.
- **Avatar picker** (with recent avatars) and **frame editor**: 390/1280.
- **Reaction details**: 390 drawer and 1280, with reaction-manage permission.
- **Share message modal**: before and after creating a link, plus an error.
- **Start call confirm**: 390/1280.
- **`friends` with data**: populated online/all/pending/blocked tabs, add-friend form with an error, loading, and the DM list empty state.
- **`mobile-profile` variants**: banner, moderator actions, mutuals, a friend and a blocked user (to show PR-02), full height with a non-zero safe-area top.
- **`share-gone` / `share-ok`**: needs the `message_shares` migration on the fixture DB.
- **`invite-*`**: preview, joining and success states, a logged-in invalid state, and light theme actually applied on `/invite`.

---

### Voice and calls (VC)

Root: `F:\dev\TS\CLOUDFLARE\ralph-meet-quietpro\`. All paths below are relative to that root. Rules cite `docs/design-system.md`. Screenshots are in `C:\Users\jon\AppData\Local\Temp\ds-audit\`. The PNGs are 2x, so every px value here is CSS px.

#### Inventory

| View                                                                                                                                                | How to reach                                            | Fixture                                 | Screens checked                                                          | Score 0-4 | Top issues (max 3)                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| voice (connected, 4 avatar tiles)                                                                                                                   | `/ui-fixtures?surface=voice` (VoiceChannelView, joined) | yes                                     | 390/768/1280 dark, 1280 light                                            | 2         | Dock overflows at 390 and 768 (VC-01); grid uses 16px gap, 24px phone inset, 80px top pad under an absolute 64px header (VC-07, VC-08); 112px avatars clip inside 111px tiles at 768 (VC-09) |
| voice-live (muted, deafened, camera, sharing)                                                                                                       | `/ui-fixtures?surface=voice-live`                       | yes                                     | 390/768/1280 dark, 390 light                                             | 1         | Two solid accent fills plus solid red Leave (VC-02); same overflow (VC-01); no safe-area padding on the phone dock (VC-03)                                                                   |
| voice-landing (pre-join)                                                                                                                            | `/ui-fixtures?surface=voice-landing` (VoiceLanding)     | yes, but the 1280-dark capture is blank | 390/768 dark, 1280 light (1280 dark is an empty light-grey frame, 15 KB) | 3         | Display serif at 44px inside the chat shell (VC-14); no safe-area-top on the phone header (VC-03); empty-state anatomy is off (VC-27)                                                        |
| Focused stage / stream view                                                                                                                         | Click a tile (VoiceGrid focused branch)                 | no                                      | code only                                                                | 2         | Volume panel overflows the left edge on phone (VC-16); 128px white glyph and `shadow-2xl` card on a theme surface (VC-10, VC-19); stage uses bare `hover:` (VC-20)                           |
| Members tray                                                                                                                                        | Focus a tile, then the Members toggle                   | no                                      | code only                                                                | 2         | Duplicated in RoomPageClient; bare hover; `sm:` breakpoints; dead blur (VC-20, VC-21, VC-29)                                                                                                 |
| /room/$slug meeting (RoomPageClient)                                                                                                                | `/room/<slug>`                                          | no                                      | code only                                                                | 1         | Forked dock with 3 possible solid reds and an inverted solid, no HIT/PRESS, about 42px overflow at 390 (VC-04); 56px header with a duplicated connection status (VC-25)                      |
| DM call (DMCallRegion), user WIP                                                                                                                    | DM, then start a call                                   | no                                      | code only                                                                | 2         | Shares the overflowing call dock (VC-01); `fixed inset-0 z-50` without safe areas (VC-03); zinc and green palette (VC-12)                                                                    |
| Incoming / Outgoing call                                                                                                                            | Ring a DM                                               | no                                      | code only                                                                | 2         | Incoming sits at `z-50`, not system `z-100` (VC-17); two different greens for Accept (VC-12); outgoing desktop uses a hand-rolled black/70 scrim and blue rings (VC-18)                      |
| Voice switch / apps / status modals                                                                                                                 | Join a second channel; Activities; channel status       | no                                      | code only                                                                | 2         | Status modals build their own scrim and z-60 surface (VC-18); Warp Rush card is a near-black gradient with `text-rm-text`, unreadable in light (VC-11)                                       |
| Screen share pickers                                                                                                                                | Dock, then Share                                        | no                                      | code only                                                                | 2         | `z-90` hand-rolled `bg-black/80` scrim (VC-17, VC-18); bare hovers, Tailwind text sizes (VC-20, VC-29)                                                                                       |
| Audio menus / panels (AudioDeviceMenu, NoiseReduction, SpatialAudio, MicTest, InputSensitivity)                                                     | User panel, then device menu or settings                | no                                      | code only                                                                | 2         | Hand-rolled popovers off MENU_PANEL with off-ladder z (VC-22); amber/emerald/sky palette (VC-12); hover-only slider thumb (VC-23)                                                            |
| Context menus (StreamContextMenu, Local/Remote menus, ContextMenuItems)                                                                             | Right-click or long-press a tile                        | no                                      | code only                                                                | 2         | Popover on touch instead of ActionSheet; submenus never flip and go off a 390 screen (VC-15)                                                                                                 |
| VoiceDashboard (sidebar voice strip)                                                                                                                | Join voice, then look at the user panel                 | no                                      | code only                                                                | 2         | Live camera and share are also solid accent, so up to 4 solids in one view (VC-02); hand-rolled stream menu at `z-[60]`/`z-[70]` inside a panel (VC-22); hover wiggle (VC-20)                |
| FloatingStreamPreview, VoiceStreamHoverCard, VoiceDetailsPanel, VoiceDebugScreen, StickerReactionsOverlay, AudioInteractionModal, DemoRoomChatPanel | various                                                 | no                                      | code only                                                                | 2         | Off-ladder z (VC-17); reaction and loader animations ignore reduced motion (VC-26); Tailwind type and palette (VC-29, VC-12)                                                                 |

#### Findings

**P1**

- **VC-01 [P1] voice / voice-live / DM call** — `src/components/voice/VoiceControls.tsx:116-121, 147-148, 317-355` — rules 3.7, 9.1, 12.13 — screenshots `voice-live-390-dark.png`, `voice-390-dark.png`, `voice-live-768-dark.png`, `voice-768-dark.png`
  - **What:** the dock row is `overflow-x-auto scrollbar-none` with nothing that adapts it to narrow widths. That is why diag reports `overflowX=false`: the overflow is clipped inside the row, not on the page.
  - **390 measurement:** `px-2` 16 + main group 312 + `gap-2` 8 + right group 102 = **438px in a 390 viewport, so 48px is scroll-hidden**.
    - Main group: 6 x 44 buttons + 7 x 4 gaps + 2 dividers x 5 + `p-1` 8 + border 2.
    - Measured: the right group starts at x=328 (matches the math). Fullscreen sits at 333-377. The Members toggle sits at 381-425, so only 9px of it shows. There is no affordance that the row scrolls.
  - **768 measurement:** the main column is 456 (768 - 312). Content is `md:px-6` 48 + main group 321 (third divider now shows) + 2 x 8 + right group 102 = **487, so 31px is hidden**. The Members chevron touches the column edge and the 24px right inset is gone (`voice-768-dark.png`). `mx-auto` has no free space left, so the main group is not centred either.
  - **Also:** `variant="call"` (DMCallRegion) keeps the hidden right group in the layout via `invisible` (line 320), so the call dock overflows even when that group "hides".
  - **Fix:**
    - Below `md`, show mic, deafen, camera, share, More (sheet with Activities, stickers, members) and Leave. That is 6 x 48 + 5 x 8 + 10 = 338, plus `px-4` 32 = 370, which fits 390.
    - Drop the fullscreen button on phones (iOS has no element fullscreen).
    - Above `md`, make the dock a container (`@container`) and move the right group into the header or More under `@max-[560px]`.
    - Use `hidden` rather than `invisible` for `hideExtraControls`.
- **VC-02 [P1] voice-live** — `src/components/voice/VoiceControls.tsx:30, 202, 221`; also `src/components/chat/VoiceDashboard.tsx:50, 809, 858` — rules 1.1, 13.2, 12.13 — screenshots `voice-live-390-dark.png`, `voice-live-1280-dark.png`, `voice-live-390-light.png`
  - **What:** `DOCK_LIVE = bg-primary` is applied to both camera-on and sharing. The fixture shows **two solid accent buttons plus the solid red Leave** in one dock. The code comment at :15 says "camera/screen share live = the only accent fill", but there are two of them.
  - The sidebar VoiceDashboard repeats the same recipe (`ACTION_LIVE`), so a desktop view with the user panel open can show 4 solid accents.
  - **Fix:** make the live state a tint: `bg-rm-accent-tint text-rm-accent-ink` + `state="active"` Fill glyph (1.3, 14.5). Keep Leave as the only solid in the dock. If one accent solid is wanted, use it on the share-live state only, and never in VoiceDashboard while the main dock is visible.
- **VC-03 [P1] voice / voice-landing / DM call** — rule 3.6 — screenshots `voice-390-dark.png`, `voice-landing-390-dark.png` (no inset rendered)
  - **What:** no voice surface pads for safe areas.
    - `src/components/chat/VoiceChannelView.tsx:590`: the bottom panel and the 72px dock have no `pb-[var(--safe-area-bottom)]`. The 44px buttons sit 14-58px from the bottom edge, so the iOS home-indicator zone (34px) covers the bottom 20px of Leave and Mute.
    - `src/components/voice/VoiceHeader.tsx:54` and `src/components/voice/VoiceLanding.tsx:38`: no `pt-[var(--safe-area-top)]`. The parent `src/components/chat/ChatPageClient.tsx:1323` does not pad either.
    - `src/components/chat/DMCallRegion.tsx:434`: the expanded call is `fixed inset-0 z-50` with no safe-area padding on any side.
    - `src/components/voice/VoiceDebugScreen.tsx:157, 178`: same as DMCallRegion.
  - **Fix:**
    - Dock wrapper: `pb-[var(--safe-area-bottom,0px)]` and let the height grow (`min-h-[72px]`).
    - Headers: `pt-[var(--safe-area-top,0px)]`.
    - Fixed full-screen surfaces: pad all four sides, or wrap them in `SafeAreaView`.
- **VC-04 [P1] /room/$slug** — `src/components/RoomPageClient.tsx:167-335` (ControlsBar) — rules 12.13, 1.1, 9.1, 9.2, 9.3 — code only (needs fixture)
  - **What:** a forked, older dock.
    - Muted mic and deafen are **solid `bg-destructive`** (:207, :225), plus `shadow-lg shadow-destructive/20`. With Leave (:288) that is up to 3 solid reds.
    - Camera-on is an inverted solid `bg-rm-text text-rm-bg-surface shadow-lg` (:248). Share-on is a solid `bg-primary`.
    - Buttons are `w-12 h-10` with no HIT or PRESS. They use `hover:` 22 times and `active:scale-[0.96]`.
    - The group is `rounded-2xl ... shadow-2xl` (:191), a shadow on a non-floating surface.
  - **Estimated overflow at 390:** `px-6` 48 + group 292 + right group 92 (fullscreen and settings, `p-2` 40 each, `gap-3`) = **432, about 42px over**, and the row has no overflow handling. It reaches 484 when the Members toggle appears.
  - **Fix:** delete ControlsBar and render `<VoiceControls>` with a settings slot, so the room page inherits VC-01/VC-02 fixes.

**P2**

- **VC-05 [P2] voice** — `src/components/voice/VoiceControls.tsx:19, 25` — rule 12.13 — screenshot `voice-1280-dark.png`
  - **What:** the dock buttons are `size-11` (44) with `gap-1` (4) inside the group. The spec is 48px icon buttons with `gap-2`. Measured at 1280: buttons are 54-55 image px, which is 44 CSS px, and they sit 4px apart.
  - **Fix:** use `size-12` + `gap-2`, or better, `IconButton size="lg"` (48, `rounded-lg`, `xl` icon, HIT built in; 8.3, 13.2). Re-run the VC-01 arithmetic after the change.
- **VC-06 [P2] voice / voice-live** — `src/components/voice/VoiceControls.tsx:204-208`, `src/components/chat/VoiceDashboard.tsx:812-823`, `src/components/RoomPageClient.tsx:251-255` — rules 8.4, 1.3 — screenshots `voice-390-dark.png`, `voice-1280-light.png`
  - **What:** camera uses two glyphs: `camera` (active) and `cameraOff` at rest. At rest the camera therefore shows a slashed glyph on a neutral tint, while mic and deafen show plain glyphs at rest. That reads as "camera muted" with no danger tint.
  - **Fix:** use `<Icon name="camera" state={on ? "active" : "idle"}>`. Reserve `state="off"` for a real "no camera" state, together with `disabled`.
- **VC-07 [P2] voice** — `src/components/voice/VoiceGrid.tsx:393` — rules 12.13, 2.2 — screenshots `voice-390-dark.png`, `voice-1280-dark.png`
  - **What:** the grid is `gap-4 pt-20 px-6 pb-6`. Measured: a 16px tile gap at all widths (the spec is `gap-2` on phone, `gap-3` on desktop) and a 24px phone inset (tile left edge at x=23; the spec is 16). `pt-20` (80px) exists only to clear the absolute header (VC-08).
  - **Fix:** `gap-2 md:gap-3 p-4 md:p-6`. Remove `pt-20` once the header is a sibling.
- **VC-08 [P2] voice** — `src/components/voice/VoiceHeader.tsx:54-58`; `src/components/chat/VoiceChannelView.tsx:540` — rules 3.3, 3.8, 12.1, 11.1 — screenshot `voice-390-dark.png` (header band 0-64px, tiles start at 78)
  - **What:** the header is `absolute top-0 h-16` (64px; the spec is 48), with `z-10` (chrome is `z-20`) and a translucent `bg-rm-bg-primary/20`. The grid scrolls under it.
    - There is no `border-b border-rm-border`.
    - The title is `text-ui-sm` (13px); the spec is `text-ui-md font-semibold`.
    - The channel icon is `md`; headers use `lg` (8.2).
  - The focused-stream variant (gradient over video) can stay an overlay because it sits on media.
  - **Fix:** in the unfocused state, render the header as a `shrink-0 h-12 px-4 border-b` sibling above the scroller. Keep the absolute overlay only when `focusedItem` is set.
- **VC-09 [P2] voice @768** — `src/components/voice/VoiceGrid.tsx:398-406`, `src/components/voice/ParticipantCard.tsx:270, 278-279` — rules 3.1, 3.9 — screenshot `voice-768-dark.png`
  - **What:** grid columns and avatar size key off viewport `sm:` (640). At 768 the main column is only 456px, so `sm:grid-cols-2` gives 197x111 tiles. Meanwhile `sm:w-28` gives a 112px avatar, bigger than the tile. The circle is clipped top and bottom, and the initial overlaps the name chip and the more button.
  - There are 8 `sm:/xl:/2xl:` uses in the grid and 15 in the card.
  - **Fix:** make the grid a `@container` and pick columns and avatar size with container queries, e.g. avatar `size-16 @min-[320px]:size-20 @min-[480px]:size-28`, or cap it at `max-h-[60%] aspect-square`.
- **VC-10 [P2] voice (all themes)** — `src/components/voice/ParticipantCard.tsx:278-279`; `src/components/voice/VoiceGrid.tsx:208` — rules 7.1, 7.4, 4.1, 1.2 — screenshots `voice-live-390-light.png`, `voice-1280-dark.png`
  - **What:** the avatar fallback is `bg-black/40 rounded-full shadow-lg` with `text-white text-3xl sm:text-5xl font-bold`. That is pure-alpha black plus white text on a theme surface, not media.
    - Light theme: a grey (~#8f8f8f) disc with white text, about 3.3:1.
    - Dark theme: the disc is about 1.1:1 against the tile, so only a floating letter shows.
    - The focused stage uses `text-8xl md:text-9xl text-white`.
  - **Fix:** use `bg-rm-tint-2 text-rm-text` (or the AvatarImage fallback tokens) with `text-ui-2xl font-semibold`, and drop `shadow-lg`.
- **VC-11 [P2] VoiceAppsModal, activity loading (light theme)** — `src/components/chat/VoiceAppsModal.tsx:143-151`; `src/components/chat/VoiceChannelView.tsx:560-565` — rules 7.1, 7.4, 7.5 — code only
  - **What:** the Warp Rush card is `bg-[linear-gradient(135deg,rgba(14,116,144,0.16),rgba(15,23,42,0.9))]` with `text-rm-text` and `text-cyan-100`. In light theme that is dark text on a near-black card. The activity Suspense fallback has the same `rgba(2,6,23,0.98)` radial with `text-rm-text` and `text-cyan-200/80`.
  - The logos at :28-57 are illustration and allowed.
  - **Fix:** use a `bg-rm-bg-surface` card with a `--rm-activity-*` token for the art strip (7.3). The fallback should use `Spinner size-6` + `text-ui-sm text-rm-text-secondary` (14.2).
- **VC-12 [P2] palette hues on theme surfaces (one cause, many files)** — rules 7.1, 7.3 — code only
  - **What:** Tailwind palette hues on theme surfaces in these files:
    - `src/components/voice/StreamingStatsPanel.tsx:149, 152, 222, 233` (emerald-400, amber-600/400)
    - `src/components/RoomPageClient.tsx:388, 419, 430` (emerald copy-state and status pill)
    - `src/components/chat/IncomingCallModal.tsx:176` (`bg-emerald-600 text-white` Accept)
    - `src/components/chat/DMCallRegion.tsx:49` (`bg-green-600` Accept), `:527, 558, 566` (zinc)
    - `src/components/chat/OutgoingCallModal.tsx:50-52` (blue-500 rings)
    - `src/components/chat/NoiseReductionPanel.tsx:46, 86, 94` (sky, amber, emerald)
    - `src/components/chat/SpatialAudioPanel.tsx:87, 120, 368-369`, plus raw rgba at `:467`
    - `src/components/DemoRoomChatPanel.tsx:228, 323`
    - `src/components/chat/VoiceAppsModal.tsx:143-151`
    - `src/components/chat/VoiceStreamHoverCard.tsx:21` (raw rgba)
    - `src/components/voice/StreamLoadingIndicator.tsx:11` (`bg-[#111214]`)
    - `src/components/voice/VoiceDebugScreen.tsx:157` (`#111214`)
  - Accept is two different greens in two files.
  - **Fix:** use `text-rm-success-ink`/`text-rm-warning-ink` with a `bg-rm-*-tint`. Add a `--rm-accept` token (or reuse `--rm-success`) for call accept, shared by both files. Loaders use `bg-rm-bg-surface`.
- **VC-13 [P2] voice (speaking tile)** — `src/components/voice/ParticipantCard.tsx:121-124`; `src/components/chat/DMCallRegion.tsx:528-529` — rules 12.13, 7.3, 6.1, 1.2 — screenshots `voice-390-dark.png`, `voice-768-dark.png` (the accent ring on "You")
  - **What:** the speaking ring is `ring-2 ring-primary` + `shadow-[0_6px_18px_-6px_var(--rm-glow)]`. The spec is a 2px `--rm-success` ring with no shadow. Accent means "selected", so a speaking tile reads as selected. Ringing (:124) has the same glow plus `animate-pulse`.
  - **Fix:** `ring-2 ring-rm-status-online` (or a `--rm-success` ring token) with no shadow. Keep accent for focus/selected only.
- **VC-14 [P2] voice-landing** — `src/components/voice/VoiceLanding.tsx:68` — rules 4.4, 4.1 — screenshots `voice-landing-390-dark.png`, `voice-landing-768-dark.png`, `voice-landing-1280-light.png`
  - **What:** `font-display text-display-lg` puts Instrument Serif at 44px inside the chat shell. The role table names "voice channel name on landing" as `text-ui-xl`, and display-lg is marketing-only.
  - **Fix:** `text-ui-xl font-semibold text-balance` (`text-ui-2xl` at most on wide screens).
- **VC-15 [P2] context menus on touch** — `src/components/voice/ParticipantCard.tsx:53-55` (long press opens `StreamContextMenu`); `src/components/StreamContextMenu.tsx:322-336`; `src/components/ContextMenu/ContextMenuItems.tsx:261-262` — rules 13.1, 9.5, 3.4 — code only
  - **What:**
    - Long press opens the same positioned popover as right-click. The spec is an `ActionSheet` on phones.
    - Submenus open to `left-[calc(100%+4px)]` and never flip. A 210px menu clamped to a 390 screen plus a 200px submenu runs about 20px off-screen.
    - `max-h-[70vh]` breaks 3.4.
    - `w-[210px]` is off-grid (2.1).
  - **Fix:** on `useIsMobile()`, route the shared item model to `ActionSheet`. Flip the submenu with `right-full` when there is no room. Use `max-h-[70dvh]` and `w-[208px]` (or the MENU_PANEL max width).
- **VC-16 [P2] focused stage** — `src/components/voice/VoiceGrid.tsx:277-278, 308-309` — rules 3.9, 2.2 — code only
  - **What:** the volume panel is `absolute bottom-6 right-6 w-full max-w-sm`. At a 390 column it is 384 wide, so its left edge sits at -18px (clipped by `overflow-hidden`). It also overlaps the name label at `bottom-6 left-6`, and both are `z-20`.
  - **Fix:** use `inset-x-4 bottom-4 md:left-auto md:w-[360px]`, and stack the label above the panel on phone.
- **VC-17 [P2] z-index ladder** — rules 11.1, 11.2 — code only
  - **What:** off-ladder or wrong-layer z values in these places:
    - Incoming call `src/components/chat/IncomingCallModal.tsx:118`: `z-50`. System calls are `z-100` per 11.1 and 13.1. It currently sits under menus and toasts and ties with any open dialog.
    - `src/components/ScreenShareModal.tsx:88`, `src/components/DesktopScreenPickerModal.tsx:538`: `z-90`.
    - `src/components/chat/VoiceChannelMediaStatusModal.tsx:334`, `src/components/chat/VoiceChannelTextStatusModal.tsx:98`: dialog at `z-60`.
    - `src/components/chat/VoiceDashboard.tsx:537/544` (popover `z-20/z-30`), `:641/647` (`z-[60]`/`z-[70]`, not portalled).
    - `src/components/voice/VoiceDetailsPanel.tsx:280`: popover `z-30`.
    - `src/components/chat/FloatingStreamPreview.tsx:193`: `z-40` (floating is `z-30`).
    - `src/components/chat/DMCallRegion.tsx:436`: `z-40`.
    - Inside tiles: `src/components/voice/ParticipantCard.tsx:120` (`z-50`), `:226` (`z-40`), `:385`, `:419` (`z-50`); `src/components/voice/VoiceGrid.tsx:228` (`z-50`); `src/components/voice/StickerReactionsOverlay.tsx:85, 107, 128, 145, 168` (`z-50`); `src/components/RoomPageClient.tsx:644` (`z-50` banner).
  - **Concrete bug:** a speaking tile is `relative z-20` and the more-button wrappers are `z-50`. The grid has no stacking context and the header is `z-10`, so these paint **over the header** when the grid scrolls under it.
  - **Fix:**
    - Tiles: `isolate`, children `z-10` max.
    - Header and dock: `z-20`.
    - Popovers and dialogs: `z-50`. Incoming call: `z-100`. Floating: `z-30`.
- **VC-18 [P2] overlay choice / scrims** — rules 13.1, 6.5 — code only
  - **What:** hand-rolled scrims and surfaces instead of `ResponsiveDialog`:
    - `src/components/chat/VoiceChannelMediaStatusModal.tsx:326` and `src/components/chat/VoiceChannelTextStatusModal.tsx:90` build their own `bg-black/50 backdrop-blur-sm` scrim plus a fixed surface.
    - `src/components/ScreenShareModal.tsx:88` and `src/components/DesktopScreenPickerModal.tsx:538` use `bg-black/80`.
    - `src/components/chat/OutgoingCallModal.tsx:123` (desktop branch) uses `bg-black/70 backdrop-blur-md` with an `md:text-white` title (:69).
    - `src/components/voice/AudioInteractionModal.tsx:21-35` is a plain Dialog with a `rounded-2xl bg-rm-bg-primary` card and a hand-rolled `bg-rm-accent text-white shadow-lg` CTA (:64).
  - **Fix:** use `ResponsiveDialog` with `bg-rm-scrim`. Pickers use the workbench `Dialog` + `PickerSurface`. The AudioInteraction CTA becomes `<Button size="lg" className="w-full">`.
- **VC-19 [P2] shadows below the floating layer** — rules 1.2, 6.1 — code only (glows are visible as halos around avatars in `voice-1280-light.png`)
  - **What:** shadows and hand-rolled glows on tiles, labels and docks:
    - `src/components/voice/ParticipantCard.tsx:122, 124, 149` (inset 100px), `:235, 270, 278, 318`
    - `src/components/voice/VoiceGrid.tsx:200` (`shadow-2xl` on a stage card), `:309` (`shadow-md` label)
    - `src/components/voice/VoiceHeader.tsx:63, 179` (`drop-shadow-[...]`)
    - `src/components/RoomPageClient.tsx:102, 191, 207, 248, 288`
    - `src/components/chat/DMCallRegion.tsx:529`
    - `src/components/chat/VoiceDashboard.tsx:689, 723, 766` (glow dots)
    - `src/components/chat/NoiseReductionPanel.tsx:38`
    - `src/components/chat/VoiceChannelMediaStatusModal.tsx:99`
    - `src/components/chat/VoiceChannelStatusPreview.tsx:44`
    - `src/components/chat/VoiceChannelTextStatusModal.tsx:119`
    - `src/components/chat/VoiceAppsModal.tsx:50-55` (logo art, allowed)
  - **Fix:** remove the shadows on tiles, labels and the dock. Floating surfaces use `shadow-sm`, `shadow-lg` or `shadow-2xl` tokens only.
- **VC-20 [P2] hover gating** — rule 9.3 — code only
  - **What:** bare `hover:` / `group-hover:` in this area (latch-on-tap risk):
    - `src/components/voice/ParticipantCard.tsx:128, 185, 385, 419, 433, 445`. `:445` is a `group-hover:opacity-10` black overlay, so the tile stays darkened after a tap on touch. `:433` (tray chevron) has no coarse fallback.
    - `src/components/voice/VoiceGrid.tsx:133, 228`
    - `src/components/chat/VoiceChannelView.tsx:605`
    - `src/components/RoomPageClient.tsx` (22 uses: :144, 208, 227, 248, 272, 288, 298, 310, 323, 387, 654, 695)
    - `src/components/DemoRoomChatPanel.tsx:237, 263, 270, 330, 337`
    - `src/components/ScreenShareModal.tsx:138, 153, 161, 187, 248, 260`
    - `src/components/DesktopScreenPickerUI.tsx:70, 136, 139, 241, 319, 331, 341`
    - `src/components/chat/VoiceDashboard.tsx:490, 520, 817, 823, 865, 890, 919, 966`. These are `group-hover:animate-wiggle`, and hover must never move.
    - `src/components/chat/VoiceStreamHoverCard.tsx:107, 120, 128`
    - `src/components/chat/VoiceSwitchModal.tsx:75, 99`
    - `src/components/voice/AudioInteractionModal.tsx:42, 64`
    - `src/components/voice/VoiceDetailsPanel.tsx:349, 356, 405`
    - `src/components/voice/VoiceDebugScreen.tsx:191, 197, 365`
    - `src/components/chat/VoiceChannelMediaStatusModal.tsx:384`
    - `src/components/chat/AudioDeviceMenu.tsx:283`
    - `src/components/ContextMenu/ContextMenuItems.tsx:198`
    - `src/components/chat/DMCallRegion.tsx:632` (has a coarse fallback)
  - The tile more-button (:419) correctly adds `pointer-coarse:opacity-100`. It is visible at 390 and 768 in the screenshots.
  - **Fix:** use `pointer-fine:hover:` / `pointer-fine:group-hover:`. Delete the wiggle.
- **VC-21 [P2] scroll** — `src/components/voice/VoiceGrid.tsx:393, 409` — rule 3.7 — code only
  - **What:** `place-content-center` on an `overflow-y-auto` grid. With 5+ participants on a phone (one column of about 190px tiles), the overflow at the top becomes unreachable, because centred content overflows both ways. The scrollbar is also hidden three ways (`no-scrollbar scrollbar-hide` + inline style).
  - **Fix:** use `place-content-[safe_center]` (or `content-start` when overflowing) with `overscroll-contain`. Keep one scrollbar-hiding utility at most, and keep the scrollbar on desktop.
- **VC-22 [P2] hand-rolled popovers** — rules 12.7, 13.1, 5.3 — code only
  - **What:** popovers built by hand instead of `MENU_PANEL`:
    - `src/components/chat/AudioDeviceMenu.tsx:209-212, 325-330`: `rounded-xl shadow-2xl backdrop-blur-xl w-[220px]`. The submenu opens on `onMouseEnter` (a click also works, :231) and sits at `z-80`, the tooltip layer.
    - `src/components/chat/VoiceDashboard.tsx:533-560` (noise panel) and `:641-700` (stream settings: `rounded-xl shadow-2xl p-1.5`, rows `text-xs px-3 py-2 rounded-lg`, no `pointer-coarse:min-h-11`, `h-[1px]` separators).
    - `src/components/voice/VoiceDetailsPanel.tsx:276-280`.
  - **Fix:** `MENU_PANEL` + `MENU_ITEM` + `MENU_SEPARATOR` on desktop, a bottom drawer (`PickerSurface`/`ResponsiveDialog`) on phone.
- **VC-23 [P2] touch visibility** — `src/components/ContextMenu/ContextMenuItems.tsx:196-198` (also used by the focused-stage volume, `src/components/voice/VoiceGrid.tsx:294`) — rules 9.1, 9.3 — code only
  - **What:** the slider thumb is `opacity-0 group-hover/slider:opacity-100`. On touch the volume slider has no visible thumb and the track is `h-1`.
  - **Fix:** always show the thumb (`size-3`, `pointer-coarse:size-5`) and give the input `min-h-11` on coarse pointers.
- **VC-24 [P2] states** — `src/components/voice/streamingStats.ts:159` — rules 14.4, 4.3 — screenshot `voice-1280-dark.png` ("STABLE")
  - **What:** `if (connectionState === "connected" || joined) return "Stable"`. Once joined, the header says Stable through reconnecting or failed. Unknown states fall through as raw strings. The label is always muted grey, so "Failed" is not danger-inked.
  - Reconnecting has no voice-view UI and relies on `ConnectionOverlay`.
  - **Fix:** map from `connectionState` first. Use "Reconnecting…" with `text-rm-warning-ink` + icon and "Failed" with `text-rm-danger-ink` + icon. Show the state as normal-case `text-ui-xs` (4.7: not an eyebrow).
- **VC-25 [P2] /room/$slug header** — `src/components/RoomPageClient.tsx:366-455` — rules 3.3, 12.2, 9.1 — code only
  - **What:**
    - The header is `h-14` (56) + safe area with `px-6`; the spec is 48 and `px-4` on phone.
    - Status shows twice: the `StreamingStatsPanel` label and an emerald pill (:411-433).
    - The copy-link button is `h-7 w-7` with no HIT (:384).
    - The title is `text-sm font-bold`.
  - **Fix:** use the VoiceHeader recipe after the VC-08 change, keep one status chip, and use `IconButton size="sm"` for copy.

**P3**

- **VC-26 [P3] motion** — rules 10.3, 10.5 — code only
  - **What:**
    - `src/components/voice/StreamLoadingIndicator.tsx:15` uses `zoom-in`, which enters from scale(0).
    - Loops that are not stopped under reduced motion: `animate-stream-loader`, `animate-reaction-*` (`src/components/voice/StickerReactionsOverlay.tsx:85-145`), `animate-ring-ping` (`src/components/chat/DMCallRegion.tsx:522`), `animate-ping` (`src/components/chat/OutgoingCallModal.tsx:50`) and the custom pulse (:76-84). Only `.animate-pulse/.animate-wiggle/.rm-breathe` are stopped in `styles.css:1166-1171`.
    - `duration-300` enters appear at `src/components/voice/VoiceGrid.tsx:198, 213, 277, 308` and `src/components/voice/AudioInteractionModal.tsx:35` (the cap is 300, the dialog spec is 240).
  - **Fix:** `zoom-in-[0.97]`; add those classes to the reduced-motion block (or gate with `useReducedMotion()`); use `--rm-dur-3`.
- **VC-27 [P3] voice-landing empty state** — `src/components/voice/VoiceLanding.tsx:67-75` — rule 14.1 — screenshot `voice-landing-390-dark.png`
  - **What:** no illustration icon. The body is `text-ui-base` (the spec is `text-ui-sm text-rm-text-secondary max-w-[36ch]`). The header uses `md:px-5` (2.1: `5` is settings-only) and has no `border-b`.
  - **Fix:** use the 14.1 recipe and `px-4`.
- **VC-28 [P3] tile chrome** — rules 12.13, 6.4, 4.7, 2.1 — screenshots `voice-390-dark.png` (the "You" chip has 8px extra left padding)
  - **What:**
    - `src/components/voice/ParticipantCard.tsx:119`: the tile is `bg-rm-bg-elevated/40`; the spec is `bg-rm-bg-surface`.
    - `:339`: the name chip is `rounded-md px-2 py-1 text-ui-2xs` on `bg-rm-bg-primary/85`; the spec is `rounded-sm px-1.5 text-ui-xs` on `bg-black/60` + `text-white`.
    - `:340`: the empty icon wrapper still takes a `gap-2` slot, hence the visible extra left padding on "You" and "Linus".
    - `:255` and `src/components/voice/VoiceGrid.tsx:337`: uppercase tracking on a button and a quality badge.
    - `src/components/voice/VoiceControls.tsx:19`: the dock group is `bg-rm-bg-surface` inside a `bg-rm-bg-surface` panel (`src/components/chat/VoiceChannelView.tsx:590`), the same token as its parent.
  - **Fix:** apply the 12.13 chip recipe, and render the icon wrapper only when muted or deafened.
- **VC-29 [P3] type scale (one cause)** — rule 4.1 — code only
  - **What:** Tailwind `text-xs/sm/base/lg/xl/2xl/3xl/4xl/8xl/9xl` and `text-[14px]` appear across the area:
    - `src/components/voice/VoiceGrid.tsx:208, 333`; `src/components/voice/VoiceHeader.tsx:150`; `src/components/voice/ParticipantCard.tsx:279, 318`
    - `src/components/RoomPageClient.tsx` (12)
    - `src/components/DemoRoomChatPanel.tsx` (12)
    - `src/components/DesktopScreenPickerUI.tsx` (10)
    - `src/components/chat/SpatialAudioPanel.tsx` (9)
    - `src/components/chat/VoiceAppsModal.tsx` (7)
    - `src/components/chat/VoiceChannelMediaStatusModal.tsx` (6, plus `text-[32px]` :348)
    - `src/components/ScreenShareModal.tsx` (6)
    - `src/components/voice/VoiceDebugScreen.tsx` (5 x `text-[14px]`); `src/components/voice/VoiceDetailsPanel.tsx:613`
    - `src/components/chat/OutgoingCallModal.tsx:60, 69, 72`; `src/components/chat/IncomingCallModal.tsx:134, 145`
    - `src/components/chat/FloatingStreamPreview.tsx:213, 216, 236`
    - `src/components/ContextMenu/ContextMenuItems.tsx:125, 191` (menu rows at `text-sm` 14, not 13)
    - and smaller counts in VoiceSwitchModal, VoiceChannelTextStatusModal, VoiceStreamHoverCard, VoiceChannelView, AudioInteractionModal, NoiseReductionPanel, InputSensitivityMeter, VoiceChannelStatusPreview, DMCallRegion.
  - **Fix:** map to `text-ui-*`. Menu rows use `text-ui-sm`.
- **VC-30 [P3] dead blur (one cause)** — rule 6.3 — code only
  - **What:** `backdrop-blur-*` / `blur-*` classes, all neutralised globally:
    - `src/components/voice/ParticipantCard.tsx:213, 230, 235, 318, 401, 424, 434`; `src/components/voice/VoiceGrid.tsx:246`; `src/components/voice/VoiceHeader.tsx:118, 183`; `src/components/voice/StreamWatcherList.tsx:47`; `src/components/voice/AudioInteractionModal.tsx:26`
    - `src/components/chat/VoiceChannelView.tsx:593`; `src/components/RoomPageClient.tsx:622, 683`
    - `src/components/chat/AudioDeviceMenu.tsx:212, 330`; `src/components/chat/OutgoingCallModal.tsx:123`; `src/components/chat/SpatialAudioPanel.tsx:474, 497, 534`; `src/components/chat/VoiceAppsModal.tsx:202, 214`
    - `src/components/chat/VoiceChannelMediaStatusModal.tsx:326, 339`; `src/components/chat/VoiceChannelTextStatusModal.tsx:90, 103`; `src/components/chat/VoiceDashboard.tsx:647`; `src/components/chat/VoiceStreamHoverCard.tsx:74, 126`; `src/components/chat/VoiceSwitchModal.tsx:132`
    - `src/components/DemoRoomChatPanel.tsx:157, 303`; `src/components/DesktopScreenPickerModal.tsx:538`; `src/components/ScreenShareModal.tsx:88`
  - **Fix:** delete them.
- **VC-31 [P3] dock semantics** — `src/components/voice/VoiceControls.tsx:264-314, 336-352` — rules 1.1, 13.2, 8.4 — screenshot `voice-1280-dark.png`
  - **What:**
    - Leave is a hand-rolled button, not `variant="danger"`.
    - "Stop Watching" and "Leave Activity" reuse the solid danger fill, but they are neither leaving the call nor irreversible.
    - The Members toggle is a rotated `chevronUp`, a direction glyph standing in for a "members" concept.
  - **Fix:** use the danger solid only for Disconnect. Stop Watching / Leave Activity get `destructive` (tint). The Members toggle uses the `members` icon with `state="active"` when open.
- **VC-32 [P3] StreamLoadingIndicator** — `src/components/voice/StreamLoadingIndicator.tsx:11-28` — rule 14.2 — code only
  - **What:** a bespoke 4-square accent loader with no `sr-only` "Loading" and `sm:` sizes.
  - **Fix:** `Spinner size-6` + `sr-only`, or keep the art but add the label and remove `sm:`.
- **VC-33 [P3] spacing nits** — rule 2.1 — code only
  - **What:** off-grid or non-scale values:
    - `src/components/chat/MicTestWidget.tsx:367` (`gap-[3px]`), `:390` (`rounded-[2px]`)
    - `src/components/chat/VoiceSwitchModal.tsx:72` (`size-[18px]`)
    - `src/components/chat/VoiceChannelMediaStatusModal.tsx:372, 399` (`min-h-[138px]`)
    - `src/components/chat/IncomingCallModal.tsx:122-123` (`w-[280px]`, `border-[3px]`)
    - `src/components/chat/OutgoingCallModal.tsx:47, 96` (`p-8 gap-6`, `size-14` button off the IconButton scale)
    - `src/components/chat/DMCallRegion.tsx:437` (`h-[300px] sm:h-[340px]`)
  - **Fix:** snap to the scale.

#### Shared causes

1. **Three dock implementations.** VoiceControls (`DOCK_*`), VoiceDashboard (`ACTION_*`) and RoomPageClient ControlsBar each define their own button recipe instead of `IconButton size="lg"` + one `dockState(rest|open|muted|live)` helper. That is why the sizes (44 / 32 / 48x40), live fills (two to four solids) and muted fills (tint vs solid) disagree (VC-01, VC-02, VC-04, VC-05, VC-06, VC-31). Put the recipe in `ui/` and make all three consume it.
2. **Viewport breakpoints in a component that lives in a variable-width column.** `sm:`/`xl:` in VoiceGrid, ParticipantCard, StreamLoadingIndicator, the members tray and DMCallRegion (VC-09, VC-01 at 768). The voice stage needs `@container` queries.
3. **The header is an absolute overlay in both the media and non-media states.** That causes the `pt-20` grid pad, the 64px header, `z-10` chrome, and tiles painting over the header (VC-07, VC-08, VC-17).
4. **The members tray and connected layout are copy-pasted** between `src/components/chat/VoiceChannelView.tsx:590-625` and `src/components/RoomPageClient.tsx:681-720`. Fixes must land twice until one shared `VoiceStage` exists.
5. **Hand-rolled overlays** (createPortal popovers, custom scrims, z-60/70/90) instead of MENU_PANEL / ResponsiveDialog / ActionSheet (VC-15, VC-17, VC-18, VC-22).
6. **No safe-area handling anywhere in the voice tree** (VC-03).

#### Needs fixture

- `voice-landing-1280-dark`: the capture is an empty light-grey frame (15 KB; diag reports 0 targets). Recapture.
- Focused stage: avatar, camera, screen share, preview-paused and loading-stream variants, plus the volume panel (VoiceGrid focused branch).
- Members tray (focus + Members toggle).
- Tile states: camera on, remote screen share with Watch prompt, local share with Pause/Resume, stream loading, ringing ("Calling..."), server-muted.
- Connection states: connecting, reconnecting, failed (header label, VC-24).
- `/room/$slug` (RoomPageClient) at 390/768/1280: connecting, connected, audio-stalled banner, file-drag overlay, DemoRoomChatPanel.
- DMCallRegion (user WIP): lobby, ringing incoming/outgoing, active audio, video, expanded, chat-hidden.
- IncomingCallModal; OutgoingCallModal (phone drawer and desktop overlay).
- VoiceSwitchModal; VoiceAppsModal (**light theme**, VC-11); VoiceChannelMediaStatusModal; VoiceChannelTextStatusModal; VoiceChannelStatusPreview.
- ScreenShareModal / UnifiedScreenShareModal / DesktopScreenPickerModal + UI.
- AudioDeviceMenu + device submenu; NoiseReductionPanel; SpatialAudioPanel; MicTestWidget; InputSensitivityMeter.
- StreamContextMenu / LocalMenu / RemoteMenu at 390 via long press (VC-15).
- VoiceDashboard in the user panel (live camera and share, VC-02); VoiceDetailsPanel; VoiceDebugScreen; FloatingStreamPreview; VoiceStreamHoverCard; StickerReactionsOverlay; AudioInteractionModal.

---

### Settings (ST)

Paths are relative to `F:\dev\TS\CLOUDFLARE\ralph-meet-quietpro\src\components\` unless they start with `src/` or `docs/`. Rule numbers refer to `docs/design-system.md`. Regex counts come from that audit script.

**Screenshot capture failures (shoot these again):**

- `settings-desktop-390-dark`/`-light`: all black in both themes.
- `settings-appearance-390-light`: black.
- `settings-appearance-1280-light`, `settings-notifications-1280-light`: blank grey.
- `settings-voice-768-dark`: blank.
- `settings-desktop-768-light`: dev-server error page ("Network connection lost", miniflare).
- `settings-appearance-768-light`: 13 KB, likely blank.

`settings-desktop-390` failed in both themes, so check it by hand (ST-25).

#### Inventory

| View                                               | How to reach                                                                              | Fixture                          | Screens checked                                              | Score 0-4 | Top issues (max 3)                                                                                                                                                 |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Studio shell (nav, search, phone push)             | gear / You tab → `openSettings()` → `SettingsHost` → `SettingsModal`                      | yes                              | 390 d/l, 768 d/l, 1280 d/l                                   | 3         | Phone heading shows a focus-ring box (ST-01); nav rows are 32px on 768 coarse with no HIT (ST-12); search/select are 36px with `text-base sm:` (ST-12, ST-26)      |
| settings-appearance (`settings`)                   | nav → Appearance                                                                          | yes                              | 390 d, 768 d, 1280 l (light captures at 390/768/1280 failed) | 3         | Card shadow in light theme (ST-10); rail note repeats the page blurb (ST-31); off-scale swatch radii (allowlist candidate)                                         |
| settings-account                                   | nav → Account                                                                             | yes (opens on the list on phone) | 390 d (list), 1280 d, 768 l                                  | 3         | Label type differs from 12.6 (ST-11); "Edit profile" opens the legacy editor (ST-02, ST-07)                                                                        |
| settings-sessions                                  | nav → Sessions                                                                            | yes (error state)                | 390 d, 1280 d                                                | 2         | Shows "No other devices are signed in" after a failed load (ST-14); raw "Authentication required" error with no icon (ST-27); revoke errors land in the wrong card |
| settings-privacy                                   | nav → Privacy & safety                                                                    | yes (error state)                | 390 d, 768 d                                                 | 2         | Segmented pill control: 28px targets, `rounded-[6px]`, shadow (ST-13); raw error text (ST-27)                                                                      |
| settings-voice                                     | nav → Voice & video                                                                       | yes                              | 390 d, 1280 d/l                                              | 3         | No loading or permission state for device lists (ST-15); 36px select and 20px range on coarse pointers (ST-12)                                                     |
| settings-soundboard                                | nav → Soundboard                                                                          | yes                              | 390 d, 768 d                                                 | 3         | `iconSize="sm"` overrides (8.3); Clear acts at once with no confirm or undo; picker opens at `z-[1100]` (ST-35)                                                    |
| settings-keybinds                                  | nav → Keybinds                                                                            | yes                              | 390 d, 1280 d                                                | 3         | Keyboard shortcuts shown on a touch phone (ST-36)                                                                                                                  |
| settings-notifications                             | nav → Notifications                                                                       | yes                              | 390 l, 768 d, 1280 d                                         | 3         | Light-theme card shadow (ST-10); 20px range on coarse (ST-12)                                                                                                      |
| settings-desktop                                   | nav → Desktop app (Tauri only)                                                            | yes                              | 1280 d, 768 d (390 blank, 768 light failed)                  | 2         | Restart confirm draws its own scrim, uses `p-5`/`sm:` (ST-18); restart failure is swallowed (ST-17)                                                                |
| ThemePreviewSidebar                                | Appearance → Preview                                                                      | needs fixture                    | code only                                                    | 1         | Close button has no accessible name (ST-04); legacy type, radius, weights (ST-23)                                                                                  |
| Profile editor (`SettingsAccountTab`, `asModal`)   | Account → Edit profile (`SettingsModal.tsx:790`); UserPanel → `ProfileEditorModal.tsx:37` | needs fixture                    | code only                                                    | 1         | Controls that do nothing (ST-02); no close button in the no-user state (ST-06); claim flow unreachable (ST-07)                                                     |
| ProfileEditorModal wrapper                         | UserPanel                                                                                 | needs fixture                    | code only                                                    | 1         | Draws its own `bg-black/56` scrim with blur; not full-screen on phone (ST-08)                                                                                      |
| ServerSettingsModal (+Roles, Invites, Bans, Audit) | server menu → Server settings                                                             | needs fixture                    | code only                                                    | 1         | Draws its own scrim; phone gets horizontal pill tabs and no back step (ST-09); errors only reach the console (ST-17); 0 of 7 recipe points                         |
| ChannelSettingsModal (+ChannelPermissionsTab)      | channel gear                                                                              | needs fixture                    | code only                                                    | 1         | Copy of the server shell (ST-09); unnamed tri-state permission buttons (ST-03); green flash `bg-green-500 text-white` (ST-20)                                      |
| RoleManagement / InvitesTab / AuditLogTab          | inside server settings                                                                    | needs fixture                    | code only                                                    | 1         | `window.confirm` (ST-16); errors only reach the console (ST-17); emoji empty state with the title missing (ST-29)                                                  |
| RoomSettingsModal                                  | room page → settings                                                                      | needs fixture                    | code only                                                    | 1         | Duplicates the Studio voice/camera/theme settings in a legacy shell (ST-19); inline style kills `md:pt-10` (ST-28); palette colours                                |
| CameraSettingsModal                                | voice controls / dashboard / thumbnail toolbar                                            | needs fixture                    | code only                                                    | 1         | Centred dialog on phone instead of a drawer (ST-21); no camera error or permission state (ST-15); `bg-black/85` scrim with blur                                    |
| CreateServer / CreateChannel / CreateCategory      | rail "+", sidebar "+"                                                                     | needs fixture                    | code only                                                    | 2         | Desktop branch draws its own scrim, uses `h2` instead of `DialogTitle` (ST-22); forced uppercase input                                                             |
| UpdateChecker (desktop)                            | `desktop/desktop-entry.tsx:56`                                                            | needs fixture                    | code only                                                    | 1         | `z-90` off the ladder; hand-rolled `text-white` buttons; width animation; no live region (ST-24)                                                                   |
| StandaloneUpdater (desktop)                        | `desktop/desktop-entry.tsx:50`                                                            | needs fixture                    | code only                                                    | 2         | `h-screen w-screen`; hand-rolled button (ST-24)                                                                                                                    |

**Is `SettingsAccountTab` dead code?** No. It is still mounted in two places:

- `chat/SettingsModal.tsx:790`, the Account → "Edit profile" dialog.
- `chat/ProfileEditorModal.tsx:37`, lazy-loaded from `chat/UserPanel.tsx:69/833`.

Both callers pass `asModal`, so every `!asModal` branch is dead:

- `SettingsAccountTab.tsx:3006-3011` (page header)
- `:4471-4552` (claim-account section)
- `:4554-4582` (inline save bar)

The reachable part is the `asModal` editor. It is the worst file in the repo by regex count: 193 findings (54 hand-rolled shadows, 26 bare hovers, 23 off-grid lengths, 21 Tailwind text sizes, 19 `sm:`/`lg:`, 14 `text-[Npx]`, 14 raw colours, 12 dead blurs, 6 palette colours, 4 z-index).

**How far each settings-like surface is from the Studio recipe (12.6, 12.8, 13.1)**

| Recipe point                                         | Studio (`settings/primitives.tsx`)              | ServerSettings                                                                          | ChannelSettings                                  | RoomSettings                                                                  | CameraSettings                     | Profile editor                           |
| ---------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------- |
| Card header `px-4 pt-4 pb-1`, title `text-ui-md` 600 | yes (`:157-158`)                                | no cards; `h2 text-xl font-bold` (`:140,224,755`) + uppercase eyebrows (`:232,331,346`) | no; same                                         | no; `h1 text-xl font-bold` (`:493`), eyebrow `h3` + palette icon (`:641-645`) | no; eyebrows (`:418,449`)          | no; eyebrow rail sections, `rounded-2xl` |
| Rows `px-4 py-3.5` + `divide-y`                      | yes (`:224,167`)                                | no; `space-y-8`, bordered mini-cards inside a card (`:371-384`)                         | no                                               | no; `space-y-10` + `Separator`                                                | no; `space-y-5`                    | no                                       |
| Label `text-ui-sm font-medium`                       | **no, `text-ui-base`** (`:251`)                 | `text-sm font-medium` (`:375`)                                                          | uppercase eyebrows                               | uppercase eyebrows (`:650-653`)                                               | uppercase eyebrows                 | `text-sm`/`text-[14px]`                  |
| Description `text-ui-sm` secondary                   | yes (`:260`)                                    | `text-ui-xs` muted (`:299,349`)                                                         | `text-ui-xs` muted                               | `text-sm` muted (`:497`)                                                      | none                               | `text-xs` muted                          |
| Select `h-9 w-[260px]`                               | yes (`:323`)                                    | native checkboxes (`:378-383`)                                                          | `max-w-sm px-4 py-2.5 border-rm-border` (`:351`) | mixed                                                                         | `w-full rounded-xl py-3` (`:423`)  | n/a                                      |
| Controls                                             | `SettingsSwitch` / `RangeControl` / `RadioList` | hand-rolled (`:390,417,441`)                                                            | hand-rolled save with green flash (`:375-387`)   | raw range `h-1.5` (`:659-670`)                                                | hand-rolled                        | hand-rolled                              |
| Nav rail                                             | 240, grouped, search (`SettingsModal.tsx:730`)  | `w-[218px]` (`:45`), solid-primary pills on phone (`:58-61`)                            | 218 (`:177`), pills                              | 180 (`:418`), pills (`:1318-1340`)                                            | none                               | 228, animates `max-width` (`:3054-3069`) |
| Workbench size                                       | 1120 × 820 (`:700`)                             | 1040 × 820 (`:697`)                                                                     | 1040 × 820                                       | 860 × 640 (`:415`)                                                            | 540 × 640 (`:381`)                 | 1240 × 860                               |
| Phone: full page, back, push nav, safe areas         | yes                                             | full page, close only, pills, no back step                                              | same                                             | same                                                                          | centred `p-4` dialog, no safe area | full screen, floating close only         |
| Points met (of 7)                                    | 6                                               | 0                                                                                       | 0                                                | 0                                                                             | 0                                  | 1                                        |

#### Findings

#### P1

- **ST-01 [P1] Studio shell, every phone page:** the page heading draws a focus-ring box. Confirmed in code.
  - Where: `chat/SettingsModal.tsx:287` (push from list → `pageTitleRef.focus()`), `:689` (`onOpenAutoFocus` on phone), `:574-577` (`<h2 tabIndex={-1} className="… outline-none">`), `src/styles.css:1129-1133`.
  - Rules: 9.4, 12.2.
  - Seen in `settings-390-dark.png`, `settings-sessions-390-dark.png`, `settings-privacy-390-dark.png`, `settings-voice-390-dark.png`, `settings-soundboard-390-dark.png`, `settings-keybinds-390-dark.png`, `settings-notifications-390-light.png`.
  - Cause: the global `:focus-visible` rule is unlayered on purpose ("beats `outline-none` utilities"), so `outline-none` on the heading does nothing. Chrome matches `:focus-visible` on programmatic focus when the last input was not a pointer (a direct open or a keyboard Enter). The result is a 2px accent box around a title that looks like a text field.
  - Same defect, two more places:
    - Deep-link and search landings focus the row (`SettingsModal.tsx:279`; `settings/primitives.tsx:223-224`; `settings/rails.tsx:187-188`), drawing a ring on top of the accent-tint highlight.
    - The phone nav (`SettingsModal.tsx:722`, focused at `:689`) has a ring too, clipped only because the nav is full-screen.
  - Fix: one unlayered rule in `styles.css`, e.g. `[tabindex="-1"]:focus-visible{outline:none}`, or a `.rm-focus-target` class put on the `h2`, the row `li` and the nav. Keep the focus move for screen readers.

- **ST-02 [P1] Profile editor:** it ships controls that do nothing.
  - Where (all `chat/SettingsAccountTab.tsx`):
    - `:3086-3096` "Main Profile ▾" button with no `onClick`.
    - `:4371-4383` "Board / Activity / Wishlist" tabs with no handler and no tab role.
    - `:4393-4400` "Add Widget" with no handler.
    - `:4449-4455` "Remove rotating game slot N" with no handler.
    - `:4415`, `:4440` placeholder gradients built from raw hex.
  - Rules: 13.3, 14, 7.1. Code only.
  - Why it matters: you reach this from Account → Edit profile and from the UserPanel. Pressing these does nothing.
  - Fix: remove them, or disable them with `ComingLater` (`settings/primitives.tsx:506`).

- **ST-03 [P1] Channel permissions:** the deny / inherit / allow buttons have no accessible name, and their state is colour only.
  - Where: `chat/ChannelPermissionsTab.tsx:352-362`, `:363-374`, `:376-387`. Rules: 8.5, 1.3, 14.5, 7.1. Code only.
  - What: icon-only `ButtonBase` with no `aria-label` or `aria-pressed`. Selected state is solid `bg-destructive`, `bg-slate-500` or `bg-green-500` with `text-white` and `shadow-sm`. `w-10 h-8` with no HIT.
  - Fix: a radiogroup per permission, labelled "Deny / Inherit / Allow", with tint fills, Fill icons and HIT.

- **ST-04 [P1] ThemePreviewSidebar:** the close button has no name.
  - Where: `chat/ThemePreviewSidebar.tsx:74-79`. Rules: 8.5, 13.2. Code only.
  - What: a `<button>` holding only an `aria-hidden` close icon, so screen readers announce "button".
  - Fix: `IconButton aria-label="Close preview"`.

#### P2

- **ST-05 [P2] Profile editor shell:** the floating close and the floating save bar break the elevation, z-index and safe-area rules.
  - Where (all `chat/SettingsAccountTab.tsx`):
    - `:2992-3002`: close is `h-10 w-10 rounded-full` with `shadow-[0_14px_34px…]` and `backdrop-blur-md`.
    - `:4587-4588`: save bar is `fixed bottom-5 z-[120]` with `rounded-3xl`, `shadow-[0_24px_80px…]`, `backdrop-blur-xl`, 300ms, and no safe-area bottom.
    - `:3046`, `:4461`: error strips use `rounded-2xl` with `destructive/*` tokens and a shadow.
  - Rules: 6.1, 6.3, 11.1, 3.6, 5.1, 14.3.
  - Fix: a dialog header with a `size-8` close; an in-dialog footer with `pb-[max(16px,var(--safe-area-bottom))]`; `RowError` for errors.

- **ST-06 [P2] Profile editor:** in the no-user and loading state there is no way out but Escape.
  - Where: `chat/SettingsAccountTab.tsx:2949-2980`. Rules: 13.1, 14.2, 4.1.
  - What: the early return renders no close button, which traps the user inside the full-screen phone dialog. The block also uses `text-2xl font-bold`, `text-sm font-bold` and a loader icon instead of `Spinner`.
  - Fix: render the header with close in every state.

- **ST-07 [P2] Profile editor:** the claim-account flow cannot be reached.
  - Where: `chat/SettingsAccountTab.tsx:4471-4552`. Rule: 14.
  - What: "Claim Existing Ralph Meet Account" renders only when `!asModal`, and both mounts pass `asModal`. No other file references `claimCandidates`.
  - Fix: move it into the Account panel as a `SettingsCard` with `ConfirmStrip`, or delete it together with `:3006-3011` and `:4554-4582`.

- **ST-08 [P2] ProfileEditorModal and the Studio profile dialog:** they draw their own scrim, use off-ladder sizes, and are not a full page on phone.
  - `chat/ProfileEditorModal.tsx:21`: scrim `bg-black/56 backdrop-blur-[2px]`.
  - `ProfileEditorModal.tsx:31`: `rounded-3xl`, `shadow-[0_36px_110px…]`, outer `p-4`, so it floats as a card on a 390 phone.
  - `chat/SettingsModal.tsx:779`: `z-60 rounded-2xl shadow-2xl zoom-in-95`.
  - `SettingsModal.tsx:781-788`: inline style duplicates the classes.
  - Both are 1240 × 860.
  - Rules: 13.1, 6.5, 6.3, 5.1, 12.8, 10.3.
  - Fix: one `ProfileEditorDialog` at the 12.8 workbench size, full-screen below `md` with safe areas, mounted from both places.

- **ST-09 [P2] Server, Channel and Room settings:** a hand-rolled workbench shell is repeated three times.
  - ServerSettings:
    - `chat/ServerSettingsModal.tsx:681-693`: scrim `bg-black/60 backdrop-blur-sm`.
    - `:697`: 1040 × 820, slides in 300ms on phone.
    - `:702-717`: phone header with close only.
    - `:45-131`: sidebar `md:w-[218px] md:pt-[60px]`, `rounded-full bg-primary` pill tabs on phone (`:58-61`).
    - `:731-743`: close at `z-50` inside the panel, plus an "ESC" caption.
    - `:746`: `px-[20px] md:px-[40px] pt-[60px]`.
  - ChannelSettings: the same block at `chat/ChannelSettingsModal.tsx:130-145`, `:150-151`, `:157-176`, `:177`, `:190-213`, `:219-231`.
  - RoomSettings: `RoomSettingsModal.tsx:405-415` (the surface is itself the full-screen scrim, 860 × 640), `:418-428`, `:471-484`, `TabBtn :1318-1340`.
  - Rules: 13.1, 12.8, 6.3, 6.5, 11.2, 13.5, 1.1, 3.6. Needs fixture.
  - Fix: extract the Studio shell into a `SettingsWorkbench` component and rebuild these three on `SettingsCard`/`SettingsRow`.

- **ST-10 [P2] Studio cards in light theme:** cards carry a shadow, against 1.2 and 12.5. The reference recipe ships it, so it spreads.
  - `chat/settings/primitives.tsx:153`: `shadow-[var(--rm-shadow-1)] dark:shadow-none` plus a border.
  - `settings/PrivacyPanel.tsx:362`: a shadow on the selected segment.
  - Rules: 1.2, 6.2, 12.5, 6.1, 7.5.
  - Seen in `settings-1280-light.png` and `settings-notifications-390-light.png`.
  - Fix: delete the shadow classes. The border is enough.

- **ST-11 [P2] Studio row label:** the code and 12.6 disagree.
  - Where: `chat/settings/primitives.tsx:251`. Rules: 12.6, 4.1.
  - Seen in `settings-account-1280-dark.png`, `settings-desktop-1280-dark.png`: labels are visibly larger than the 13px descriptions.
  - What: the label is `text-ui-base` (15px); 12.6 says `text-ui-sm` (13px). Adopters will copy the code.
  - Fix: decide which wins, change the code or amend 12.6, before the server, channel and room migration.

- **ST-12 [P2] Touch targets in settings:** controls fall below 44px on coarse pointers. diag-summary confirms it.
  - Nav rows `h-8` with no HIT or PRESS: `chat/SettingsModal.tsx:478-480` (9 buttons at 223×32 on `settings-*-768-*`, coarse).
  - Search `h-9`: `SettingsModal.tsx:383` (366×36 at 390).
  - `SelectTrigger` `h-9`: `ui/select.tsx:40` via `primitives.tsx:323` (324×36 at 390).
  - `SelectItem` `min-h-8`: `ui/select.tsx:115`.
  - Range 20px tall: `primitives.tsx:392`, `src/styles.css:1235` (268×20 at 390).
  - Privacy segments `h-7`: `PrivacyPanel.tsx:360` (69×28 and 60×28).
  - Rules: 9.1, 13.4, 12.7.
  - Fix: HIT on nav rows; `pointer-coarse:min-h-11` on the trigger, search and items; a 44px coarse height for `.rm-settings-range`.

- **ST-13 [P2] Privacy, shared messages:** the filter is a pill segmented control.
  - Where: `chat/settings/PrivacyPanel.tsx:343-368`. Rules: 13.5, 5.1, 6.1, 9.1. Seen in `settings-privacy-390-dark.png`.
  - Fix: `Tabs` or a two-option `RadioList`.

- **ST-14 [P2] Sessions:** the error state contradicts itself.
  - Where: `chat/settings/SessionsPanel.tsx:209-223`, `:147` → `:162`. Rules: 14.3, 14.1. Seen in `settings-sessions-390-dark.png`.
  - What:
    - After a failed load, "Other devices" still says "No other devices are signed in", which is a false empty state.
    - A revoke failure for another device is shown in the This-device card footer.
  - Fix: hide the empty copy when there is an error, and show revoke errors per row (as `PrivacyPanel.tsx:285` does).

- **ST-15 [P2] Voice & video and Camera:** there is no loading, permission or no-device state.
  - Voice: `chat/settings/VoiceVideoPanel.tsx:84-112`, `:250-262`. With empty labels before permission is granted, the list collapses to "Default microphone" with no hint and no Allow action.
  - Camera modal: `CameraSettingsModal.tsx:408-415` shows a black preview with no spinner and no error. Compare `settings/CameraCard.tsx:279-280`, which has `previewError`.
  - Rules: 14.2, 14.3.
  - Fix: a mic-access row when devices come back unlabeled; `Spinner size-6` while the preview starts; reuse `CameraCard`'s error copy.

- **ST-16 [P2] Server settings tabs:** they use native `confirm()`.
  - Where: `chat/RoleManagement.tsx:165`, `chat/ChannelPermissionsTab.tsx:538`. Unban (`chat/ServerSettingsModal.tsx:175-181`) has no confirm at all. Rules: 13.1, 14.
  - Fix: `useConfirm` + `ConfirmStrip` (`settings/primitives.tsx:551-614`).

- **ST-17 [P2] Errors go only to the console:** the user gets no feedback.
  - `chat/ServerSettingsModal.tsx:591`, `:602`, `:660`, `:674` (a failed server delete leaves the dialog open with no message).
  - `chat/InvitesTab.tsx:155`, `:208`, `:236`, `:247`.
  - `chat/ChannelPermissionsTab.tsx:475`, `:530`, `:559`.
  - `settings/DesktopPanel.tsx:63-66`.
  - `settings/CameraCard.tsx:183`.
  - Rule: 14.3.
  - Fix: a `RowError` next to the control, and keep the confirm open on failure.

- **ST-18 [P2] Desktop panel:** the restart confirm builds its own modal.
  - Where: `chat/settings/DesktopPanel.tsx:88-104`. Rules: 13.1, 12.8, 3.1, 6.1.
  - What: its own `div fixed inset-0 z-60 bg-rm-scrim`, `max-w-[420px] p-5 border-rm-border-strong shadow-[var(--rm-shadow-3)]`, footer `sm:flex-row`.
  - Fix: `ResponsiveDialog` at confirm width.

- **ST-19 [P2] RoomSettingsModal:** it duplicates Studio settings in legacy styling.
  - Where: `RoomSettingsModal.tsx:491-1306`. Rules: 12.6, 7.1, 7.3, 4.1.
  - What:
    - Duplicates `VoiceVideoPanel`, `CameraCard` and `AppearancePanel`.
    - Palette colours: `text-emerald-400` decorative icon (`:641`); amber slider and value (`:683`, `:699`, `:712`, `:729`).
    - Raw range inputs.
    - `text-xl font-bold` (`:493`).
    - A stale "Visual Comfort" card (`:1291-1306`).
    - The scroller is capped `max-w-[600px]` (`:486`), so the scrollbar is not at the edge.
  - Fix: render the Studio cards inside the shared workbench.

- **ST-20 [P2] ChannelSettingsModal:** the save success flash uses palette colours.
  - Where: `chat/ChannelSettingsModal.tsx:375-387`. Rules: 7.1, 7.3, 13.2, 6.1.
  - What: `bg-green-500 text-white shadow-green-500/20` on a hand-rolled `rounded-xl shadow-lg` button.
  - Fix: `Button` with `loading`, then a "Saved" status in `text-rm-success-ink`.

- **ST-21 [P2] CameraSettingsModal:** wrong overlay type on phone.
  - Where: `CameraSettingsModal.tsx:366-369`, `:381`, `:387-401`, `:418`, `:423-437`, `:474`. Rules: 13.1, 6.5, 6.3, 3.6, 9.1, 9.3.
  - What:
    - Its own scrim `bg-black/85 backdrop-blur-sm`; a centred `max-w-[540px] rounded-2xl` dialog even on phone.
    - Close button `p-1` with no HIT.
    - Restyled Select (`rounded-xl py-3`, `shadow-2xl`).
    - `sm:grid-cols-3`.
    - 13 bare hovers.
  - Fix: `ResponsiveDialog` with `CameraCard` as the body.

- **ST-22 [P2] Create Server, Channel and Category modals:** the desktop branch draws its own dialog.
  - CreateCategory: `chat/CreateCategoryModal.tsx:104-157` (scrim `:114`, `h2` instead of `DialogTitle` `:130`, `sm:` `:142`; uppercase input `:66-69`).
  - CreateChannel: `CreateChannelModal.tsx:261-330`.
  - CreateServer: `CreateServerModal.tsx:277-345` (`sm:` classes always on at ≥768).
  - Footer order flips between branches.
  - Rules: 13.1, 12.8, 4.7, 6.3.
  - Fix: drop the fork and use `ResponsiveDialogContent` for both.

- **ST-23 [P2] ThemePreviewSidebar:** legacy anatomy throughout.
  - Where: `chat/ThemePreviewSidebar.tsx:64`, `:66`, `:69-70`, `:92-97`, `:104`, `:116-121`.
  - What: header `py-4` (not `h-12`); `text-lg font-bold`, `text-xs font-bold`; `rounded-2xl`/`rounded-xl`; hand-rolled button; no safe areas; on a 390 phone it is a 320px side panel.
  - Rules: 12.10, 4.1, 4.2, 5.1, 13.1, 3.6.
  - Fix: `Sheet` on desktop, `Drawer` on phone, and reuse the `AppearancePanel` theme grid.

- **ST-24 [P2] UpdateChecker / StandaloneUpdater:** off-ladder z-index and hand-rolled controls.
  - UpdateChecker:
    - `UpdateChecker.tsx:125`: `z-90` (not on the ladder), no safe area, a 0.3s keyframe with no reduced-motion fallback.
    - `:140`, `:146`, `:184`, `:190`: `bg-rm-accent text-white` hand-rolled buttons with bare `hover:`.
    - `:162-165`: `transition-[width]`.
    - No `role="status"`; the error state gives no reason.
  - StandaloneUpdater: `StandaloneUpdater.tsx:206` `h-screen w-screen`; `:215` hand-rolled button.
  - Rules: 11.1, 7.1, 9.3, 10.2, 10.5, 3.4, 13.2.
  - Fix: a `z-80` toast with `Button`s, a `scaleX` progress bar, and `role="status"`; `h-dvh w-full`.

- **ST-25 [P2] Capture failure needs a manual check:** `settings-desktop-390-dark.png` and `-light.png` are solid black in both themes, while every other panel rendered at 390.
  - Where: `dev/UiFixtures.tsx:853-857` (passes `{desktop:true}`), `chat/SettingsModal.tsx:190-194` (uses `isDesktop()`, not `env`).
  - Fix: reproduce at 390. If it crashes, gate the Tauri calls in `DesktopPanel` on `env.desktop`.

#### P3

- **ST-26 [P3] Studio search field:** `chat/SettingsModal.tsx:411`, rules 4.1, 3.1, 4.6. It uses `text-base sm:text-ui-sm`; the same pattern is in `ui/select.tsx:40`. Fix: `text-ui-md md:text-ui-sm`.

- **ST-27 [P3] Raw server errors and an icon-less error strip:** `err.message` reaches the UI at `settings/SessionsPanel.tsx:132`, `:147` and `settings/PrivacyPanel.tsx:305`. `RowError` has no icon (`settings/primitives.tsx:531-540`). Rule 14.3. Seen in `settings-sessions-390-dark.png` and `settings-privacy-390-dark.png` ("Authentication required").

- **ST-28 [P3] RoomSettingsModal sidebar:** `RoomSettingsModal.tsx:418-419`. The inline `paddingTop` style overrides `md:pt-10`, so the desktop sidebar loses its 40px top padding.

- **ST-29 [P3] AuditLogTab states:** `chat/AuditLogTab.tsx:105-131`. Loading, error and empty states drop the page heading (only rendered at `:136-141`); the loader is `Icon 2xl` rather than `Spinner`; the empty state uses the 📋 emoji. Rules 14.1, 14.2, 8.1.

- **ST-30 [P3] Studio nav row anatomy:** `chat/SettingsModal.tsx:479-486`. The icon is `sm` where 8.2 says `md`; the selected state is `bg-rm-bg-active font-medium` with no Fill icon or 600 weight (14.5); press is `active:scale-[0.98]`, not `PRESS`.

- **ST-31 [P3] Copy and hierarchy in the narrow rail:** the rail note "Changes apply as you pick" (`settings/rails.tsx:246`) repeats the page blurb. Seen in `settings-390-dark.png` and `settings-768-dark.png`. The folded rail (`SettingsModal.tsx:652`) has an `h4 text-ui-sm` title next to `text-ui-md` card titles.

- **ST-32 [P3] Phone page header deviates from 12.2:** `chat/SettingsModal.tsx:564-586` is `h-14`, title `text-ui-xl`, back `IconButton sm`. The doc contradicts itself (4.1 says the settings panel heading is `text-ui-xl`). Pick one.

- **ST-33 [P3] No-match state is a dashed card:** `chat/SettingsModal.tsx:608`, rule 14.1.

- **ST-34 [P3] Studio dialog frame:** `chat/SettingsModal.tsx:700`. `md:border-rm-border-strong` and `shadow-[var(--rm-shadow-3)]` should be `border-rm-border shadow-2xl` (12.8, 6.1).

- **ST-35 [P3] Soundboard:**
  - The picker opens at `z-[1100]`/`z-[1090]`/`z-[1200]` with its own scrim: `chat/SoundboardPicker.tsx:1373-1374`, `:2747`.
  - `iconSize="sm"` overrides: `settings/SoundboardPanel.tsx:121`, `:131`, `:139`.
  - Clear acts immediately: `:134-141`.
  - `h-5 w-5` should be `size-5`: `:42`, `:47`.

- **ST-36 [P3] Keybinds on phones:** `settings/schema.ts:416`, `:675`. Seen in `settings-keybinds-390-dark.png`: keyboard shortcuts on a touch phone.

- **ST-37 [P3] Confirm-strip weight:** `settings/primitives.tsx:603-608` with `SessionsPanel.tsx:103`. "Sign out device" uses the solid `danger` button but is reversible; use `destructive` (1.1, 13.2).

- **ST-38 [P3] CameraCard remove button:** `settings/CameraCard.tsx:106` is `size-6` with no HIT and a bare `group-hover:`; `:455` has a dead `backdrop-blur-sm`.

- **ST-39 [P3] Off-scale values in the reference files:**
  - `settings/primitives.tsx:113` (`rounded-[3px]`).
  - `settings/AppearancePanel.tsx:134`, `:148`, `:158`, `:163` (swatch mock; add to the allowlist).
  - `settings/rails.tsx:78`, `:94`, `:105`.
  - `AppearancePanel.tsx:202` (container steps 480/640 against the documented 560).

- **ST-40 [P3] SettingsHost has no loading feedback:** `chat/SettingsHost.tsx` uses Suspense `fallback={null}`, so a slow first open shows nothing (14.2).

- **ST-41 [P3] Search autofocus on coarse tablets:** on 768 coarse the search field is autofocused on open, which raises the on-screen keyboard.

- **ST-42 [P3] Server and channel overview leftovers:**
  - Bare `group-hover:`: `ServerSettingsModal.tsx:253`, `:264`, `:266`, `:740`.
  - `text-white` "Change" label over the image: `:254`.
  - Inputs use `border-rm-border` (below the 3:1 field-edge floor), custom focus rings and no `h-9`: `:340`; `ChannelSettingsModal.tsx:167`, `:202`, `:231`.
  - Amber/yellow banner: `InvitesTab.tsx:462`.
  - Raw hex role fallbacks: `RoleManagement.tsx:289`, `:296`; `ChannelPermissionsTab.tsx:167`, `:249`.

#### Shared causes

1. **Unlayered `:focus-visible` plus programmatic focus on `tabIndex={-1}` targets** (`src/styles.css:1129`). `outline-none` cannot opt out.
   - Affected: `SettingsModal.tsx:279`, `:287`, `:577`, `:689`, `:722`; `primitives.tsx:223-224`; `rails.tsx:187-188`.
   - One rule in `styles.css` fixes all of them (ST-01).

2. **No shared workbench shell.** Studio's nav, push page, header and container body live inline in `SettingsModal.tsx:364-760`. Each of these re-implements a weaker copy with its own scrim, size and phone behaviour:
   - `ServerSettingsModal.tsx:678-813`
   - `ChannelSettingsModal.tsx:128-232`
   - `RoomSettingsModal.tsx:403-490`
   - `CameraSettingsModal.tsx:363-401`
   - `ProfileEditorModal.tsx:17-48`
   - `SettingsModal.tsx:765-797`
   - `DesktopPanel.tsx:81-104`
   - the three Create\* desktop branches

   A `SettingsWorkbench` component plus `ResponsiveDialog` clears most of ST-08, ST-09, ST-18, ST-19, ST-21 and ST-22.

3. **Primitives without coarse-pointer sizing:**
   - `ui/select.tsx:40` and `:115` have no `pointer-coarse:min-h-11`; `SelectContent` at `:65` is `z-[110] rounded-[10px]`.
   - `.rm-settings-range` is 20px tall (`styles.css:1235`).
   - The nav row does not use `HIT`/`PRESS`.

   Fixing these clears every sub-44px item that diag-summary lists for settings.

4. **The reference recipe disagrees with its own spec:** the light-theme card shadow (`primitives.tsx:153`), `text-ui-base` labels (`:251`), `rounded-[3px]` (`:113`), and `RowError` with no icon (`:531`). Fix these, or amend 12.6, before migrating the other surfaces.

5. **Errors only reach the console, and native `confirm()`, across the server-settings family** (ST-16, ST-17). `RowError`, `useConfirm` and `ConfirmStrip` already exist but are unused outside `chat/settings/`.

6. **Raw `err.message` shown to users:** `SessionsPanel.tsx:132`, `:147`; `PrivacyPanel.tsx:305`; `SettingsAccountTab.tsx:2940`. Add one `describeApiError()` helper.

7. **Legacy files still in the reachable path with high regex debt:**

   | File                  | Findings |
   | --------------------- | -------- |
   | `SettingsAccountTab`  | 193      |
   | `RoomSettingsModal`   | about 55 |
   | `CreateServerModal`   | 24       |
   | `ServerSettingsModal` | 23       |
   | `CameraSettingsModal` | 22       |
   | `InvitesTab`          | about 20 |
   | `RoleManagement`      | 12       |
   | `UpdateChecker`       | 12       |
   | `AuditLogTab`         | 11       |

   For comparison, all Studio panels together have 13, mostly swatch and allowlist candidates.

#### Needs fixture

- **ServerSettingsModal**: Overview (admin/owner, delete confirm), Roles, Bans (loading/empty/list), Invites (paused/create/revoke), Audit (loading/empty/error/list). Shoot at 390, 768 and 1280 in both themes.
- **ChannelSettingsModal**: Overview + Permissions, with an override selected so the tri-state row from ST-03 shows.
- **RoomSettingsModal**: Voice / Camera / Appearance.
- **CameraSettingsModal**: with a stream, without permission, and while uploading.
- **Profile editor** through both mounts: no-user state, dirty save bar, error state, rail collapsed and expanded, and phone.
- **ThemePreviewSidebar** at 390 and 1280.
- **DesktopPanel** hardware-acceleration confirm.
- **Soundboard → Change sound**: picker over the settings dialog (z-order).
- **Deep-link landing** `?row=echo-cancellation` (row focus ring).
- **Studio search**: results and no-match state.
- **Create Server, Channel and Category** on desktop and phone.
- **UpdateChecker** and **StandaloneUpdater** states.
- **Re-shoot** the failed captures, especially `settings-desktop-390-*`.

---

### Pickers, message modals, side panels, activities, system states (PK)

> Superseded: PK-09 (CollectiblesCatalogModal), the ShopView row of PK-10, PK-38 (SearchPanel/ShopView) — `ui/search` and `ui/shop` are merged; the Base UI drawer (`ui/drawer`) replaces the vaul internals referenced in shared cause 2.

**Scope.** 44 files, about 33k lines. Paths are relative to `src/components/` unless they start with `src/`. Static counts come from `node scripts/audit-design-system.mjs src/components --list`, filtered to this area. I checked overlay choice, z-index, targets, hover and motion by hand.

**Area totals from the checker:**

| rule                                 | count |
| ------------------------------------ | ----- |
| Tailwind `text-*` sizes              | 261   |
| `text-[Npx]`                         | 59    |
| bare `hover:` / `group-hover:` lines | 81    |
| dead `backdrop-blur`                 | 73    |
| hand-rolled `shadow-[...]`           | 58    |
| palette-hue lines                    | 141   |
| raw colour (hex, rgb)                | 21    |
| `vh` / `h-screen` / `w-screen`       | 33    |
| off-ladder `z-*`                     | 10    |
| `transition-all`                     | 6     |
| `window.innerWidth` breakpoint       | 3     |

#### Inventory

| View                                                            | How to reach                                | Fixture                                          | Screens checked                     | Score 0-4 | Top issues (max 3)                                                                                                         |
| --------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------ | ----------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------- |
| EmojiPicker                                                     | Composer emoji button; reaction "+"         | none                                             | code only                           | 2         | rounded-3xl surface, hand-rolled shadows and own click-catcher scrim; vh heights; 14px phone input; amber/emerald strips   |
| GifPickerModal                                                  | Composer GIF button; voice reactions        | none                                             | code only                           | 1         | favourite only on hover (no touch path); expanded mode z-90 + bg-black/55 scrim; pill tabs; 32px close with no HIT         |
| SoundboardPicker (+ delete confirm)                             | Voice dock soundboard; composer             | none                                             | code only                           | 1         | inline z 259/260/1090/1100, z-[1200]; preview/edit/delete/favourite only on hover; 39 palette hues, 16 dead blurs          |
| PickerSurface                                                   | shell for the 3 pickers                     | none                                             | code only                           | 3         | lets callers pass arbitrary drawer z classes; otherwise follows 13.1                                                       |
| GifFavoriteButton                                               | GIF tiles in messages and picker            | none                                             | code only                           | 2         | amber star in an inline SVG; state shown by scale; z-30 inside a tile                                                      |
| MessageShareModal                                               | Message menu > Share                        | none                                             | code only                           | 1         | phone form is a hand-rolled bottom sheet (no handle, no safe area); bg-black/60 scrim; px-5 header                         |
| PinModal                                                        | Message menu > Pin                          | none                                             | code only                           | 2         | desktop branch hand-rolls the scrim; 480px confirm; text-[14px]                                                            |
| ReactionDetailsModal                                            | Long-press or click a reaction              | none                                             | code only                           | 2         | desktop hand-rolled scrim; px-5 py-4 header; uses `sm:`                                                                    |
| UploadSoundModal                                                | Soundboard > Upload / Edit                  | none                                             | code only                           | 2         | desktop hand-rolled scrim (bg-black/50); w-[480px] max-w-[90vw]                                                            |
| ExternalLinkConfirmModal                                        | Click an untrusted link                     | none                                             | code only                           | 3         | max-w-[510px] confirm; checkbox row under 44px                                                                             |
| ImageViewer (Modal/Toolbar/Thumbnails/Content/Navigation)       | Click an image attachment                   | none                                             | code only                           | 1         | unlabelled close/prev/next; z-50/60/70 inside the surface; hand-rolled menu with solid accent hover                        |
| ImageGrid + AttachmentList                                      | Message attachments; composer pending files | none                                             | code only                           | 2         | delete only on hover + `window.confirm`; 28px targets; 7 dead blurs                                                        |
| VideoAttachment + VideoPlayerControls                           | Video attachment                            | none                                             | code only                           | 2         | fullscreen `w-screen h-screen`; vh max-heights; 32px controls with no HIT                                                  |
| LinkEmbed                                                       | Any message with a URL                      | none (seen in the background of drawer-390-dark) | drawer-390-dark (incidental)        | 1         | hex link colour #00A8FC; 7 off-scale radii; 39 bare hovers, 42 text-[px], 6 transition-all; hand-rolled RemoveEmbeds modal |
| SensitiveMediaFrame                                             | Media with the high filter on               | none                                             | code only                           | 3         | uppercase button and over-tracked eyebrow; 32px Show button                                                                |
| DragDropOverlay                                                 | Drag a file over the chat                   | none                                             | code only                           | 2         | z-50 (should be 30); `zoom-in` starts from scale 0                                                                         |
| MentionAutocomplete + InputMentionOverlay                       | Type `@` in the composer                    | none                                             | code only                           | 2         | z-50 inside the composer; 40px rows not MENU_ITEM; accent-tint highlight                                                   |
| HoveredMentionTooltip                                           | Hover a mention                             | none                                             | code only                           | 2         | hand-rolled tooltip, not inverted                                                                                          |
| ThreadSidebar                                                   | Message > Open thread                       | none                                             | code only                           | 1         | phone: hand-rolled `fixed inset-0 z-20` page with no back handler; 380px wide; text-sm title                               |
| PinnedMessagesSidebar                                           | Header > Pins                               | none                                             | code only                           | 1         | in-panel `absolute inset-0 z-50` overlay (ChatArea); actions only on hover; 420px + 100vh                                  |
| SearchPanel (superseded by ui/search)                           | Header search                               | none                                             | code only                           | 2         | vh max-height; rounded-[5px]                                                                                               |
| ShopView (superseded by ui/shop)                                | Shop                                        | none                                             | code only                           | 1         | 168 checker hits; bg-black/72 scrim; 21 shadows                                                                            |
| CollectiblesCatalogModal (superseded by ui/shop)                | Shop > catalogue                            | none                                             | code only                           | 1         | createPortal z-70 with no Escape, focus trap or back                                                                       |
| ListenTogetherPanel                                             | Soundboard > Listen                         | none                                             | code only                           | 1         | `innerWidth < 1024`; segmented pill; rounded-2xl/3xl cards with shadow                                                     |
| ListenTogetherNowPlayingCard                                    | Panel + floating player                     | none                                             | code only                           | 2         | 5 hand-rolled shadows; min-w-[34px]                                                                                        |
| ListenTogetherResultActions                                     | Phone: tap a search result                  | none                                             | code only                           | 1         | hand-rolled action sheet (own scrim, focus trap, Escape); no safe area or back                                             |
| FloatingListenTogetherPlayer                                    | Playback while the panel is closed          | none                                             | code only                           | 3         | z-40                                                                                                                       |
| FloatingSoundboardManager                                       | Active soundboard playback                  | none                                             | code only                           | 2         | z-40; `touch-none` on a scroll container                                                                                   |
| ActiveSoundboardEffectList                                      | Voice stage                                 | none                                             | code only                           | 3         | text-xs                                                                                                                    |
| WordleActivityStage                                             | Voice activity > Wordle                     | none                                             | code only                           | 2         | hex tiles; 3 hand-rolled dialog wrappers; 53 Tailwind text sizes                                                           |
| WarpRushActivityStage                                           | Voice activity > WarpRush                   | none                                             | code only                           | 1         | 56 palette-hue lines + hex; needs `--rm-activity-*` tokens                                                                 |
| ConnectionOverlay                                               | Socket disconnect                           | overlay                                          | overlay-{390,768,1280}-{dark,light} | 3         | 1280 shots blank; fixture shows "Connecting..." not the reconnect state; no safe-area pad                                  |
| SplashScreen / LoadingScreen                                    | App boot                                    | splash                                           | splash-{390,768,1280}-{dark,light}  | 4         | splash-1280-light blank (capture); tip timeout not cleared                                                                 |
| MarkdownRenderer / NewMessageSeparator / AudioCompatibilityHint | Message body / unread line / audio info     | none                                             | code only                           | 3 / 4 / 3 | text-xs code block; 12px tooltip-only info icon                                                                            |

#### Findings

- **PK-01 [P1] Pickers, pins, attachments, embeds** — `chat/GifPickerModal.tsx:2105`, `chat/SoundboardPicker.tsx:2140,2226,2341` (reveals at 1782,1847,1865,1894,1958,1970,1999,2082,2086,2130,2298,2306,2425,2446,2541,2556,2571,2594), `chat/PinnedMessagesSidebar.tsx:274`, `chat/ImageGrid.tsx:26`, `chat/AttachmentList.tsx:123,172`, `chat/LinkEmbed.tsx:5121` — rule 9.3, 9.5 — code only. Actions only show on hover (`opacity-0 group-hover:opacity-100`): GIF favourite, soundboard preview/edit/delete/favourite, pin Jump/Unpin, attachment delete, remove embeds. None of the three pickers uses `useLongPress` or `onContextMenu` (0 matches each), so on a phone these actions can't be reached at all, or a tap latches them. PinnedMessagesSidebar:274 also slides on hover (`-translate-y-1 group-hover:translate-y-0`). — Fix: show these controls all the time on `pointer-coarse`, or move them to a long-press ActionSheet that shares the context-menu items. Gate the rest with `pointer-fine:group-hover:`.
- **PK-02 [P1] LinkEmbed: RemoveEmbedsModal** — `chat/LinkEmbed.tsx:411-458` (mounted at 5142) — rule 13.1, 11.2, 7.1, 4.1 — code only. A fully hand-rolled modal: `fixed inset-0 z-50`, not portalled (it renders inside the message row), no `role="dialog"`, no focus trap, no Escape, no back button. Scrim is `bg-black/60`. Danger button is `bg-[#da373c] hover:bg-[#a12828] text-white` with bare hover. Type is `text-xl` and `text-[14px]/[12px]`, and the title uses `text-rm-text-primary` (dead, see PK-18). — Fix: use `ResponsiveDialog` with a confirm-width (`md:max-w-sm`) content and `Button variant="danger"`.
- **PK-03 [P1] ListenTogetherResultActions** — `chat/ListenTogetherResultActions.tsx:95-148` — rule 13.1, 3.6, 3.1, 6.5 — code only. A hand-rolled phone action sheet: `createPortal` + `fixed inset-0 z-50 bg-black/55`, its own focus trap and Escape handler (66-90), no back-button handling, no `--safe-area-bottom` padding. It is gated by `lg:hidden`, so `lg` acts as the phone breakpoint, which is wrong. Shadow is `shadow-[0_-20px_60px_…]`, corners `rounded-3xl`. — Fix: render `ui/action-sheet.tsx` with the same item model and gate it with `useIsMobile()`.
- **PK-04 [P1] ThreadSidebar (phone)** — `chat/ThreadSidebar.tsx:169` — rule 13.1, 11.1, 3.6 — code only. On phones the panel becomes `max-md:fixed max-md:inset-0 max-md:z-20 max-md:shadow-2xl`. That is a hand-rolled full page on the chrome layer (it ties with the composer and header at z-20), with no back-button registration and no safe-area insets. — Fix: on phones, render it in `Drawer direction="right"` (or a full page with header + back); on desktop use the docked 360 column / `Sheet` (12.10).
- **PK-05 [P1] PinnedMessagesSidebar overlay** — `src/components/chat/ChatArea.tsx:318-341`, `chat/PinnedMessagesSidebar.tsx:54-56` — rule 13.1, 11.2, 6.5, 3.4 — code only. The host is `absolute inset-0 z-50` inside the chat column (not portalled). The scrim is `bg-rm-bg-primary/50` with a dead `backdrop-blur-sm`. Escape only fires through `onKeyDown` on the wrapper, so focus must already be inside, and there is no focus trap. The panel is `sm:w-[420px] sm:max-h-[calc(100vh-120px)]` with `shadow-2xl`. — Fix: `Sheet side="right"` at 360 on desktop below `lg`, and a `Drawer` on phones, same as search and threads.
- **PK-06 [P1] Soundboard / GIF z-index** — `chat/SoundboardPicker.tsx:1341-1342` (inline `zIndex` 259/260/1090/1100), `:1373-1374` (`z-[260]`, `z-[1100]`, `z-[259]`, `z-[1090]`), `:2747` (`max-md:z-[1200]`); `chat/GifPickerModal.tsx:317` (`z-90` when expanded) — rule 11.1 — code only. These values sit off the ladder. 1100/1200 sit above the system layer (100), so the soundboard covers ConnectionOverlay and IncomingCall. The checker misses the inline `style.zIndex` values. — Fix: picker = `z-50`, or `z-60` when opened from a dialog; the delete confirm = `z-60`. Let `PickerSurface` own the z-index and drop the `drawerClassName`/`drawerOverlayClassName` z overrides (`chat/PickerSurface.tsx:47-48`).
- **PK-07 [P1] MessageShareModal (phone)** — `chat/MessageShareModal.tsx:82-101` — rule 13.1, 12.9, 3.6, 6.5 — code only. A plain `Dialog`. On phones it fakes a drawer (`items-end`, `rounded-t-xl`) with no handle, no drag-to-dismiss and no `pb-[max(16px,var(--safe-area-bottom))]`. Scrim is `bg-black/60` with a dead blur. Header is `px-5 py-4` (12.8 asks for `p-6`), width is `max-w-[560px]`, the subtitle is `text-xs`, and the phone footer buttons are not `min-h-11`. — Fix: `ResponsiveDialog` with content width `md:max-w-lg`; the drawer footer then gets full-width 44px buttons.
- **PK-08 [P1] ImageViewer controls** — `chat/ImageViewerModal.tsx:554-559`, `chat/ImageViewerNavigation.tsx:15-33` — rule 8.5, 8.2, 7.4, 9.1 — code only. The clean-mode close button and both prev/next buttons have no accessible name. Arrows use `Icon size="2xl"/"3xl"` inside controls (display-only steps) and are `text-rm-text-muted/40`, which is about 2:1, below the 3:1 glyph floor. The clean-mode close is `p-2` + `md` icon = 34px with no HIT. — Fix: `IconButton` with `aria-label` ("Close viewer", "Previous image", "Next image"), sizes `md`/`lg` with `xl` icons, `text-rm-text-secondary`.
- **PK-09 [P1] CollectiblesCatalogModal (superseded by ui/shop — re-check after merge)** — `chat/CollectiblesCatalogModal.tsx:690-692` — rule 13.1, 11.1, 3.4 — code only. `createPortal` + `fixed inset-0 z-70 bg-black/70` with no Escape, focus trap or back handling; `max-h-[88vh]`; 5 hex colours (136,203,292,377,401). — Fix: `Dialog` workbench / `PickerSurface`.
- **PK-10 [P2] Desktop dialogs that hand-roll the scrim** — `chat/PinModal.tsx:185-191` (`bg-black/60`), `chat/ReactionDetailsModal.tsx:205` (`bg-black/60`, `sm:p-5`), `chat/UploadSoundModal.tsx:244` (`bg-black/50`), `chat/WordleActivityStage.tsx:109,457,1504,1637` (`bg-black/50`), `chat/GifPickerModal.tsx:1396` (`bg-black/55`), `chat/SoundboardPicker.tsx:2747` (`bg-black/50 dark:bg-black/80`), `chat/ShopView.tsx:1015` (`bg-black/72`, superseded) — rule 6.5, 13.1, 12.8 — code only. Seven files put their own `fixed inset-0` scrim inside `DialogPortal`. Pin, Reaction and Upload also branch on `isMobile` (PinModal:159, ReactionDetailsModal:192, UploadSoundModal:~215), so `ResponsiveDialogContent` only runs on phones. Widths are off the 12.8 steps:

  | file:line                   | width                      | 12.8 step           |
  | --------------------------- | -------------------------- | ------------------- |
  | PinModal:202                | `max-w-[480px]`            | confirm 384         |
  | UploadSoundModal:248        | `w-[480px] max-w-[90vw]`   | form 448            |
  | ReactionDetailsModal:213    | `max-w-[720px]`            | none                |
  | ExternalLinkConfirmModal:40 | `max-w-[510px]`            | confirm 384         |
  | WordleActivityStage:466     | `max-w-[500px] rounded-lg` | dialog radius is xl |

  Close buttons sit at `top-4 right-4` (UploadSoundModal:255, ExternalLinkConfirmModal:47) instead of `top-3 right-3`. — Fix: drop the `isMobile` ternaries and use `ResponsiveDialogContent` with `md:max-w-sm|md|lg`; `DialogOverlay` supplies `bg-rm-scrim`.

- **PK-11 [P2] Soundboard delete confirm** — `chat/SoundboardPicker.tsx:2738-2808` — rule 13.1, 12.8, 13.2, 4.1 — code only. A `Dialog`, not a `ResponsiveDialog`, so phones get a 320px centred card. It has `rounded-2xl`, `shadow-[0_22px_80px_rgba(0,0,0,0.8)]`, `text-lg`/`text-sm`, and hand-rolled buttons (`bg-destructive text-white shadow-lg`, `rounded-xl`) instead of `Button variant="danger"` / `secondary`. — Fix: ResponsiveDialog confirm.
- **PK-12 [P2] Picker surface recipe** — `chat/EmojiPicker.tsx:769,784,853`, `chat/GifPickerModal.tsx:1384-1404`, `chat/SoundboardPicker.tsx:1355-1360,1388`, `src/styles.css:1625-1660` — rule 5.1, 6.1, 6.3, 7.1, 1.1, 13.1 — code only.
  - All three surfaces use `rounded-3xl` (24, a reserve step); 13.1 says an anchored picker is a `MENU_PANEL`-style popover (`rounded-lg`, 12).
  - Emoji uses `shadow-[0_8px_30px…] dark:shadow-[0_22px_80px…]`.
  - Each picker adds its own outside-click scrim on top of PickerSurface: Emoji:769 is a transparent full-screen `<button>`, Gif:1384 has `desktopWrap`, Soundboard:1355 has an `aria-hidden` div.
  - Search inputs and chips are `rounded-2xl h-11`.
  - In `styles.css`, `.picker-header` paints a decorative gradient with a hard-coded `rgba(229,9,20,0.08)` red, and `.picker-panel` forces `--rm-bg-floating` with `!important`.
  - Skin-tone popover at Emoji:853 has a dead `backdrop-blur-2xl`.

  Fix: one desktop recipe in PickerSurface (`MENU_PANEL` + `rounded-lg`, `shadow-lg`). Remove the per-picker scrims and use the non-modal Dialog's own outside-press handling. Delete the `.picker-header` gradients.

- **PK-13 [P2] Viewport units** — rule 3.4 — code only. 33 matches:
  - Pickers: `chat/EmojiPicker.tsx:751` (`max-h-[80vh] sm:max-h-[600px]`), `:1046,1364` (`70vh`); `chat/GifPickerModal.tsx:1346` (inline `"68vh"`), `:1372` (`82vh`), `:1375` (`68vh`); `chat/SoundboardPicker.tsx:891-892` (inline `82vh`/`75vh`, not seen by the checker).
  - Also: `chat/ImageViewerContent.tsx:71,147`; `chat/VideoAttachment.tsx:462,467` (fullscreen `w-screen! h-screen!`); `chat/PinnedMessagesSidebar.tsx:54`; `chat/FloatingSoundboardManager.tsx:231`; `chat/WordleActivityStage.tsx:466`; `chat/WarpRushActivityStage.tsx:1226`; `chat/SearchPanel.tsx:240`, `chat/ShopView.tsx:1024`, `chat/CollectiblesCatalogModal.tsx:692` (superseded).

  Fix: `dvh` everywhere. Desktop pickers become `max-h-[min(600px,calc(100dvh-24px))]`; VideoAttachment fullscreen becomes `inset-0 size-full`.

- **PK-14 [P2] Phone inputs under 16px** — `chat/EmojiPicker.tsx:820` and `chat/SoundboardPicker.tsx:1420` (`text-[14px]`), `chat/GifPickerModal.tsx:1605` (`text-ui-base`, 15), `chat/ThreadSidebar.tsx:323` (`text-sm`) — rule 4.6, 7.4 — code only. iOS zooms the page when these fields get focus. The thread placeholder is `text-rm-text-muted/30`, far below 4.5:1. — Fix: `text-ui-md md:text-ui-sm`; placeholder `text-rm-text-muted`.
- **PK-15 [P2] Targets under 44px with no HIT** — rule 9.1 — code only. Only the `Button`/`IconButton` primitives carry HIT; the hand-rolled controls in this area don't (0 `HIT` matches in the files below except Thread and Pins).
  - GifPickerModal: 1469 and 1484 (expand/close, `p-2` + 16 = 32px); 1525 (back, 36); 1505 (voice-mode chips, about 22px tall); 2023 (`h-7 w-7`).
  - SoundboardPicker: 1787, 1899, 2451, 2599 (`p-1` + xs icon = 20px); 1981, 2004, 2146, 2187, 2202, 2226, 2311, 2341 (`p-1.5`, 24-28px).
  - ImageViewerToolbar: 172, 181, 195, 208, 369 (`p-2` + 20 = 36).
  - ImageGrid:35 and AttachmentList:127,176 (`p-1.5` + 16 = 28).
  - VideoPlayerControls: 87 (`w-8 h-8`), 283, 305.
  - LinkEmbed: carousel dots 1639 and 4734 (`h-1.5 w-1.5`, 6px); remove-embeds 5121 (`w-5 h-5`); 3462 (`h-7 w-7`).
  - ThreadSidebar:328 (send, `py-1 text-xs`, about 24px); PinnedMessagesSidebar:277,287.
  - ListenTogetherPanel:215,230 (`h-9 w-9`).
  - SensitiveMediaFrame:72 (Show, about 32).

  Fix: add `HIT` (and `PRESS`) to every hand-rolled control, or swap in `IconButton`/`Button`.

- **PK-16 [P2] Favourite star (GIF, soundboard)** — `chat/GifFavoriteButton.tsx:52-66`, `chat/GifPickerModal.tsx:1648,2107,2114-2121`, `chat/SoundboardPicker.tsx:1592,1708,1772,1885,1990,2237,2352,2434,2582` — rule 7.3, 8.1, 8.4, 1.3 — code only. "Favourite" is painted amber/yellow, which is the idle/warning hue, used here as decoration. The glyph is an inline `<svg>` star, and the favourite state is also shown by size (`scale-105`/`scale-110`). GifFavoriteButton is `bg-white/95 text-black … dark:bg-black/70 dark:text-white`. — Fix: `<Icon name="star" state={fav ? "active" : "idle"} />` in `text-rm-accent-ink` or current colour, with no scale change.
- **PK-17 [P2] Palette hues and `text-white` in pickers** — rule 7.1, 6.5 — code only.
  - Soundboard Listen/Upload buttons use gradients `from-sky-500/20 via-blue-500/20 to-cyan-500/20` (SoundboardPicker:1432), `green/teal/emerald` (1452) and `yellow/rose/blue` (1472), plus `text-sky-300` (1437). Green borders at 1675, 1827, 2282, 2521.
  - Emoji status strips use `amber-400/800/100` (EmojiPicker:923) and `emerald-400/800/200` (1016).
  - `bg-primary text-white` at GifPickerModal:1508 and EmojiPicker:1028 (should be `text-primary-foreground`).
  - Soundboard tiles are theme surfaces, yet 12 chips use `bg-black/40–70 text-white` (1787–2599); 6.5 allows black/white alpha only over photos.

  Fix: warning/success ink + tint tokens, `Button variant="secondary"`, and tint chips on theme tiles.

- **PK-18 [P2] Dead colour utility `text-rm-text-primary`** — 33 uses: `chat/LinkEmbed.tsx` ×28 (257, 430, 443, 1441, 1652, 1676, 1708, 1731, 1739, 2282, 2308, 2345, 2408, 2434, 2600, 2618, 2623, 3647, 4544, 4552, 4747, 4776, 4795, 4824, 4847, 4855, 4971, 5121), `chat/DragDropOverlay.tsx:15`, `chat/MentionAutocomplete.tsx:26,65`, `ui/ExternalLinkConfirmModal.tsx:39`, `chat/HoveredMentionTooltip.tsx:37` — rule 7.2 — code only. `styles.css` declares `--rm-text-primary` but maps no `--color-rm-text-primary` in `@theme inline` (only `--color-rm-text`), so the class should generate no CSS. Text falls back to the inherited colour, and `hover:text-rm-text-primary` does nothing. I inferred this from the source; I did not check the built CSS. — Fix: `text-rm-text`.
- **PK-19 [P2] LinkEmbed card variants** — `chat/LinkEmbed.tsx` — rule 12.12, 5.1, 7.1, 4.1, 10.2, 9.3, 8.1 — drawer-390-dark (background embed shows a cyan title next to the indigo accent link).
  - BaseEmbed is `rounded-md` (257); 12.12 says embeds are `rounded-xl`.
  - Title is `text-[#00A8FC]` (280, 4985) instead of `text-rm-accent-ink`; the default left border is `#202225` (260, inline).
  - Provider cards each pick their own radius: TikTok `rounded-[24px]` (1480, 1800), Instagram `rounded-[22px]` (4582), X media `rounded-[18px]`/`[20px]` (2819, 3033, 3039, 3040), plus `shadow-[0_12px_36px…]` (1480, 1800, 4582).
  - 42 `text-[Npx]` and 39 bare hovers.
  - `transition-all` at 1639, 3015-3017 (`duration-300` + `hover:brightness-105`), 4734, 5121; `hover:scale-[1.02]` at 1692 and 4808 (hover must not resize).
  - 18 inline `<svg>` icons; Play/Pause/External/OpenInNew (462, 468, 484, 1971) are generic and belong in `<Icon>`. Brand marks can stay.

  Fix: one `EmbedFrame` (`rounded-xl border border-rm-border bg-rm-bg-surface`), accent-ink titles, `text-ui-*`, `pointer-fine:` hover, `transition-[filter]`/`transition-opacity`.

- **PK-20 [P2] ImageViewer chrome** — `chat/ImageViewerToolbar.tsx:136,236-302`, `chat/ImageViewerThumbnails.tsx:33`, `chat/ImageViewerModal.tsx:530,553`, `chat/ImageViewerNavigation.tsx:19,29`, `chat/ImageViewerContent.tsx:87,167` — rule 11.1, 11.2, 12.7, 1.1, 3.6, 14.2 — code only.
  - Inside the z-50 surface, children set z-50, z-60 and z-70, and the nav arrows use `z-40`.
  - The "more" dropdown is a hand-rolled menu (`rounded-lg … shadow-2xl`, `text-sm`) with a solid accent hover (`pointer-fine:hover:bg-primary`), and its danger row is solid `hover:bg-destructive`.
  - The top toolbar has no `--safe-area-top` padding and the thumbnails have no `--safe-area-bottom`.
  - Spinners are hand-rolled (`border-4 border-primary/30 animate-spin`).
  - 5 dead blurs.

  Fix: children at `z-10`/`z-20`; `DropdownMenu` with `MENU_PANEL`/`MENU_ITEM_*`; safe-area padding; `Spinner`.

- **PK-21 [P2] Floating surfaces** — `chat/FloatingListenTogetherPlayer.tsx:134`, `chat/FloatingSoundboardManager.tsx:176,196,204,231` — rule 11.1, 3.7, 6.1 — code only. Both use `z-40`; the ladder puts floating players at 30. FloatingSoundboardManager sets `touch-none` on the `<aside>` that wraps its `overflow-y-auto` playback list, so the list can't scroll by touch. It also uses `shadow-[0_18px_44px…]` and dead `backdrop-blur-xl`. — Fix: `z-30`; put `touch-none` only on the drag handle; `shadow-sm` (`--rm-shadow-1`).
- **PK-22 [P2] MentionAutocomplete** — `chat/MentionAutocomplete.tsx:24,41-46` — rule 11.2, 12.7, 9.1 — code only. `z-50` inside the composer. Rows are `px-3 py-2` + a 24px avatar, about 40px, with no `pointer-coarse:min-h-11`. The highlight is `bg-rm-accent/10` with `text-rm-accent`, not the tonal `MENU_ITEM_DEFAULT_ON`. — Fix: portalled popover with `MENU_PANEL` + `MENU_ITEM`.
- **PK-23 [P2] ListenTogetherPanel + NowPlayingCard** — `chat/ListenTogetherPanel.tsx:368,838,1285` (`window.innerWidth < 1024`), `:1329` (segmented pill), `:899,1022,1305` (`rounded-2xl`/`rounded-3xl` cards, `shadow-[0_12px_30px…]`), `:1149,1403,1465` (empty states in dashed cards); `chat/ListenTogetherNowPlayingCard.tsx:304,452,541,616` (shadows), `:360,380` (`min-w-[34px]`) — rule 3.2, 3.1, 13.5, 5.1, 1.2, 14.1 — code only. Also 27 + 10 Tailwind text sizes and 16 + 7 `sm:`. — Fix: `useIsMobile()`; `Tabs`/`RadioList`; `rounded-lg` cards with no shadow; empty-state anatomy from 14.1.
- **PK-24 [P2] GIF picker tabs** — `chat/GifPickerModal.tsx:1415-1460,1505-1510` — rule 13.5, 1.1, 4.1 — code only. The media-type switch (GIFs/Clips/Stickers/Memes) is pill buttons (`rounded-xl px-3.5 py-2`, `text-sm font-bold`). Voice-mode chips select with solid `bg-primary text-white shadow-primary/40`, which adds a second solid fill to the view. — Fix: `Tabs` for media type; tint selected state (`bg-rm-tint-2`) for chips.
- **PK-25 [P2] PinnedMessagesSidebar anatomy** — `chat/PinnedMessagesSidebar.tsx:56,60,90,153,185` — rule 12.10, 12.5, 14.1, 4.1 — code only. Header is `min-h-16 px-6` (12.10: `h-12 px-4`) with a `text-lg font-bold` title. Cards are `p-5 rounded-2xl` with a hover background (12.5: `p-4 rounded-lg`). The empty state is an icon inside a rotated `rounded-3xl … shadow-xl` card. Body text is `text-[14px]`. — Fix: shared side-panel header; 12.5 card; 14.1 empty state.
- **PK-26 [P2] ThreadSidebar anatomy** — `chat/ThreadSidebar.tsx:169,179-180,216,328` — rule 12.10, 3.3, 4.1, 13.2 — code only. The panel is `w-[380px]` (spec 360). Title is `text-sm font-bold` (spec `text-ui-md font-semibold`). Root message card is `rounded-xl`. Send is a hand-rolled `bg-primary px-3 py-1 text-xs` instead of `Button size="sm"`. — Fix as described.
- **PK-27 [P2] Activity stages palette** — `chat/WordleActivityStage.tsx:1173,1181,1193` (hex `#d9d9d9 #6aaa64 #d3d6da`), `:1129` (`bg-black text-white` Play button); `chat/WarpRushActivityStage.tsx` (56 palette lines: slate 37, cyan 19, fuchsia 8, amber 8, emerald 5; raw colours 1123,1126) — rule 7.3, 7.1 — code only. 7.3 asks for `--rm-activity-*` tokens per theme. Wordle also has 53 Tailwind text sizes, WarpRush 25. — Fix: add `--rm-activity-wordle-{correct,present,absent}` and `--rm-activity-warp-*` tokens; use `Button` for Play.
- **PK-28 [P2] DragDropOverlay** — `chat/DragDropOverlay.tsx:6-17` — rule 11.1, 10.3, 4.1, 5.1 — code only. `z-50` (the ladder lists the drag overlay at 30). `animate-in … zoom-in` with no value starts from scale 0, and 10.3 forbids entering from scale 0. Card is `rounded-3xl p-12` with `text-xl`, `text-sm` and a dead blur. — Fix: `z-30`, `zoom-in-[0.97]`, `rounded-xl`, `text-ui-lg`/`text-ui-sm`.
- **PK-29 [P2] Type scale** — area-wide — rule 4.1 — code only. 261 Tailwind `text-*` and 59 `text-[Npx]`. Worst files: WordleActivityStage 53, ShopView 28+6, ListenTogetherPanel 27, WarpRush 25, SoundboardPicker 19+2, EmojiPicker 18+3, GifPickerModal 15, LinkEmbed 9+42, ImageViewerToolbar 10, ListenTogetherNowPlayingCard 10. — Fix: map `text-xs` to `text-ui-xs`, `text-sm` to `text-ui-sm`, `text-base` to `text-ui-base`/`md`, `text-lg` to `text-ui-lg`, `text-xl` to `text-ui-xl`.
- **PK-30 [P3] Enter scale** — `chat/EmojiPicker.tsx:785`, `chat/GifPickerModal.tsx:1405`, `chat/SoundboardPicker.tsx:1388,2761`, `chat/MessageShareModal.tsx:101`, `chat/ReactionDetailsModal.tsx:213`, `chat/UploadSoundModal.tsx:248`, `chat/PinnedMessagesSidebar.tsx:54`, `chat/HoveredMentionTooltip.tsx:18`, `chat/PinModal.tsx:203` (`scale-95 translate-y-4`) — rule 10.3 — code only. These use `zoom-in-95`; the dialog primitive uses `zoom-in-[0.97]`. — Fix: 0.97.
- **PK-31 [P3] Long durations** — `chat/VideoPlayerControls.tsx:366` (`animate-[splash_0.5s…]`), `src/styles.css:1305` (`rm-loading-exit 1.2s`) — rule 10.1 — overlay-\* screenshots. The connection-overlay exit holds on purpose (documented) but still goes past the 300ms cap. — Fix: VideoPlayerControls to ≤240ms; allowlist `rm-loading-exit` with a reason.
- **PK-32 [P3] HoveredMentionTooltip** — `chat/HoveredMentionTooltip.tsx:17-49` — rule 13.7, 8.1 — code only. A hand-rolled `fixed z-80` tooltip, not inverted (`bg-rm-bg-elevated border shadow-xl`), with an inline SVG caret and `text-xs`. — Fix: `Tooltip` primitive.
- **PK-33 [P3] SensitiveMediaFrame** — `chat/SensitiveMediaFrame.tsx:64,72-73` — rule 4.7, 9.1 — code only. The eyebrow is `text-sm` with `tracking-[0.18em]`, and the "Show" button is uppercase with `tracking-[0.16em]` (no uppercase buttons) at about 32px with no HIT. — Fix: eyebrow `text-ui-2xs tracking-[0.08em]`; sentence-case button with `HIT`.
- **PK-34 [P3] ExternalLinkConfirmModal** — `ui/ExternalLinkConfirmModal.tsx:40,45,50,52-60` — rule 12.8, 4.1, 9.1 — code only. This is the one compliant ResponsiveDialog in the area. Remaining issues: `max-w-[510px]` (confirm is 384); description and URL box use `text-sm`; the checkbox row is about 20px tall on coarse pointers. — Fix: `md:max-w-sm`, `text-ui-sm`, `min-h-11` on the label.
- **PK-35 [P3] ConnectionOverlay / SplashScreen** — `chat/ConnectionOverlay.tsx:138`, `SplashScreen.tsx:47-50` — rule 3.6, 14.4 — overlay-390-light, overlay-768-dark, splash-390-dark. Layout, scale and colour are correct (score 3-4). The `fixed inset-0 z-100` overlay doesn't pad for safe areas; content is centred, so this is minor. In SplashScreen the inner `setTimeout(…, 400)` is never cleared on unmount. — Fix: pad with the safe-area vars; track and clear the timeout.
- **PK-36 [P3] AudioCompatibilityHint** — `chat/AudioCompatibilityHint.tsx:14-21` — rule 13.1, 13.7, 9.1 — code only. The information lives only in a tooltip on a 12px focusable `<span>`, so it can't be read on touch. — Fix: a `Popover` on tap, or inline helper text, with `HIT`.
- **PK-37 [P3] Small fixes** — `chat/MarkdownRenderer.tsx:159` (code block `text-xs` → `text-ui-xs`); `chat/GifFavoriteButton.tsx:52` (`z-30` inside a tile → `z-10`); `chat/ActiveSoundboardEffectList.tsx:181` (`text-xs`) — rule 4.1, 11.1 — code only.
- **PK-38 [P3] SearchPanel / ShopView (superseded by ui/search, ui/shop — re-check after merge)** — `chat/SearchPanel.tsx:240` (`60vh`), `:845` (`text-[px]`), `:886` (`rounded-[5px]`); `chat/ShopView.tsx` (168 checker hits: 71 `sm:`, 21 shadows, 9 raw colours, `bg-black/72` scrim at 1015, `rounded-3xl` dialog at 1024, `max-h-[92vh]`) — rule 3.4, 5.1, 6.1, 6.5 — code only.

#### Shared causes

1. **Overlays are hand-rolled instead of using the primitives (13.1).** Seven files put their own scrim inside `DialogPortal` (PK-10). Five more are pure `fixed inset-0`/`createPortal` overlays (PK-02, PK-03, PK-04, PK-05, PK-09). Pin, Reaction and Upload branch on `isMobile` so `ResponsiveDialogContent` only runs on phones. Each one brings its own scrim colour (`bg-black/50`, `/55`, `/60`, `/70`, `/72`, `bg-rm-bg-primary/50`) and none uses `bg-rm-scrim`. Fix it once: `ResponsiveDialog` for confirm/form, `Dialog` workbench for viewer/shop, `ActionSheet` for phone actions, `Sheet`/`Drawer` for side panels.
2. **PickerSurface fixed phone behaviour but not desktop.** The phone drawer is correct (85dvh, back button, safe area). On desktop each picker still passes its own `rounded-3xl` surface, shadows, vh heights, an outside-click scrim and arbitrary z-indexes through `className`/`desktopWrap`/`drawerClassName` (PK-06, PK-12, PK-13). If PickerSurface owned the desktop recipe and the z layer, all three pickers would be fixed together.
3. **Hover-revealed tile actions with no touch path (PK-01).** GIF, soundboard, pins, attachments and embeds all use `opacity-0 group-hover:opacity-100`. One shared tile-actions pattern (always visible on `pointer-coarse`, plus a long-press ActionSheet) would fix about 25 sites.
4. **Pre-Quiet-Pro styling in large files.** LinkEmbed, SoundboardPicker, GifPickerModal, WarpRush, Wordle, ListenTogether and ShopView account for most of the area's 261+59 off-scale text sizes, 81 bare hovers, 73 dead blurs, 58 hand-rolled shadows and 141 palette-hue lines. Codemods that also apply here: `text-*` → `text-ui-*`, delete `backdrop-blur-*`, `shadow-[…]` → `shadow-sm/lg/2xl`, `hover:` → `pointer-fine:hover:`.
5. **Missing or dead tokens.** `text-rm-text-primary` is used 33 times with no `@theme` mapping (PK-18). There are no favourite or activity tokens, so amber/yellow and Wordle/WarpRush hexes fill the gap (PK-16, PK-27). The `.picker-header` CSS hard-codes a red.
6. **Hand-rolled controls skip HIT/PRESS.** Every sub-44 target in PK-15 is a raw `<button>` with `p-1.5`/`p-2`. The `Button`/`IconButton` primitives already carry both.

#### Needs fixture

- **Pickers:** emoji, GIF (compact + expanded + favourites + voice mode), soundboard (grid, listen-together, upload/edit, delete confirm, selection mode). Each at 390/768/1280 × light/dark, phone drawer and desktop popover.
- **Message dialogs:** MessageShareModal (before/after link), PinModal (pin/unpin), ReactionDetailsModal, UploadSoundModal, ExternalLinkConfirmModal, LinkEmbed RemoveEmbeds confirm.
- **Image viewer:** single, multi with thumbnails, clean mode, details popover, video item.
- **Attachments and media:** ImageGrid (1–4+ images), AttachmentList (pending + spoiler), VideoAttachment (inline + fullscreen), SensitiveMediaFrame.
- **LinkEmbed variants:** generic/BaseEmbed, YouTube, TikTok, X (text, media grid, quoted), Instagram, Spotify, unavailable.
- **Side panels:** ThreadSidebar (desktop docked + phone), PinnedMessagesSidebar (empty, loading, list; desktop + phone).
- **Listen-together and soundboard:** ListenTogetherPanel (search results, queue, empty), ListenTogetherResultActions (phone), FloatingListenTogetherPlayer, FloatingSoundboardManager (collapsed/expanded), ActiveSoundboardEffectList.
- **Activities:** WordleActivityStage (board, how-to-play, hints), WarpRushActivityStage.
- **Composer and message-list overlays:** DragDropOverlay, MentionAutocomplete, HoveredMentionTooltip, NewMessageSeparator, MarkdownRenderer code block, AudioCompatibilityHint.
- **Fixture fixes needed:**
  - `overlay-1280-{dark,light}` and `splash-1280-light` are blank 15 KB light-grey frames; the dark-theme overlay at 1280 is light. Likely a capture or DitherField timing problem; re-shoot before judging 1280.
  - `OverlayFixture` (`src/components/dev/UiFixtures.tsx:863-871`) sets `reconnectAttempt: 2`, but the component's internal `hasConnected` stays false. Every overlay shot therefore shows "Connecting..." and never the reconnect copy, the 3s grace or the fade-in. Add a prop or store flag so the fixture reaches the reconnect state.
  - `action-sheet-390-{dark,light}` and `action-sheet-768-dark` are blank (7-13 KB), so there is no ActionSheet reference to compare PK-03 against.

---

### Auth and public pages (AU)

Paths below are relative to `F:\dev\TS\CLOUDFLARE\ralph-meet-quietpro\src\`. Rule numbers refer to `docs/design-system.md`. Screenshots are in `C:\Users\jon\AppData\Local\Temp\ds-audit\`. The dev-tools widget is ignored.

**Theme note:** every "-light" screenshot renders in dark (sign-in, sign-up, activate, invite, home 1280). The pages do not follow `prefers-color-scheme` (see AU-05). In practice the dark/light pairs are two dark captures, so light, miku and spiderman were checked from code only.

#### Inventory

| View                                                             | How to reach                                      | Fixture                              | Screens checked                                                                     | Score 0-4 | Top issues (max 3)                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home (marketing)                                                 | `/` signed out, web                               | none                                 | home-390-dark, home-390-light (capture error), home-768-light, home-1280-dark/light | 2         | Hero is blank at 390 before hydration (AU-06); 21 `sm:` and 19 Tailwind text sizes, bare hovers (AU-12, AU-19); `text-white` and hex `#5865f2` (AU-15)                                                                                              |
| Sign in                                                          | `/sign-in`                                        | none                                 | sign-in-390-dark (splash/blank), 390-light, 768-dark, 1280-dark/light               | 3         | Ignores system theme (AU-05); Kova vars only partly mapped: error colour, 15px inputs, `#fff` CTA (AU-03, AU-04); links 15-18px tall (AU-11)                                                                                                        |
| Sign up                                                          | `/sign-up`                                        | none                                 | sign-up-390-dark, 1280-light                                                        | 3         | Same as sign-in; "Sign in" link 43x17 (AU-11)                                                                                                                                                                                                       |
| Activate, signed out                                             | `/activate?code=ABCD-EFGH` (redirects to sign-in) | none                                 | activate-390-dark/light, 768-dark, 1280-dark/light                                  | 2         | Sign-in shows "Welcome back" with no hint that you are approving a device (AU-07); same Kova issues                                                                                                                                                 |
| Activate states (enter / loading / review / approved / outcomes) | `/activate` signed in                             | **needs fixture**                    | code only                                                                           | 2         | Own Button/input bypass the system: 9 `text-[px]`, 5 `rounded-[10px]`, 10 off-grid lengths (AU-09, AU-13, AU-14); white spinner on the secondary button disappears in light themes (AU-08); errors use the presence token `--rm-status-dnd` (AU-10) |
| DesktopLogin (Tauri)                                             | `/`, `/sign-in`, `/sign-up` in Tauri              | **needs fixture**                    | code only                                                                           | 2         | lucide x7 (AU-16); display serif 30px titles disagree with web `/activate` (AU-09); Cancel ~30px tall, 40px buttons with no HIT (AU-11)                                                                                                             |
| Invite (signed out)                                              | `/invite/nope-nope`                               | signed out                           | invite-invalid-390-dark/light, 768 (diag), 1280-dark                                | 1         | Signed-out visitors see "Invite Invalid / Authentication required" and a "Go to Chat" button (AU-02); glass card with `shadow-2xl` + blur + `ring-white` (AU-17, AU-15); Tailwind sizes (AU-12)                                                     |
| Invite (preview / joining / success / real invalid)              | signed in                                         | **needs fixture**                    | code only                                                                           | 1         | emerald palette for success (AU-15); "No thanks" text-xs with no target (AU-11); `active:scale-[0.98]` (AU-19)                                                                                                                                      |
| Share gone                                                       | `/share/nope-nope`                                | local D1 (no `message_shares` table) | share-gone-390-dark, 768-dark, 1280-light                                           | 0         | The loader rethrows and there is no `errorComponent`, so a raw "Something went wrong!" page shows the D1 SQL error (AU-01)                                                                                                                          |
| Share loaded (user WIP)                                          | `/share/<token>`                                  | **needs fixture**                    | code only                                                                           | 2         | Non-410 failures render as "This share is gone" (AU-18); lucide `Radio` stands in for the logo (AU-16); `min-h-screen`, `sm:`, amber palette (AU-20, AU-15)                                                                                         |
| Room pre-join (guest name)                                       | `/room/<slug>`                                    | **needs fixture**                    | code only                                                                           | 1         | Hover lifts the button (`hover:-translate-y-0.5`) (AU-19); glow shadows (AU-17); `text-2xl/sm/xs` (AU-12)                                                                                                                                           |
| Splash                                                           | sign-in while auth loads                          | none                                 | sign-in-390-dark (blank frame)                                                      | 3         | Blank frame captured; probably timing (needs fixture)                                                                                                                                                                                               |

#### Findings

- **AU-01 [P1] Share gone** — `routes/share.$token.tsx:32-39`, `routes/__root.tsx:59-70` — rule 14.3 — screenshot `share-gone-390-dark.png`, `share-gone-1280-light.png` — `loadPublicShare` only maps 404/410 to `gone`. Any other error is rethrown, and no route (root included) defines `errorComponent`. TanStack's unstyled default boundary renders a white Times-New-Roman page with "Hide Error" (55x16) and the raw `D1_ERROR: no such table: message_shares`. In production this leaks internals and breaks theme. The missing table is a fixture gap; the missing boundary is real. — Fix: add a themed `errorComponent` on `__root` (empty-state anatomy 14.1/14.3: danger-ink title, retry `Button`, link home) and on `/share/$token`. Never render `error.message` to users.

- **AU-02 [P1] Invite, signed out** — `components/chat/InviteClient.tsx:36-40, 201-217` — rule 14.3 — screenshot `invite-invalid-390-dark.png`, `invite-invalid-1280-dark.png` — The preview fetch needs auth. A signed-out visitor with a valid link sees "Invite Invalid" over the raw `err.message` ("Authentication required"). The only action, "Go to Chat" (118x40, below 44), sends them away without returning to the invite. Every unauthenticated share of an invite looks dead. — Fix: on 401, render a "Sign in to join" state with a primary `Button` linking to `/sign-in?redirect_url=/invite/<code>`. Keep "Invite invalid" (sentence case) for 404/410 only. Map server errors to written copy.

- **AU-03 [P1] Sign-in / sign-up / activate / Kova CTA and app primary buttons** — `node_modules/@kova/react/dist/index.js:391` (SDK `color:#fff`), `styles.css:1784-1799`, `components/auth/DeviceActivation.tsx:185`, `components/auth/device-login-styles.ts:24`, `components/DesktopLogin.tsx:658`, `components/chat/InviteClient.tsx:152`, `components/HomePageClient.tsx:123, 218, 422, 492` — rules 7.1, 7.4 — code only (miku not captured) — Primary fills use `--rm-accent` with hard-coded white text. Against miku-dark's `#39c5bb` white is **2.1:1**; against miku-light's `#00a399` it is **3.1:1**. Both fail 4.5:1 for 13-15px text. miku-dark already defines `--rm-on-accent: #0c0b14` (`styles.css:640`), but none of these buttons read it. — Fix: use `text-rm-on-accent` / `bg-primary text-primary-foreground` (or the `Button` default variant). Add `.auth-split [data-ra-element="formSubmitButton"]{color:var(--rm-on-accent)}`. Make miku-light's `--rm-on-accent` (`styles.css:543`) dark too.

- **AU-04 [P2] Kova card theming (sign-in, sign-up)** — `styles.css:1784-1799` — rules 7.1, 7.4, 4.6, 5.1 — screenshot `sign-in-390-light.png`, `sign-in-1280-dark.png` — The `--ra-*` bridge is incomplete. The SDK defaults (`index.js:730-746`) leak through:
  - `--ra-color-error` stays `#ff6b6b`, about 2.5:1 on the light `#f2f3f5`. `--ra-color-success` (`#4ade80`) and `--ra-color-warning` (`#ffb020`) stay dark-tuned for every theme.
  - `--ra-font-size` stays 15px, so inputs are 15px and iOS zooms (4.6).
  - `--ra-color-background` (line 1787) is not an SDK variable; the SDK reads `--ra-color-bg`, so this line does nothing.
  - `--ra-color-border-strong` maps to `--rm-text-ghost`, a decoration-only token (4.3).
  - Inputs draw their edge with `--ra-color-border` (6-8% hairline), not `--rm-field-edge`, so they miss 3:1 (7.4).
  - `--ra-radius`/`--ra-radius-sm` are 10px, off the scale (5.1).

  Every mapped colour token exists in all six themes, so light/miku/spiderman are otherwise complete. — Fix: add `--ra-color-error: var(--rm-danger-ink)`, `--ra-color-success: var(--rm-success-ink)`, `--ra-color-warning: var(--rm-warning-ink)`, `--ra-font-size: 16px` (below md), `--ra-color-border-strong: var(--rm-border-strong)` and `--ra-radius(-sm): 8px`. Override `[data-ra-element="formFieldInput"]{border-color:var(--rm-field-edge)}`. Remove `--ra-color-background`.

- **AU-05 [P2] All public pages, theme** — `components/theme-provider.tsx:9-10` (cause; outside area) — rule 7.5 — screenshot `sign-in-390-light.png`, `sign-in-1280-light.png`, `invite-invalid-390-light.png`, `home-1280-light.png` — `defaultTheme: "dark"` with `enableSystem` means a first-time, signed-out visitor never gets light, whatever the OS says. — Fix: default to `"system"` when there is no stored preference (at least for unauthenticated routes). Re-shoot light/miku/spiderman after.

- **AU-06 [P2] Home hero at 390** — `components/HomePageClient.tsx:190-212, 243-247` — rules 10.5, 14.2 — screenshot `home-390-dark.png` — The SSR markup ships the hero with Framer's `initial={{opacity:0,y:16}}` inline, so before hydration (or with slow JS) the hero is blank under the header. The capture shows only "Ralph Meet / Sign In". The logo tile is also empty until `HomeIcon` mounts (`chat/HomeIcon.tsx:24-27`). — Fix: animate from a CSS class gated on `.js`/hydrated, or use `initial={false}` on the server. Render the logo immediately.

- **AU-07 [P2] Activate, signed out** — `components/auth/DeviceActivation.tsx:341-354`, `routes/sign-in.tsx:145-153`, `components/auth/AuthSplitLayout.tsx:13` — rule 14 — screenshot `activate-390-light.png`, `activate-1280-light.png` — `/activate?code=…` bounces to a generic "Sign in / Welcome back. Choose your sign-in method." Nothing says a device is waiting, and the code is not shown. The `caption` prop of `AuthSplitLayout` is never used. — Fix: when `redirect_url` starts with `/activate`, pass a subtitle such as "Sign in to connect your device (ABCD-EFGH)" and a matching caption.

- **AU-08 [P2] Activate review, Deny busy** — `components/auth/DeviceActivation.tsx:205-209, 691-698` — rules 7.1, 14.2 — code only — The busy spinner is always `border-white/35 border-t-white`. On the secondary Deny button (`bg-[var(--rm-bg-hover)]`) it is invisible in light, miku-light and spiderman-light, and the label is hidden, so the button looks empty. — Fix: use the shared `Spinner` with `border-current` (inherits button ink), or `Button loading`.

- **AU-09 [P2] Auth card anatomy (sign-in, sign-up, activate, DesktopLogin)** — `components/auth/auth-card-appearance.ts:11-27`, `components/auth/AuthSplitLayout.tsx:28`, `components/auth/DeviceActivation.tsx:226`, `components/DesktopLogin.tsx:436-437` — rules 12.15, 4.1, 4.4 — screenshot `sign-in-1280-dark.png` — Rule 12.15 asks for `rounded-xl border p-6 max-w-[420px]`. The code flattens the card (no border, transparent, no padding) into a 380px column. Titles are 24px (`fontSize: 24`, `text-2xl`), which is off the scale (22/28). Paired flows also use different faces: web `/activate` headings are Figtree 24px, while the Tauri DesktopLogin titles use Instrument Serif 30px (`[font-family:var(--font-display)]`). 12.15 keeps the display face in the art panel only, so the two halves of one sign-in read as different products. — Fix: pick one and update the doc or the code. If the flat column is the decision, amend 12.15 to "flat column, max-w-[380px], no card". Set titles to `text-ui-xl` (22) or `text-ui-2xl` (28) everywhere. Move DesktopLogin titles to `font-ui`.

- **AU-10 [P2] Activate errors** — `components/auth/DeviceActivation.tsx:555, 560, 709-714` — rules 7.3, 14.3, 13.4 — code only — Field and inline errors are coloured with `--rm-status-dnd`, a presence token, as plain `text-sm` lines. There is no `RowError` strip, no icon, and the field border is `--rm-status-dnd/70`. — Fix: `text-rm-danger-ink` + `aria-invalid:border-rm-danger-ink`. Use the 14.3 strip (`rounded-md bg-rm-danger-tint px-3 py-2 text-ui-sm` + `Icon sm`) for the inline decide error.

- **AU-11 [P2] Touch targets (multiple views)** — rule 9.1 — `diag-summary.txt`. Each item below misses 44px:
  - Kova sign-in: "Forgot password?" 106x15, "Sign up" 48x17, "Secured by Kova" 108x18, Password/Magic Link tabs 43 tall. Sign-up "Sign in" 43x17. All are SDK elements, fixable from `styles.css:1784+`.
  - `components/chat/InviteClient.tsx:213`: "Go to Chat" 118x40.
  - `components/chat/InviteClient.tsx:158-163`: "No thanks", `text-xs` with no padding.
  - `components/HomePageClient.tsx:123`: "Sign In" 75x32.
  - `components/HomePageClient.tsx:108-110`: brand link 126x32.
  - `components/auth/device-login-styles.ts:28`: `quietButton` Cancel, about 30px.
  - `components/auth/device-login-styles.ts:26`: `secondaryButton` h-10.
  - `components/auth/device-login-styles.ts:30`: `iconButton` h-9 (copy code), none with `HIT`, on Tauri mobile.

  — Fix: add `HIT` (or `min-h-11` + padding) to each. For Kova, add `.auth-split [data-ra-element="tab"], … a { min-height:44px; display:inline-flex; align-items:center }`.

- **AU-12 [P3] Type scale (repeated)** — rule 4.1 — Tailwind `text-*`/`text-[Npx]` instead of `text-ui-*`:
  - `components/auth/DeviceActivation.tsx`: 183, 226, 235, 555, 560, 612, 619, 626, 630, 643, 657, 676, 685, 711, 715, 776
  - `components/auth/DeviceCodeDisplay.tsx`: 19 (`text-[28px]`, use `text-ui-2xl`)
  - `components/auth/device-login-styles.ts`: 24, 26, 28
  - `components/DesktopLogin.tsx`: 437, 439, 531, 545
  - `components/auth/AuthArtPanel.tsx`: 216
  - `components/auth/auth-card-appearance.ts`: 20
  - `components/chat/InviteClient.tsx`: 91, 106, 120, 126, 129, 140, 152, 160, 177, 191, 194, 208, 209, 213
  - `components/chat/SharedMessagePage.tsx`: 92, 93, 100, 105, 106, 129
  - `components/chat/ShareSnapshotPreview.tsx`: 98, 104, 117, 121, 133, 147, 230, 249, 263
  - `components/HomePageClient.tsx`: 115, 123, 194, 203, 218, 226, 234, 282, 294, 297, 321, 324, 347, 351, 386, 394, 417, 441, 445 (marketing; use `text-display`/`text-display-lg` for the serif steps)
  - `components/RoomPageClient.tsx`: 105, 108, 115, 123, 144, 606
  - `routes/__root.tsx`: 65

  — Fix: map 13 and 14 → `text-ui-sm`, 15 → `text-ui-base`, 12 → `text-ui-xs`, 24/30 → `text-ui-2xl`.

- **AU-13 [P3] Spacing off grid (repeated)** — rule 2.1 — The 18px stack lengths should be `mt-4`/`mb-4` (16) or `mt-6` (24); 14px should be `3`/`4`; 28 and 20 should be steps.
  - `components/auth/DeviceActivation.tsx`: `mb-[18px]` 244; `mt-[18px]` 528, 581, 612, 690, 752, 757, 768; `h-[18px] w-[18px]` 208; banned step `mt-3.5` 619, 654, 715; `-mr-1` 685 (2.5)
  - `components/auth/auth-card-appearance.ts`: 19 (`margin 0 0 18px`), 22, 24 (`18px`)
  - `styles.css`: 1806, 1823, 1827 (14px)
  - `components/auth/AuthArtPanel.tsx`: 216 (`bottom-[18px]`, `left 28/20px`)
  - `components/auth/AuthSplitLayout.tsx`: 24 (`px 20px`, `pb 28px`)
  - `components/DesktopLogin.tsx`: `mt-7` 527, 550

- **AU-14 [P3] Radius off scale (repeated)** — rules 5.1, 13.2 — Buttons and inputs should be `rounded-md`, cards `rounded-lg`.
  - `rounded-[10px]`: `components/auth/DeviceActivation.tsx` 183, 555, 581, 612, 654
  - `--ra-radius: 10px`: `styles.css` 1796-1797
  - `borderRadius: 11`: `components/auth/auth-card-appearance.ts` 19
  - `rounded-xl` buttons (24 for a 44px control): `components/auth/device-login-styles.ts` 24
  - `rounded-2xl` on non-drawer surfaces: `components/auth/DeviceCodeDisplay.tsx` 13; `components/DesktopLogin.tsx` 609; `components/chat/InviteClient.tsx` 85, 97, 112, 169, 186, 203
  - `rounded-xl` controls: `components/chat/InviteClient.tsx` 152, 213; `components/RoomPageClient.tsx` 102, 117, 136, 144

- **AU-15 [P2] Colour outside tokens (repeated)** — rule 7.1 — Each item below uses a raw colour where a token exists:
  - `components/HomePageClient.tsx:132`: `appearance={{variables:{colorPrimary:"#5865f2"}}}`. Hex; ignores theme; per the comment at `auth-card-appearance.ts:3-5` the SDK ignores instance variables anyway, so delete it.
  - `components/chat/InviteClient.tsx` 85, 97, 111, 112, 213: `ring-white/[0.06]`, invisible on light themes.
  - `components/chat/InviteClient.tsx` 120: `text-white/80`.
  - `components/chat/InviteClient.tsx` 187-188: emerald palette. Use `bg-rm-success-tint`/`text-rm-success-ink`, or the accent check like `/activate`.
  - `components/chat/InviteClient.tsx` 204-205: `bg-destructive`/`text-destructive`, shadcn aliases, not `rm-danger-*`.
  - `components/chat/ShareSnapshotPreview.tsx:98`: amber palette for the "edited" banner. Use `text-rm-warning-ink` + tint.
  - `components/RoomPageClient.tsx` 388, 419, 430: emerald.
  - `components/RoomPageClient.tsx` 115: `text-warning`/`bg-warning`, non-`rm` tokens.
  - `components/auth/DeviceActivation.tsx` and `components/auth/AuthSplitLayout.tsx:21`: written as `bg-[var(--rm-…)]` arbitrary values instead of the `bg-rm-*` utilities. Also `selection:bg-[var(--rm-accent)]/40` where `--rm-selection` exists.
  - `components/auth/AuthArtPanel.tsx:31, 218`: hex fallback and `#ffffff` caption. Acceptable as a media overlay (6.5) but should be allowlisted.
  - `text-white` on accent: see AU-03.

- **AU-16 [P2] Icon library** — rule 8.1 — Every item below should use `<Icon>`:
  - `components/auth/CopyMorphIcon.tsx:2`: `Check`, plus the `LucideIcon` prop type.
  - `components/auth/DeviceCodeDisplay.tsx:1`: `Copy`.
  - `components/DesktopLogin.tsx:37-46`: Check, CircleAlert, ExternalLink, Link2, ShieldX, TimerOff, WifiOff (sizes `h-4`/`h-6` ad hoc).
  - `components/chat/SharedMessagePage.tsx:4, 89`: `Radio`, used as the brand mark (user WIP). Use `ThemeAwareSplashLogo` for the brand.
  - `components/auth/DeviceActivation.tsx:250-281`: inline SVG check. An illustration exception is arguable, but `Icon name="check" state="active" size="3xl"` matches the rest.

  — Fix: change `CopyMorphIcon` to take an `IconName`, and add any missing names (`timer-off`, `shield-x`, `external-link`) to `mapping.ts`.

- **AU-17 [P3] Shadow and blur on non-floating surfaces** — rules 1.2, 6.1, 6.3 —
  - `components/chat/InviteClient.tsx`: `shadow-2xl` + `backdrop-blur-xl` on the page card at 85, 97, 169, 186, 203 (visible glow in `invite-invalid-1280-dark.png`); `shadow-lg shadow-rm-accent/20` at 152
  - `components/chat/ShareSnapshotPreview.tsx:93`: `shadow-xl shadow-black/20` on a card
  - `components/HomePageClient.tsx`: 103 (blur), 218, 249 (`shadow-[…]`)
  - `components/auth/DeviceActivation.tsx`: 185 (inset + drop shadow on a button), 555 (focus `shadow-[0_0_0_3px…]` in place of the global ring, 9.4)
  - `components/RoomPageClient.tsx`: 102, 144, 622, 683

  — Fix: InviteClient should become a 12.5 card (`rounded-lg border border-rm-border bg-rm-bg-surface p-4`) or 14.1 empty state with no shadow.

- **AU-18 [P2] Share loaded / gone states (user WIP, flag only)** — `components/chat/SharedMessagePage.tsx:73-75, 99-109` — rules 14.1-14.3 — code only — Fetch errors other than 410 (500, network) fall through to `gone || !share` and show "This share is gone", which is wrong and offers no retry. The gone state has no action (14.1 asks for one, e.g. "Open Ralph Meet"). Loading is a text card, not a `Spinner`/skeleton (14.2). The gone title is `text-xl font-bold` inside a bordered card, where 14.1 says never wrap an empty state in a card. Hand to the author; do not edit while WIP.

- **AU-19 [P3] Hover gating, press and motion (repeated)** — rules 9.2, 9.3, 10.1, 10.2, 10.5 —
  - Bare `hover:`: `components/HomePageClient.tsx` 123, 218, 226, 234, 422, 450, 458; `components/RoomPageClient.tsx` 144, 208, 227, 248, 272, 288, 298, 310, 323, 387, 654, 695; `components/chat/SharedMessagePage.tsx` 143; `components/chat/ShareSnapshotPreview.tsx` 187; `components/auth/DeviceActivation.tsx` 752.
  - Hover moves the button: `components/RoomPageClient.tsx:144` (`hover:-translate-y-0.5 hover:shadow-xl`).
  - Press below 0.97 or hand-rolled: `active:scale-[0.98]` in `components/HomePageClient.tsx` 123, 218, 226, 234 and `components/chat/InviteClient.tsx` 152; `active:scale-[0.96]` in `components/RoomPageClient.tsx` 288, 654.
  - Hover gated with raw media queries instead of `pointer-fine:`: `components/auth/DeviceActivation.tsx` 183, 184, 685 and `components/auth/device-login-styles.ts` 24-30. They behave correctly, but the checker counts them as bare-hover (false positive).
  - Motion over cap: `styles.css:1723` (art fade 700ms `ease`); `components/HomePageClient.tsx:22-25` (550ms), 101 (`duration-300` + `backdrop-filter` transition); `components/auth/device-login-styles.ts:17` (`duration-[160ms]`, off-token).
  - Filter animation: `components/auth/CopyMorphIcon.tsx:26-37` animates `filter: blur()` (10.2, 6.3). Use opacity + scale only.

- **AU-20 [P3] Viewport units, safe areas, breakpoints** — rules 3.4, 3.6, 3.1 —
  - `min-h-screen`: `components/chat/SharedMessagePage.tsx` 85, 86; `routes/__root.tsx` 63 (404).
  - `min-h-svh`: `components/auth/AuthSplitLayout.tsx` 21 (use `min-h-dvh`).
  - `max-h-[28vh]/[36vh]`: `components/HomePageClient.tsx` 249.
  - `env(safe-area-inset-*)` instead of `var(--safe-area-*,0px)`: `components/auth/AuthSplitLayout.tsx` 24; `components/auth/AuthArtPanel.tsx` 202, 216.
  - Fixed header with no top safe area: `components/HomePageClient.tsx:101`, also `z-50` for in-page chrome (should be `z-20`, 11.1) and `z-[60]` skip link at 492.
  - `z-[2]/z-[3]`: `components/auth/AuthArtPanel.tsx` 207, 216.
  - Breakpoints: `2xl:` at `components/auth/AuthSplitLayout.tsx:21`; `sm:` at `components/auth/DeviceActivation.tsx` 621, 637, `components/chat/SharedMessagePage.tsx` 86, `components/chat/ShareSnapshotPreview.tsx` 162, `components/RoomPageClient.tsx` 685, 692, and 21 sites in `components/HomePageClient.tsx` (107, 188, 194, 203, 213, 249, 275, 282, 294, 321, 345, 351, 379, 386, 404, 435, 436).
  - The split itself is correct: it switches at `md` (`sign-in-768-dark.png` is two columns; `sign-in-390-*` is a 152px art band plus form). There is no horizontal overflow at 390 on any captured page (`diag-summary.txt` `overflowX=false`). The code displays fit: about 210px of code text in a 350px column.

- **AU-21 [P3] Activate input and buttons bypass primitives** — `components/auth/DeviceActivation.tsx:182-213, 535-556`, `components/auth/device-login-styles.ts:16-30` — rules 13.2, 13.4, 9.4, 9.7, 7.4 —
  - Local `Button`/`BTN`/`primaryButton` re-implement press, hover, focus and disabled with their own values: `disabled:opacity-50/70`, not `DISABLED` 45; custom `focusRing` with `ring-offset`; `outline-none` + shadow ring on the input.
  - The code input's edge is `--rm-border` (hairline, below 3:1).
  - Static `id="code-error"` / `id="device-code"`.
  - `DeviceActivation.tsx:752`: an `<a>` carries the button class plus `hover:no-underline`.

  — Fix: use `Button` (`size="lg"` + `w-full min-h-11`), `Input` with `border-rm-field-edge`, the global focus ring, and `useId` for ids.

#### Shared causes

1. **Auth pages have their own primitives.** `DeviceActivation.tsx` (local `Button`, `BTN_*`) and `device-login-styles.ts` (`primaryButton`, `secondaryButton`, `quietButton`, `iconButton`, `focusRing`) re-implement what `ui/button.tsx` + `interaction.ts` already provide. That one choice causes most of AU-08, AU-10, AU-11, AU-12, AU-13, AU-14, AU-19 and AU-21. Moving both to `Button`/`IconButton`/`Input` with `PRESS`/`HIT`/`DISABLED` clears roughly 60 findings.
2. **The Kova SDK bridge stops at colours.** `styles.css:1784-1799` maps the surface and text tokens only. The SDK still sets error/success/warning colours, font size, `#fff` on primary, 44px-wide tabs and links, 15/14px text, and radius. One block of `.auth-split [data-ra-element=…]` overrides fixes AU-03 (Kova part), AU-04 and the Kova half of AU-11.
3. **Theme default is dark** (`theme-provider.tsx:9`), so light/miku/spiderman were never seen on auth pages. That is why AU-03, AU-04, AU-08 and the `ring-white` cards (AU-15) went unnoticed.
4. **Pre-Quiet-Pro public pages were never migrated:** `InviteClient.tsx`, `HomePageClient.tsx`, the `RoomPageClient.tsx` lobby, `SharedMessagePage.tsx`/`ShareSnapshotPreview.tsx`. All use glass cards (shadow + blur + white ring), palette colours, Tailwind text sizes and `sm:` breakpoints (AU-12, AU-15, AU-17, AU-19, AU-20).
5. **No error boundaries or 401 handling on public routes** (AU-01, AU-02, AU-18). Loaders rethrow, clients print `err.message`, and auth-required responses are treated as "invalid".
6. **Checker gap:** `[@media(hover:hover)_and_(pointer:fine)]:hover:` is reported as bare-hover. Either teach `scripts/audit-design-system.mjs` the pattern or standardise on `pointer-fine:`.

#### Needs fixture

- `/activate` **signed in**: enter (empty, short, bad format), loading, review (long device label + hostname + city/IP, long display name/email, avatar image fail), approve/deny busy, approved, and each outcome (expired, invalid, used, claimed, release_failed, rate_limited with a wait, mfa_required, network, unavailable). Shoot light, miku-dark and spiderman-light. The `deps` prop on `DeviceActivation` already allows this.
- `/invite/<code>` **signed in**: preview (long server name with emoji, icon and no-icon), joining, success, true 404 invalid. Plus the signed-out state after AU-02.
- `/share/<token>`: the local D1 needs the `message_shares` migration. Then capture loaded (attachments, omitted count, embeds, reactions, edited banner, long username) and gone (410).
- `home-390-light.png` captured "Error: Network connection lost" (miniflare). Re-shoot, and re-shoot 390 after hydration to separate AU-06 from timing.
- `sign-in-390-dark.png` is a blank `SplashScreen` frame. Re-shoot after auth loads, and capture the splash on purpose to check logo and progress bar.
- Kova error states: wrong password, invalid email, magic-link sent, in light theme. Needed to measure `--ra-color-error`/success.
- DesktopLogin in Tauri desktop and Tauri mobile: idle, starting, pending (with the expiry countdown), open-failed, verifying, success, each error. Check safe areas and 44px targets.
- `/room/<slug>` guest lobby (name entry, preflight warning, connecting) at 390/768/1280.
- All auth pages under miku-light/dark and spiderman-light/dark once AU-05 lets the theme be emulated.

---

## Appendix A. Full view inventory (269 rows)

Paths are relative to the repo root. "Fixture" is yes only for surfaces captured in this pass; rows marked no† have an unlisted `UiFixtures` surface (search, command menu).

Worktree: `F:/dev/TS/CLOUDFLARE/ralph-meet-quietpro` (read only). Component paths are absolute and point at the root JSX `return` (or the `createPortal(` call) of the view or state. "Phone form" is the layout below `md` (768px). Phone "n/a" means the trigger isn't rendered below `md` (for example, the desktop UserPanel is `hidden md:flex`).

Column rules:

- **Fixture**: `yes` only for the surfaces in the supplied coverage list (UiFixtures plus the screenshotted live routes). Rows marked `no†` have a surface in `src/components/dev/UiFixtures.tsx` / `search-fixtures.tsx` that wasn't in that list (`search`, `search-idle`, `search-results`, `search-filtered`, `search-empty`, `search-loading`, `search-error`, `search-dm`, `command-menu`). The summary counts them as `no`.
- **Being redesigned**: `yes` only when the component lives in SearchPanel.tsx, ShopView.tsx, CollectiblesCatalogModal.tsx, or ui/drawer.tsx. Every Drawer, ResponsiveDialog, PickerSurface, or ActionSheet row renders through `ui/drawer.tsx` on phones, so the drawer redesign reaches those rows too. See the Overlay column.
- **WIP**: `yes` only when the component file is in the WIP list. VoiceChannelView.tsx, RoomPageClient.tsx, and CallVoiceManager.tsx are marked `no`, but they import the WIP hook `src/hooks/useVoiceChannel.ts`.

### Auth & public pages

| #   | View                                                                                                                                                   | Kind          | Component                                                                                  | How reached                                                                                                       | Overlay primitive | Phone form              | Fixture | Being redesigned | WIP |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------- | ------- | ---------------- | --- |
| 1   | Marketing home (`/`, web)                                                                                                                              | page          | src/components/HomePageClient.tsx:488                                                      | Visit `/` in a browser (routes/index.tsx)                                                                         | none              | same (responsive)       | yes     | no               | no  |
| 2   | Home header / hero / features / CTA / footer sections                                                                                                  | panel         | src/components/HomePageClient.tsx:99 (hero :165, features :272, CTA :376, footer :434)     | Sections of `/`                                                                                                   | none              | same                    | yes     | no               | no  |
| 3   | Web sign-in (`/sign-in`)                                                                                                                               | page          | src/routes/sign-in.tsx:145                                                                 | `/sign-in` and the auth-guard redirect from `/chat`; Kova `<SignIn>` inside AuthSplitLayout                       | none              | same (art panel hidden) | yes     | no               | no  |
| 4   | Sign-in loading / redirecting                                                                                                                          | loading-state | src/routes/sign-in.tsx:142                                                                 | `/sign-in` while auth loads, when already signed in, or when there's an auth transfer code (renders SplashScreen) | none              | same                    | no      | no               | no  |
| 5   | Web sign-up (`/sign-up`)                                                                                                                               | page          | src/routes/sign-up.tsx:62                                                                  | `/sign-up` or the link from sign-in; Kova `<SignUp>`                                                              | none              | same                    | yes     | no               | no  |
| 6   | Auth split layout + dithered art panel                                                                                                                 | panel         | src/components/auth/AuthSplitLayout.tsx:20 (art: src/components/auth/AuthArtPanel.tsx:197) | Shell for `/sign-in`, `/sign-up`, `/activate`                                                                     | none              | same (single column)    | yes     | no               | no  |
| 7   | Device activation: enter code (`/activate`)                                                                                                            | page          | src/components/auth/DeviceActivation.tsx:522                                               | `/activate` with no code, or the "enter" step (error variants: empty / short)                                     | none              | same                    | yes     | no               | no  |
| 8   | Device activation: checking code                                                                                                                       | loading-state | src/components/auth/DeviceActivation.tsx:574                                               | `/activate?code=…` while the lookup runs                                                                          | none              | same                    | no      | no               | no  |
| 9   | Device activation: review / approve request                                                                                                            | page          | src/components/auth/DeviceActivation.tsx:607                                               | Valid code; shows "Sign in to Ralph Meet?"                                                                        | none              | same                    | no      | no               | no  |
| 10  | Device activation: approved                                                                                                                            | page          | src/components/auth/DeviceActivation.tsx:724                                               | After Approve                                                                                                     | none              | same                    | no      | no               | no  |
| 11  | Device activation: outcome errors (denied / expired / invalid / used / claimed / release_failed / rate_limited / mfa_required / network / unavailable) | error-state   | src/components/auth/DeviceActivation.tsx:744 (copy table :82)                              | Deny, or server/lookup failures                                                                                   | none              | same                    | no      | no               | no  |
| 12  | Desktop login (Tauri `/`, `/sign-in`, `/sign-up`)                                                                                                      | page          | src/components/DesktopLogin.tsx:228                                                        | Tauri app launch while signed out (routes/index, sign-in, sign-up all branch on isTauri)                          | none              | same (safe-area aware)  | no      | no               | no  |
| 13  | Desktop login: resolving                                                                                                                               | loading-state | src/components/DesktopLogin.tsx:117                                                        | Tauri while the stored session resolves (SplashScreen)                                                            | none              | same                    | no      | no               | no  |
| 14  | Desktop login: idle (get code)                                                                                                                         | panel         | src/components/DesktopLogin.tsx:463                                                        | Default step                                                                                                      | none              | same                    | no      | no               | no  |
| 15  | Desktop login: pending (device code + link + waiting dot)                                                                                              | panel         | src/components/DesktopLogin.tsx:518 (code: src/components/auth/DeviceCodeDisplay.tsx:12)   | After requesting a code                                                                                           | none              | same                    | no      | no               | no  |
| 16  | Desktop login: status panels (verifying, success "You're in", verify-unreachable, verify-rejected, denied, expired, error / MFA)                       | error-state   | src/components/DesktopLogin.tsx:605                                                        | Outcomes of the device flow (switch at :250-:370)                                                                 | none              | same                    | no      | no               | no  |
| 17  | Invite page (`/invite/$code`): loading                                                                                                                 | loading-state | src/components/chat/InviteClient.tsx:83                                                    | Open an invite link or a `ralphmeet://` deep link                                                                 | none              | same                    | no      | no               | no  |
| 18  | Invite page: preview / accept                                                                                                                          | page          | src/components/chat/InviteClient.tsx:95                                                    | Valid invite                                                                                                      | none              | same                    | no      | no               | no  |
| 19  | Invite page: joining                                                                                                                                   | loading-state | src/components/chat/InviteClient.tsx:167                                                   | Click Accept                                                                                                      | none              | same                    | no      | no               | no  |
| 20  | Invite page: success                                                                                                                                   | page          | src/components/chat/InviteClient.tsx:184                                                   | After join                                                                                                        | none              | same                    | no      | no               | no  |
| 21  | Invite page: "Invite Invalid" / expired                                                                                                                | error-state   | src/components/chat/InviteClient.tsx:201                                                   | Bad or expired code                                                                                               | none              | same                    | yes     | no               | no  |
| 22  | Shared message (`/share/$token`)                                                                                                                       | page          | src/components/chat/SharedMessagePage.tsx:84 (route: src/routes/share.$token.tsx:191)      | Public share link                                                                                                 | none              | same                    | no      | no               | yes |
| 23  | Shared message: loading                                                                                                                                | loading-state | src/components/chat/SharedMessagePage.tsx:101                                              | Client fetch when there's no loader data                                                                          | none              | same                    | no      | no               | yes |
| 24  | Shared message: "This share is gone"                                                                                                                   | error-state   | src/components/chat/SharedMessagePage.tsx:105                                              | 410, revoked, or expired token                                                                                    | none              | same                    | yes     | no               | yes |
| 25  | Share snapshot card                                                                                                                                    | panel         | src/components/chat/ShareSnapshotPreview.tsx:89                                            | Body of the share page and of MessageShareModal                                                                   | none              | same                    | no      | no               | no  |
| 26  | Meeting room (`/room/$slug`): guest pre-join form                                                                                                      | page          | src/components/RoomPageClient.tsx:98                                                       | Open a room link without a guest name ("Join Meeting")                                                            | none              | same                    | no      | no               | no  |
| 27  | Meeting room: connecting                                                                                                                               | loading-state | src/components/RoomPageClient.tsx:601                                                      | After submit, before join ("Connecting to {slug}…")                                                               | none              | same                    | no      | no               | no  |
| 28  | Meeting room: in-room view                                                                                                                             | page          | src/components/RoomPageClient.tsx:613                                                      | Joined (RoomVoiceView: header + grid + controls + temp chat)                                                      | none              | same                    | no      | no               | no  |
| 29  | 404 not found                                                                                                                                          | error-state   | src/routes/\_\_root.tsx:62                                                                 | Any unknown route                                                                                                 | none              | same                    | no      | no               | no  |
| 30  | `/ui-fixtures` (dev only)                                                                                                                              | page          | src/routes/ui-fixtures.tsx:36                                                              | DEV builds only; production returns notFound                                                                      | none              | same                    | n/a     | no               | no  |

### Chat shell

| #   | View                                                                                              | Kind          | Component                                                                                             | How reached                                                               | Overlay primitive                          | Phone form                               | Fixture | Being redesigned | WIP |
| --- | ------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------- | ------- | ---------------- | --- |
| 31  | Chat app shell (`/chat`, `/chat/$`)                                                               | page          | src/components/chat/ChatPageClient.tsx:1095                                                           | Signed-in `/chat` (routes/chat.tsx ChatLayout)                            | none                                       | same (rail + sidebar move into a drawer) | yes     | no               | yes |
| 32  | Chat OAuth callback gate (blank)                                                                  | loading-state | src/routes/chat.tsx:173                                                                               | `/chat?kova_auth_code=…` while the token is exchanged                     | none                                       | same                                     | no      | no               | no  |
| 33  | Web title bar                                                                                     | panel         | src/components/chat/AppTitleBar.tsx:61                                                                | Top of the shell on web (non-Tauri)                                       | none                                       | same                                     | yes     | no               | no  |
| 34  | Desktop window chrome (Tauri title bar, window controls, resize edges)                            | panel         | desktop/desktop-entry.tsx:164 (title content: src/components/chat/AppTitleBar.tsx:28)                 | Wraps the router in the Tauri desktop build                               | none                                       | n/a                                      | no      | no               | no  |
| 35  | Server rail (home/DM button, server icons, unread/mention badges, create server)                  | panel         | src/components/chat/ServerList.tsx:211                                                                | Left strip, desktop; on phones, the Servers tab of MobileNavigationSheet  | none                                       | drawer (inside MobileNavigationSheet)    | yes     | no               | no  |
| 36  | Channel sidebar (server header, categories, channels, voice members)                              | panel         | src/components/chat/ChannelSidebar.tsx:1014                                                           | Select a server; desktop column, phone drawer                             | none                                       | drawer                                   | yes     | no               | no  |
| 37  | Channel sidebar: themed server banner header (Miku / Spider-Man)                                  | panel         | src/components/chat/ChannelSidebar.tsx:1021                                                           | Special servers only                                                      | none                                       | drawer                                   | no      | no               | no  |
| 38  | Channel category group (collapsible, drag-sortable)                                               | panel         | src/components/chat/ChannelSidebar.tsx:1932                                                           | Inside the channel sidebar                                                | none                                       | drawer                                   | yes     | no               | no  |
| 39  | Channel row (text/voice, unread, drag)                                                            | panel         | src/components/chat/ChannelSidebar.tsx:449                                                            | Inside a category                                                         | none                                       | drawer                                   | yes     | no               | no  |
| 40  | Voice channel member row (speaking/muted/streaming)                                               | panel         | src/components/chat/ChannelSidebar.tsx:1714                                                           | Under an occupied voice channel                                           | none                                       | drawer                                   | yes     | no               | no  |
| 41  | Voice channel media/status display row                                                            | panel         | src/components/chat/ChannelSidebar.tsx:262                                                            | Voice channel with a status/media set                                     | none                                       | drawer                                   | no      | no               | no  |
| 42  | Listen Together sidebar status chip                                                               | panel         | src/components/chat/ListenTogetherSidebarStatus.tsx:20                                                | Voice channel with an active Listen Together room (ChannelSidebar :563)   | none                                       | drawer                                   | no      | no               | no  |
| 43  | Voice stream hover card (live stream preview)                                                     | popover       | src/components/chat/VoiceStreamHoverCard.tsx:71                                                       | Hover a streaming member in the sidebar (ChannelSidebar :1841)            | none (absolute)                            | n/a (hover)                              | no      | no               | no  |
| 44  | Channel sidebar resize handle                                                                     | panel         | src/components/chat/ChatPageClient.tsx:1186                                                           | Drag or arrow keys on the sidebar edge, desktop                           | none                                       | n/a                                      | yes     | no               | yes |
| 45  | DM sidebar (Friends / Shop entries + DM list)                                                     | panel         | src/components/chat/DMSidebar.tsx:132                                                                 | Home/DM button in the rail (`@me`); phone Messages tab                    | none                                       | drawer                                   | yes     | no               | no  |
| 46  | DM list                                                                                           | panel         | src/components/chat/DMListPanel.tsx:55                                                                | Inside DMSidebar                                                          | none                                       | drawer                                   | yes     | no               | no  |
| 47  | DM list empty ("No DMs yet")                                                                      | empty-state   | src/components/chat/DMListPanel.tsx:58                                                                | No DM channels                                                            | none                                       | drawer                                   | no      | no               | no  |
| 48  | Friends view (Online / All / Pending / Blocked tabs)                                              | page          | src/components/chat/FriendsView.tsx:228                                                               | `@me` with no DM selected (default dmHomeView)                            | none                                       | same                                     | yes     | no               | no  |
| 49  | Friends: Add Friend form                                                                          | panel         | src/components/chat/FriendsView.tsx:278                                                               | "Add Friend" button                                                       | none                                       | same                                     | no      | no               | no  |
| 50  | Friends: empty tabs (No friends online / No friends yet / No pending requests / No blocked users) | empty-state   | src/components/chat/FriendsView.tsx:339                                                               | Tab with zero entries                                                     | none                                       | same                                     | no      | no               | no  |
| 51  | Chat area (channel / DM conversation)                                                             | panel         | src/components/chat/ChatArea.tsx:268                                                                  | Select a text channel or DM                                               | none                                       | same                                     | yes     | no               | no  |
| 52  | Chat header (title, topic, call / pins / members / search / bell)                                 | panel         | src/components/chat/ChatHeader.tsx:87                                                                 | Top of ChatArea; on phones the back button opens the nav drawer           | none                                       | same                                     | yes     | no               | no  |
| 53  | Member list / channel details (tabs Members, Media, Pins, Threads, Links, Files)                  | panel         | src/components/chat/MemberList.tsx:552                                                                | Members button in ChatHeader (ChatArea :439)                              | custom fixed (phone/tablet), inline at lg  | full-page                                | yes     | no               | no  |
| 54  | Member list tablet scrim                                                                          | overlay-state | src/components/chat/ChatArea.tsx:434                                                                  | Member list open below lg                                                 | custom fixed inset-0                       | full-page                                | no      | no               | no  |
| 55  | Member list: member row (nameplate, status, platform icons)                                       | panel         | src/components/chat/MemberList.tsx:1910                                                               | Members tab                                                               | none                                       | full-page                                | yes     | no               | no  |
| 56  | Member list: Media tab                                                                            | panel         | src/components/chat/MemberList.tsx:1195                                                               | Details tab                                                               | none                                       | full-page                                | no      | no               | no  |
| 57  | Member list: Pins / Threads / Links / Files tabs                                                  | panel         | src/components/chat/MemberList.tsx:1277 (threads :1350, links :1421, files :1508)                     | Details tabs                                                              | none                                       | full-page                                | no      | no               | no  |
| 58  | Member list: tab loading (spinner / media skeleton grid)                                          | loading-state | src/components/chat/MemberList.tsx:1616 (skeleton :1628)                                              | Details tab fetching                                                      | none                                       | full-page                                | no      | no               | no  |
| 59  | Member list: tab error + retry                                                                    | error-state   | src/components/chat/MemberList.tsx:1774                                                               | Details fetch failed                                                      | none                                       | full-page                                | no      | no               | no  |
| 60  | Member list: tab empty                                                                            | empty-state   | src/components/chat/MemberList.tsx:1813                                                               | No media / pins / threads / links / files                                 | none                                       | full-page                                | no      | no               | no  |
| 61  | Pinned messages sidebar                                                                           | panel         | src/components/chat/PinnedMessagesSidebar.tsx:53 (host overlay: src/components/chat/ChatArea.tsx:317) | Pins button in ChatHeader                                                 | custom absolute overlay                    | full-page                                | no      | no               | no  |
| 62  | Pinned: loading ("Loading Pins...")                                                               | loading-state | src/components/chat/PinnedMessagesSidebar.tsx:77                                                      | Pins fetching                                                             | none                                       | full-page                                | no      | no               | no  |
| 63  | Pinned: empty ("No pinned messages")                                                              | empty-state   | src/components/chat/PinnedMessagesSidebar.tsx:88                                                      | No pins                                                                   | none                                       | full-page                                | no      | no               | no  |
| 64  | Thread sidebar (root message, replies, reply input)                                               | panel         | src/components/chat/ThreadSidebar.tsx:168 (input :306)                                                | "Create/View Thread" on a message, or the thread badge (ChatArea :480)    | custom (max-md fixed inset-0)              | full-page                                | no      | no               | no  |
| 65  | Thread: loading                                                                                   | loading-state | src/components/chat/ThreadSidebar.tsx:200                                                             | Thread fetching                                                           | none                                       | full-page                                | no      | no               | no  |
| 66  | Search panel                                                                                      | panel         | src/components/chat/SearchPanel.tsx:1029                                                              | Search field in ChatHeader or the CommandMenu search item (ChatArea :420) | custom (max-md fixed inset-0, role=dialog) | full-page                                | no†     | yes              | no  |
| 67  | Search: idle / suggestions (filters from:, in:, has:)                                             | panel         | src/components/chat/SearchPanel.tsx:230 (rows: src/components/chat/search/SuggestionContent.tsx:39)   | Empty query or typing a filter token                                      | none                                       | full-page                                | no†     | yes              | no  |
| 68  | Search: filter chips                                                                              | panel         | src/components/chat/SearchPanel.tsx:179                                                               | Applied filters                                                           | none                                       | full-page                                | no†     | yes              | no  |
| 69  | Search: results list + result item                                                                | panel         | src/components/chat/search/SearchResultItem.tsx:114                                                   | Results returned                                                          | none                                       | full-page                                | no†     | no               | no  |
| 70  | Search: loading skeleton                                                                          | loading-state | src/components/chat/SearchPanel.tsx:291                                                               | Query in flight                                                           | none                                       | full-page                                | no†     | yes              | no  |
| 71  | Search: "No messages found"                                                                       | empty-state   | src/components/chat/SearchPanel.tsx:940                                                               | Zero results (separate copy when filters are applied)                     | none                                       | full-page                                | no†     | yes              | no  |
| 72  | Search: "Search didn't load"                                                                      | error-state   | src/components/chat/SearchPanel.tsx:927                                                               | Request failed                                                            | none                                       | full-page                                | no†     | yes              | no  |
| 73  | User panel / voice dock (avatar, mute, deafen, settings, voice connection strip)                  | panel         | src/components/chat/UserPanel.tsx:390                                                                 | Bottom of the left nav, desktop                                           | none                                       | n/a (hidden below md)                    | yes     | no               | yes |
| 74  | User panel: DM call dashboard section                                                             | panel         | src/components/chat/UserPanel.tsx:176                                                                 | In an active DM call                                                      | none                                       | n/a                                      | no      | no               | yes |
| 75  | Voice text-chat side panel (ChatArea over the voice view)                                         | drawer        | src/components/chat/ChatPageClient.tsx:1369 (scrim :1359)                                             | Text-chat toggle in VoiceHeader                                           | custom absolute + scrim                    | full-page (w-full, max 420)              | no      | no               | yes |

### Messages

| #   | View                                                               | Kind          | Component                                                                                                                           | How reached                                                            | Overlay primitive                | Phone form                         | Fixture | Being redesigned | WIP |
| --- | ------------------------------------------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------- | ---------------------------------- | ------- | ---------------- | --- |
| 76  | Message list (virtualized)                                         | panel         | src/components/chat/VirtualMessageList.tsx:1002                                                                                     | ChatArea body                                                          | none                             | same                               | yes     | no               | no  |
| 77  | Message list: loading-older skeletons                              | loading-state | src/components/chat/VirtualMessageList.tsx:180 (group :163, row :137)                                                               | Initial load or scroll back with hasMore                               | none                             | same                               | no      | no               | no  |
| 78  | Channel / DM welcome header                                        | empty-state   | src/components/chat/ChatWelcomeContent.tsx:28                                                                                       | Top of history (no more messages); a brand-new channel shows only this | none                             | same                               | yes     | no               | no  |
| 79  | No channel selected                                                | empty-state   | src/components/chat/EmptyChatArea.tsx:6                                                                                             | Server with no active channel (ChatArea :265)                          | none                             | same                               | yes     | no               | no  |
| 80  | New-messages separator                                             | panel         | src/components/chat/NewMessageSeparator.tsx:8                                                                                       | First unread message                                                   | none                             | same                               | no      | no               | no  |
| 81  | Unread banner ("N new messages since…")                            | floating      | src/components/chat/UnreadBanner.tsx:27                                                                                             | Unread messages above the viewport                                     | none                             | same                               | no      | no               | no  |
| 82  | Jump to present                                                    | floating      | src/components/chat/ChatJumpToPresent.tsx:6                                                                                         | Scrolled away from the bottom                                          | none                             | same                               | no      | no               | no  |
| 83  | Typing indicator                                                   | panel         | src/components/chat/ChatTypingIndicator.tsx:8                                                                                       | Others typing                                                          | none                             | same                               | yes     | no               | no  |
| 84  | Drag-and-drop upload overlay                                       | overlay-state | src/components/chat/DragDropOverlay.tsx:5                                                                                           | Drag files over ChatArea                                               | none (absolute)                  | n/a                                | no      | no               | no  |
| 85  | Message item (author, body, reactions, attachments)                | panel         | src/components/chat/MessageItem.tsx:927                                                                                             | Each message                                                           | none                             | same                               | yes     | no               | no  |
| 86  | Message hover toolbar (react, reply, thread, more)                 | floating      | src/components/chat/MessageItem.tsx:1371                                                                                            | Hover or focus a message (desktop)                                     | none (absolute)                  | n/a (long-press opens ActionSheet) | no      | no               | no  |
| 87  | Message inline edit mode                                           | panel         | src/components/chat/MessageItem.tsx:1052                                                                                            | Edit from the toolbar or context menu                                  | none                             | same                               | no      | no               | no  |
| 88  | Message thread badge                                               | panel         | src/components/chat/MessageItem.tsx:1354                                                                                            | Message that has a thread                                              | none                             | same                               | no      | no               | no  |
| 89  | Reaction tooltip (who reacted)                                     | popover       | src/components/chat/MessageItem.tsx:245                                                                                             | Hover a reaction pill                                                  | Tooltip                          | n/a                                | no      | no               | no  |
| 90  | Markdown body (mentions, emoji, code, spoilers)                    | panel         | src/components/chat/MarkdownRenderer.tsx:1                                                                                          | Inside messages, pins, member Pins tab                                 | none                             | same                               | yes     | no               | no  |
| 91  | Link embed: generic / rich card                                    | panel         | src/components/chat/LinkEmbed.tsx:5113 (base :255, rich :3614)                                                                      | Message with a URL                                                     | none                             | same                               | no      | no               | no  |
| 92  | Link embed: YouTube / TikTok / direct video                        | panel         | src/components/chat/LinkEmbed.tsx:850 (TikTok :936, direct :498, video :3575)                                                       | Video URLs                                                             | none                             | same                               | no      | no               | no  |
| 93  | Link embed: Spotify                                                | panel         | src/components/chat/LinkEmbed.tsx:1877                                                                                              | Spotify URL                                                            | none                             | same                               | no      | no               | no  |
| 94  | Link embed: X / Twitter (tweet, quoted tweet, media grid, metrics) | panel         | src/components/chat/LinkEmbed.tsx:2201                                                                                              | x.com URL                                                              | none                             | same                               | no      | no               | no  |
| 95  | Link embed: Instagram                                              | panel         | src/components/chat/LinkEmbed.tsx:4938                                                                                              | Instagram URL                                                          | none                             | same                               | no      | no               | no  |
| 96  | Link embed: unavailable social post                                | error-state   | src/components/chat/LinkEmbed.tsx:4967                                                                                              | Embed resolve failed                                                   | none                             | same                               | no      | no               | no  |
| 97  | Remove embeds confirm                                              | modal         | src/components/chat/LinkEmbed.tsx:419                                                                                               | "Remove embeds" on your own message                                    | custom fixed inset-0 (no portal) | same                               | no      | no               | no  |
| 98  | Image grid attachments                                             | panel         | src/components/chat/ImageGrid.tsx:290                                                                                               | Message with images or GIFs                                            | none                             | same                               | no      | no               | no  |
| 99  | Video attachment player (controls, splash, big-play)               | panel         | src/components/chat/VideoAttachment.tsx:456 (controls: src/components/chat/VideoPlayerControls.tsx:277, splash :361, big-play :385) | Message with video                                                     | none                             | same                               | no      | no               | no  |
| 100 | Sensitive media blur ("Show")                                      | overlay-state | src/components/chat/SensitiveMediaFrame.tsx:44                                                                                      | Media flagged by the privacy filter                                    | none                             | same                               | no      | no               | no  |
| 101 | Composer (message input)                                           | panel         | src/components/chat/MessageInput.tsx:88                                                                                             | Bottom of ChatArea                                                     | none                             | same                               | yes     | no               | no  |
| 102 | Composer controls (attach, GIF, emoji, sticker buttons)            | panel         | src/components/chat/InputControls.tsx:80                                                                                            | Inside the composer                                                    | none                             | same                               | yes     | no               | no  |
| 103 | Composer: no-permission placeholder                                | empty-state   | src/components/chat/ChatArea.tsx:412                                                                                                | Channel where you lack SEND_MESSAGES                                   | none                             | same                               | no      | no               | no  |
| 104 | Composer: reply indicator                                          | panel         | src/components/chat/ReplyIndicator.tsx:19                                                                                           | Reply to a message                                                     | none                             | same                               | no      | no               | no  |
| 105 | Composer: attachment tray                                          | panel         | src/components/chat/AttachmentList.tsx:33                                                                                           | Files attached                                                         | none                             | same                               | no      | no               | no  |
| 106 | Mention autocomplete                                               | popover       | src/components/chat/MentionAutocomplete.tsx:23                                                                                      | Type `@` in the composer                                               | none (absolute)                  | same                               | no      | no               | no  |
| 107 | Hovered-mention tooltip                                            | popover       | src/components/chat/HoveredMentionTooltip.tsx:16                                                                                    | Hover a mention token in the composer                                  | none (absolute)                  | n/a                                | no      | no               | no  |

### Modals

| #   | View                                                                  | Kind  | Component                                                                                                                                                                                                                 | How reached                                                                                          | Overlay primitive                        | Phone form                      | Fixture | Being redesigned | WIP |
| --- | --------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------- | ------- | ---------------- | --- |
| 108 | Invite to server                                                      | modal | src/components/chat/InviteModal.tsx:85                                                                                                                                                                                    | Server menu "Invite to Server" or the ChatHeader invite button (ChatPageClient :1614)                | ResponsiveDialog                         | drawer                          | yes     | no               | no  |
| 109 | Invite to channel (friend picker)                                     | modal | src/components/chat/ChannelInviteModal.tsx:137                                                                                                                                                                            | Channel context menu "Invite to Channel" (ChannelSidebar :1153)                                      | ResponsiveDialog                         | drawer                          | no      | no               | no  |
| 110 | Create server                                                         | modal | src/components/chat/CreateServerModal.tsx:249                                                                                                                                                                             | "+" in the server rail (ServerList :538)                                                             | ResponsiveDialog                         | drawer                          | no      | no               | no  |
| 111 | Create channel                                                        | modal | src/components/chat/CreateChannelModal.tsx:226                                                                                                                                                                            | Server menu, category, or sidebar context "Create Channel"                                           | ResponsiveDialog                         | drawer                          | no      | no               | no  |
| 112 | Create category                                                       | modal | src/components/chat/CreateCategoryModal.tsx:74                                                                                                                                                                            | Server menu or sidebar context "Create Category"                                                     | ResponsiveDialog                         | drawer                          | no      | no               | no  |
| 113 | Pin message confirm                                                   | modal | src/components/chat/PinModal.tsx:157                                                                                                                                                                                      | Message context "Pin Message" (ChatArea :303)                                                        | ResponsiveDialog                         | drawer                          | no      | no               | no  |
| 114 | Delete message confirm                                                | modal | src/components/chat/MessageItem.tsx:1670                                                                                                                                                                                  | Message toolbar/context "Delete"                                                                     | Dialog (custom surface, bottom-anchored) | sheet                           | no      | no               | no  |
| 115 | Share message (public snapshot link)                                  | modal | src/components/chat/MessageShareModal.tsx:81                                                                                                                                                                              | Message context "Share"                                                                              | Dialog (custom surface, bottom-anchored) | sheet                           | no      | no               | no  |
| 116 | Reaction details (who reacted, per emoji)                             | modal | src/components/chat/ReactionDetailsModal.tsx:189                                                                                                                                                                          | "View details" in a reaction pill tooltip (MessageItem :1310, mounted :1585)                         | ResponsiveDialog                         | drawer                          | no      | no               | no  |
| 117 | External link confirm ("Leaving Ralph Meet")                          | modal | src/components/ui/ExternalLinkConfirmModal.tsx:32                                                                                                                                                                         | Click an external link in a message or image viewer (hooks/useExternalLinkConfirmation.tsx)          | ResponsiveDialog                         | drawer                          | no      | no               | no  |
| 118 | Image / media viewer (lightbox)                                       | modal | src/components/chat/ImageViewerModal.tsx:521                                                                                                                                                                              | Click an image or video attachment (global store; mounted in routes/chat.tsx)                        | Dialog (fixed inset-0 surface)           | full-page                       | no      | no               | no  |
| 119 | Image viewer toolbar / content / nav / thumbnails                     | panel | src/components/chat/ImageViewerToolbar.tsx:135 (content: src/components/chat/ImageViewerContent.tsx:118, nav: src/components/chat/ImageViewerNavigation.tsx:12, thumbs: src/components/chat/ImageViewerThumbnails.tsx:32) | Inside the image viewer                                                                              | none                                     | full-page                       | no      | no               | no  |
| 120 | User profile modal (full profile, mutuals, tabs)                      | modal | src/components/chat/UserProfileModal.tsx:201                                                                                                                                                                              | "View Full Profile" from the popover, or a voice participant "Profile" (ChatPageClient :1658)        | Dialog (custom surface)                  | same (min(1240, 100vw-32) card) | no      | no               | no  |
| 121 | Voice switch confirm ("You sure?")                                    | modal | src/components/chat/VoiceSwitchModal.tsx:105                                                                                                                                                                              | Join another voice channel or call while connected (ChatPageClient :1693)                            | ResponsiveDialog                         | drawer                          | no      | no               | no  |
| 122 | Start call confirm                                                    | modal | src/components/chat/StartCallModal.tsx:96                                                                                                                                                                                 | Call button in a DM header while in voice (ChatPageClient :1710)                                     | ResponsiveDialog                         | drawer                          | no      | no               | no  |
| 123 | Incoming call                                                         | modal | src/components/chat/IncomingCallModal.tsx:108                                                                                                                                                                             | Call store `ringing_incoming` when you aren't viewing that DM (ChatPageClient :1688)                 | Dialog (transparent fixed surface)       | same                            | no      | no               | no  |
| 124 | Audio interaction prompt (enable audio)                               | modal | src/components/voice/AudioInteractionModal.tsx:16                                                                                                                                                                         | Autoplay blocked when voice audio starts (ChatPageClient :1674, RoomPageClient :754)                 | Dialog                                   | same                            | no      | no               | no  |
| 125 | Voice channel text status editor                                      | modal | src/components/chat/VoiceChannelTextStatusModal.tsx:83                                                                                                                                                                    | Click "Set a channel status" under your connected voice channel (ChannelSidebar :576, mounted :703)  | Dialog (custom surface)                  | same                            | no      | no               | no  |
| 126 | Voice channel media status picker                                     | modal | src/components/chat/VoiceChannelMediaStatusModal.tsx:319                                                                                                                                                                  | Media-status control under your connected voice channel (ChannelSidebar :622, mounted :710)          | Dialog (custom surface)                  | same                            | no      | no               | no  |
| 127 | Screen share picker (web)                                             | modal | src/components/ScreenShareModal.tsx:83                                                                                                                                                                                    | Share screen in VoiceControls, UserPanel, DMCallRegion, or Room (UnifiedScreenShareModal, non-Tauri) | Dialog                                   | same                            | no      | no               | no  |
| 128 | Screen share picker (Tauri desktop: screens / windows / devices tabs) | modal | src/components/DesktopScreenPickerModal.tsx:534 (grids: src/components/DesktopScreenPickerUI.tsx:125, tab bar :221, bottom bar :275)                                                                                      | Same triggers on Tauri (src/components/UnifiedScreenShareModal.tsx:29)                               | Dialog                                   | unknown (Tauri mobile untested) | no      | no               | no  |
| 129 | Delete sound confirm                                                  | modal | src/components/chat/SoundboardPicker.tsx:2740                                                                                                                                                                             | Delete on a custom sound in the soundboard                                                           | Dialog (custom fixed surface)            | same                            | no      | no               | no  |
| 130 | Upload sound                                                          | modal | src/components/chat/UploadSoundModal.tsx:213                                                                                                                                                                              | "Upload" in the soundboard picker (SoundboardPicker :2719)                                           | ResponsiveDialog                         | drawer                          | no      | no               | no  |
| 131 | Demo room upload blocker                                              | modal | src/components/DemoRoomChatPanel.tsx:298                                                                                                                                                                                  | Try to upload in a meeting-room temp chat                                                            | Dialog (custom fixed surface)            | same                            | no      | no               | no  |
| 132 | Hardware acceleration restart confirm                                 | modal | src/components/chat/settings/DesktopPanel.tsx:90                                                                                                                                                                          | Toggle hardware acceleration in Settings > Desktop                                                   | Dialog                                   | same                            | no      | no               | no  |
| 133 | Outgoing call modal (legacy)                                          | modal | src/components/chat/OutgoingCallModal.tsx:104                                                                                                                                                                             | Unreachable: not imported anywhere (replaced by DMCallRegion ringing state, chat-gateway.ts:792)     | ResponsiveDialog                         | drawer                          | no      | no               | no  |

### Popovers & menus

| #   | View                                                                                                                                                 | Kind          | Component                                                                                                                                             | How reached                                                                                                                    | Overlay primitive                                         | Phone form                                         | Fixture                             | Being redesigned | WIP |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | -------------------------------------------------- | ----------------------------------- | ---------------- | --- |
| 134 | Context menu (shared shell, submenus)                                                                                                                | context-menu  | src/components/chat/ContextMenu.tsx:308 (phone sheet :73)                                                                                             | Right-click or long-press (hooks/useContextMenu.ts)                                                                            | custom fixed+createPortal (desktop) / ActionSheet (phone) | sheet                                              | yes                                 | no               | no  |
| 135 | Server icon menu (Mark as Read, Copy ID, Leave Server)                                                                                               | context-menu  | src/components/chat/ServerList.tsx:544                                                                                                                | Right-click a server icon                                                                                                      | ContextMenu                                               | sheet                                              | no                                  | no               | no  |
| 136 | Server header dropdown (Boost, Invite, Settings, Create Channel/Category/Event, App Directory, Notification/Privacy, per-server profile, Hide Muted) | context-menu  | src/components/chat/ChannelSidebar.tsx:1455 (rendered :1182)                                                                                          | Click the server name header                                                                                                   | ContextMenu                                               | sheet                                              | no                                  | no               | no  |
| 137 | Channel menu (Mark read, Invite, Copy Link, Mute, Notifications, Edit, Duplicate, Delete, Copy ID)                                                   | context-menu  | src/components/chat/ChannelSidebar.tsx:1254                                                                                                           | Right-click a channel                                                                                                          | ContextMenu                                               | sheet                                              | yes                                 | no               | no  |
| 138 | Category menu (Create Channel, Copy ID, Delete Category)                                                                                             | context-menu  | src/components/chat/ChannelSidebar.tsx:1384                                                                                                           | Right-click a category                                                                                                         | ContextMenu                                               | sheet                                              | no                                  | no               | no  |
| 139 | Sidebar blank-area menu (Create Channel/Category, Invite, Copy ID)                                                                                   | context-menu  | src/components/chat/ChannelSidebar.tsx:1420                                                                                                           | Right-click empty sidebar space                                                                                                | ContextMenu                                               | sheet                                              | no                                  | no               | no  |
| 140 | Voice member menu (mute/deafen self, volume, profile, message)                                                                                       | context-menu  | src/components/chat/ChannelSidebar.tsx:1191 (trigger :1730)                                                                                           | Right-click a voice member row (opens StreamContextMenu)                                                                       | custom fixed+createPortal                                 | same (no phone branch)                             | no                                  | no               | no  |
| 141 | DM menu (Profile, Start a Call, Copy ID, Close DM)                                                                                                   | context-menu  | src/components/chat/DMSidebar.tsx:206                                                                                                                 | Right-click a DM (DMListPanel :101)                                                                                            | ContextMenu                                               | sheet                                              | no                                  | no               | no  |
| 142 | Friend menu (Profile, Message, Start a Call, Remove Friend)                                                                                          | context-menu  | src/components/chat/FriendsView.tsx:515                                                                                                               | Right-click a friend row                                                                                                       | ContextMenu                                               | sheet                                              | no                                  | no               | no  |
| 143 | Message menu (Add Reaction, Edit, Reply, Thread, Pin/Unpin, Copy Text/Link, Open Link, Share, Profile, Copy ID, Delete, Ban User)                    | context-menu  | src/components/chat/MessageItem.tsx:1572                                                                                                              | Right-click or long-press a message, or the toolbar "more"                                                                     | ContextMenu                                               | sheet                                              | no                                  | no               | no  |
| 144 | Member menu (Profile, Message, Start a Call, Copy ID, Ban)                                                                                           | context-menu  | src/components/chat/MemberList.tsx:689                                                                                                                | Right-click a member                                                                                                           | ContextMenu                                               | sheet                                              | no                                  | no               | no  |
| 145 | Image viewer media menu (Save Image, Copy/Open Media Link)                                                                                           | context-menu  | src/components/chat/ImageViewerModal.tsx:612                                                                                                          | Right-click media in the viewer                                                                                                | ContextMenu                                               | sheet                                              | no                                  | no               | no  |
| 146 | Listen Together result menu (desktop)                                                                                                                | context-menu  | src/components/chat/ListenTogetherPanel.tsx:1474                                                                                                      | Right-click a search result / queue item                                                                                       | ContextMenu                                               | sheet                                              | no                                  | no               | no  |
| 147 | Listen Together result action sheet (mobile)                                                                                                         | sheet         | src/components/chat/ListenTogetherResultActions.tsx:95 (trigger :18)                                                                                  | Tap a result's "…" below lg (ListenTogetherPanel :1484)                                                                        | custom fixed+createPortal                                 | sheet                                              | no                                  | no               | no  |
| 148 | Stream context menu (local: quality, audio, source, preview, stop / remote: watch, volume, profile, message)                                         | context-menu  | src/components/StreamContextMenu.tsx:322 (local: src/components/ContextMenu/LocalMenu.tsx:164, remote: src/components/ContextMenu/RemoteMenu.tsx:215) | Right-click a participant tile, floating preview, or sidebar stream (VoiceGrid wrapper: src/components/voice/VoiceGrid.tsx:32) | custom fixed+createPortal                                 | same (no phone branch)                             | no                                  | no               | no  |
| 149 | User profile popover                                                                                                                                 | popover       | src/components/chat/UserProfilePopover.tsx:874                                                                                                        | Click an avatar or name in messages, members, DMs, friends, voice rows, or a mention                                           | custom fixed+createPortal                                 | drawer (MobileProfileSheet via :485)               | no                                  | no               | no  |
| 150 | Profile popover: role assignment dropdown                                                                                                            | popover       | src/components/chat/UserProfilePopover.tsx:306                                                                                                        | "+" on the roles row (with Manage Roles)                                                                                       | none (absolute)                                           | drawer                                             | no                                  | no               | no  |
| 151 | User account popover (status picker, custom status, edit profile, switch, sign out)                                                                  | popover       | src/components/chat/UserAccountPopover.tsx:240                                                                                                        | Click your avatar in the UserPanel (UserPanel :822)                                                                            | custom fixed+createPortal                                 | n/a (UserPanel hidden below md; see MobileYouPage) | no                                  | no               | no  |
| 152 | Notification bell + inbox                                                                                                                            | popover       | src/components/chat/NotificationBell.tsx:77 (inbox :174, row :276)                                                                                    | Bell in ChatHeader                                                                                                             | custom fixed (md: absolute dropdown)                      | sheet (bottom, with scrim)                         | no                                  | no               | no  |
| 153 | Notification inbox empty ("No notifications yet")                                                                                                    | empty-state   | src/components/chat/NotificationBell.tsx:217                                                                                                          | No notifications                                                                                                               | none                                                      | sheet                                              | yes (mobile-home notifications tab) | no               | no  |
| 154 | Audio device menu (input/output select, volume)                                                                                                      | popover       | src/components/chat/AudioDeviceMenu.tsx:204                                                                                                           | Chevron next to mute/deafen in the UserPanel (UserPanel :661, :768)                                                            | custom fixed+createPortal                                 | n/a                                                | no                                  | no               | no  |
| 155 | Emoji picker                                                                                                                                         | popover       | src/components/chat/EmojiPicker.tsx:753                                                                                                               | Composer emoji button, message reaction, upload-sound emoji, voice status emoji                                                | PickerSurface (+ createPortal click-catcher)              | drawer (85dvh)                                     | no                                  | no               | no  |
| 156 | Emoji picker: loading generated/custom emoji                                                                                                         | loading-state | src/components/chat/EmojiPicker.tsx:338                                                                                                               | First open while the custom set loads                                                                                          | none                                                      | drawer                                             | no                                  | no               | no  |
| 157 | GIF / sticker / meme / clip picker                                                                                                                   | popover       | src/components/chat/GifPickerModal.tsx:1377                                                                                                           | Composer GIF button, voice reactions (VoiceDashboard :991, VoiceControls), avatar picker, voice media status, demo chat        | PickerSurface                                             | drawer (85dvh)                                     | no                                  | no               | no  |
| 158 | GIF picker: loading skeleton                                                                                                                         | loading-state | src/components/chat/GifPickerModal.tsx:2231                                                                                                           | Fetching                                                                                                                       | none                                                      | drawer                                             | no                                  | no               | no  |
| 159 | GIF picker: favorites empty                                                                                                                          | empty-state   | src/components/chat/GifPickerModal.tsx:2177                                                                                                           | Favorites tab with none                                                                                                        | none                                                      | drawer                                             | no                                  | no               | no  |
| 160 | GIF picker: error / rate-limit / no categories                                                                                                       | error-state   | src/components/chat/GifPickerModal.tsx:1860                                                                                                           | Provider failure                                                                                                               | none                                                      | drawer                                             | no                                  | no               | no  |
| 161 | GIF picker: hover preview                                                                                                                            | popover       | src/components/chat/GifPickerModal.tsx:2305                                                                                                           | Hover a tile                                                                                                                   | none                                                      | n/a                                                | no                                  | no               | no  |
| 162 | Command menu (quick switcher: DMs, channels, servers, actions, search)                                                                               | modal         | src/components/CommandMenu.tsx:157 (groups: src/components/CommandMenuGroups.tsx:103)                                                                 | Ctrl/Cmd+K anywhere in /chat (routes/chat.tsx)                                                                                 | custom fixed inset-0                                      | same (top-anchored)                                | no†                                 | no               | no  |
| 163 | Command menu: "Nothing matches"                                                                                                                      | empty-state   | src/components/CommandMenu.tsx:220                                                                                                                    | Query with no hits                                                                                                             | none                                                      | same                                               | no†                                 | no               | no  |
| 164 | Profile action menu (avatar/banner actions)                                                                                                          | popover       | src/components/chat/SettingsAccountTab.tsx:419                                                                                                        | "…" on avatar/banner in the profile editor                                                                                     | none / createPortal (body portal variant)                 | same                                               | no                                  | no               | no  |
| 165 | Color field picker (display-name style colors)                                                                                                       | popover       | src/components/chat/SettingsAccountTab.tsx:798 (field :991)                                                                                           | Color swatch in the display-name style dialog                                                                                  | custom fixed+createPortal                                 | same                                               | no                                  | no               | no  |

### Voice & calls

| #   | View                                                                                            | Kind          | Component                                                                                                           | How reached                                                                                                          | Overlay primitive                     | Phone form                    | Fixture          | Being redesigned | WIP |
| --- | ----------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ----------------------------- | ---------------- | ---------------- | --- |
| 166 | Voice channel view (joined)                                                                     | page          | src/components/chat/VoiceChannelView.tsx:534                                                                        | Join a voice channel (ChatPageClient :1333 persistent, :1419 ephemeral)                                              | none                                  | same                          | yes              | no               | no  |
| 167 | Voice landing (pre-join, occupants)                                                             | page          | src/components/voice/VoiceLanding.tsx:26                                                                            | Select a voice channel you haven't joined (VoiceChannelView :493)                                                    | none                                  | same                          | yes              | no               | no  |
| 168 | Voice landing: "No one is currently in voice"                                                   | empty-state   | src/components/voice/VoiceLanding.tsx:73                                                                            | Empty channel                                                                                                        | none                                  | same                          | no               | no               | no  |
| 169 | Voice header (name, quality, stats, watchers, text-chat toggle)                                 | panel         | src/components/voice/VoiceHeader.tsx:51                                                                             | Top of the voice view                                                                                                | none                                  | same                          | yes              | no               | no  |
| 170 | Voice grid (tiles, focus/tray layout)                                                           | panel         | src/components/voice/VoiceGrid.tsx:390                                                                              | Voice view body, DM call, room                                                                                       | none                                  | same                          | yes              | no               | no  |
| 171 | Participant card (avatar / speaking / muted / deafened / camera / screen)                       | panel         | src/components/voice/ParticipantCard.tsx:115                                                                        | Each tile                                                                                                            | none                                  | same                          | yes              | no               | no  |
| 172 | Participant card: "Watch Stream" prompt                                                         | overlay-state | src/components/voice/ParticipantCard.tsx:224                                                                        | Remote screen share you aren't watching                                                                              | none                                  | same                          | yes (voice-live) | no               | no  |
| 173 | Participant card: "Preview paused" (own stream)                                                 | overlay-state | src/components/voice/ParticipantCard.tsx:216                                                                        | Your stream preview hidden                                                                                           | none                                  | same                          | no               | no               | no  |
| 174 | Stream loading indicator                                                                        | loading-state | src/components/voice/StreamLoadingIndicator.tsx:3                                                                   | Stream connecting (ParticipantCard :222)                                                                             | none                                  | same                          | no               | no               | no  |
| 175 | Sticker / GIF reactions overlay                                                                 | overlay-state | src/components/voice/StickerReactionsOverlay.tsx:167                                                                | Someone sends a voice reaction                                                                                       | none                                  | same                          | no               | no               | no  |
| 176 | Quality monitor (ping/quality text)                                                             | panel         | src/components/voice/QualityMonitor.tsx:50                                                                          | Tile and header badges                                                                                               | none                                  | same                          | no               | no               | no  |
| 177 | Stream watcher list (avatars)                                                                   | panel         | src/components/voice/StreamWatcherList.tsx:41                                                                       | Screen tiles, VoiceHeader, VoiceDashboard                                                                            | none                                  | same                          | no               | no               | no  |
| 178 | Streaming stats panel                                                                           | popover       | src/components/voice/StreamingStatsPanel.tsx:111 (content :158)                                                     | Stats button in VoiceHeader / RoomHeader                                                                             | none (absolute)                       | same                          | no               | no               | no  |
| 179 | Voice controls bar (mute, deafen, camera, share, reactions, activities, leave, fullscreen)      | panel         | src/components/voice/VoiceControls.tsx:112                                                                          | Bottom of the voice view and DM call                                                                                 | none                                  | same                          | yes              | no               | no  |
| 180 | Activity loading ("Loading Activity / Preparing the stage...")                                  | loading-state | src/components/chat/VoiceChannelView.tsx:559                                                                        | Launching Wordle or Warp Rush                                                                                        | none                                  | same                          | no               | no               | no  |
| 181 | Voice dashboard (UserPanel voice strip: channel, ping, controls, soundboard, reactions, stream) | panel         | src/components/chat/VoiceDashboard.tsx:324                                                                          | Connected to voice; desktop UserPanel (UserPanel :396)                                                               | none                                  | n/a                           | no               | no               | no  |
| 182 | Voice dashboard: stream settings menu                                                           | popover       | src/components/chat/VoiceDashboard.tsx:645                                                                          | "…" next to the stream controls                                                                                      | custom fixed click-catcher + absolute | n/a                           | no               | no               | no  |
| 183 | Noise reduction panel                                                                           | popover       | src/components/chat/NoiseReductionPanel.tsx:35 (portal host: src/components/chat/VoiceDashboard.tsx:533)            | Noise button in the voice dashboard; also a section of RoomSettingsModal                                             | custom fixed+createPortal             | n/a                           | no               | no               | no  |
| 184 | Spatial audio panel (drag avatars)                                                              | popover       | src/components/chat/SpatialAudioPanel.tsx:319                                                                       | Spatial audio button in the voice dashboard (VoiceDashboard :429)                                                    | custom fixed+createPortal             | n/a                           | no               | no               | no  |
| 185 | Voice details panel (Connection / Privacy tabs)                                                 | popover       | src/components/voice/VoiceDetailsPanel.tsx:376 (connection :481, privacy :606, portal :276)                         | Click "Voice Connected" / ping in the dashboard (VoiceDashboard :373)                                                | custom fixed+createPortal             | n/a                           | no               | no               | no  |
| 186 | Voice debug screen (transport, outbound, inbound charts)                                        | overlay-state | src/components/voice/VoiceDebugScreen.tsx:177                                                                       | "Debug" in the voice details panel (VoiceDetailsPanel :265)                                                          | custom fixed inset-0                  | full-page                     | no               | no               | no  |
| 187 | Voice debug screen: loading                                                                     | loading-state | src/components/voice/VoiceDebugScreen.tsx:157                                                                       | Before stats arrive                                                                                                  | custom fixed inset-0                  | full-page                     | no               | no               | no  |
| 188 | Camera settings (preview, device, backgrounds)                                                  | modal         | src/components/CameraSettingsModal.tsx:363                                                                          | Camera chevron in VoiceControls / VoiceDashboard, or the taskbar thumbnail button (DesktopThumbnailToolbarSync :340) | Dialog                                | same                          | no               | no               | no  |
| 189 | Floating stream preview (own stream / watched remote / paused)                                  | floating      | src/components/chat/FloatingStreamPreview.tsx:189                                                                   | Streaming or watching while you navigate away from the voice view (ChatPageClient :1517, :1550)                      | none (fixed draggable)                | same                          | no               | no               | no  |
| 190 | Floating soundboard manager (active effects list)                                               | floating      | src/components/chat/FloatingSoundboardManager.tsx:170 (list: src/components/chat/ActiveSoundboardEffectList.tsx:59) | Sounds playing in voice (VoiceDashboard :332)                                                                        | custom fixed+createPortal             | n/a                           | no               | no               | no  |
| 191 | Floating Listen Together player                                                                 | floating      | src/components/chat/FloatingListenTogetherPlayer.tsx:130                                                            | Listen Together playing in voice (VoiceDashboard :327)                                                               | custom fixed+createPortal             | n/a                           | no               | no               | no  |
| 192 | DM call region: ringing outgoing (cancel)                                                       | panel         | src/components/chat/DMCallRegion.tsx:672                                                                            | Start a call from the DM header (ChatArea :349)                                                                      | none                                  | same                          | no               | no               | yes |
| 193 | DM call region: ringing incoming (accept / accept with video / decline)                         | panel         | src/components/chat/DMCallRegion.tsx:690                                                                            | Incoming call while viewing that DM                                                                                  | none                                  | same                          | no               | no               | yes |
| 194 | DM call region: active lobby (avatars, join)                                                    | panel         | src/components/chat/DMCallRegion.tsx:483                                                                            | Call active, not joined to the SFU                                                                                   | none                                  | same                          | no               | no               | yes |
| 195 | DM call region: active video grid + controls                                                    | panel         | src/components/chat/DMCallRegion.tsx:448 (controls :639)                                                            | Joined call with video                                                                                               | none                                  | same                          | no               | no               | yes |
| 196 | DM call region: expanded / fullscreen                                                           | overlay-state | src/components/chat/DMCallRegion.tsx:434                                                                            | Expand toggle                                                                                                        | custom fixed inset-0                  | full-page                     | no               | no               | yes |
| 197 | Meeting room header                                                                             | panel         | src/components/RoomPageClient.tsx:365                                                                               | `/room/$slug` joined                                                                                                 | none                                  | same                          | no               | no               | no  |
| 198 | Meeting room controls bar                                                                       | panel         | src/components/RoomPageClient.tsx:188                                                                               | `/room/$slug` joined                                                                                                 | none                                  | same                          | no               | no               | no  |
| 199 | Meeting room temporary chat                                                                     | panel         | src/components/DemoRoomChatPanel.tsx:154                                                                            | Chat toggle in the room                                                                                              | none                                  | same                          | no               | no               | no  |
| 200 | Room settings (Voice / Camera / Appearance tabs)                                                | modal         | src/components/RoomSettingsModal.tsx:402                                                                            | Settings in the room controls (RoomPageClient :764)                                                                  | Dialog (custom fixed surface)         | same (md:hidden close button) | no               | no               | no  |

### Settings

| #   | View                                                                                | Kind          | Component                                                                                                                                                                | How reached                                                                                              | Overlay primitive         | Phone form                             | Fixture | Being redesigned | WIP |
| --- | ----------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------- | ------- | ---------------- | --- |
| 201 | User settings modal (nav + page + optional rail)                                    | modal         | src/components/chat/SettingsModal.tsx:674 (host: src/components/chat/SettingsHost.tsx:28)                                                                                | Gear in the UserPanel, MobileYouPage, or `openSettings()` deep links                                     | Dialog (custom surface)   | full-page (list then page, back steps) | yes     | no               | no  |
| 202 | Settings search: "No settings match"                                                | empty-state   | src/components/chat/SettingsModal.tsx:441 (page variant :610)                                                                                                            | Settings search query with no hits                                                                       | none                      | full-page                              | no      | no               | no  |
| 203 | Settings theme preview mode                                                         | overlay-state | src/components/chat/SettingsModal.tsx:709 (sidebar: src/components/chat/ThemePreviewSidebar.tsx:55)                                                                      | "Preview" in Appearance; the modal collapses to a side sheet over the live app                           | Dialog                    | unknown                                | no      | no               | no  |
| 204 | Settings > Account                                                                  | panel         | src/components/chat/settings/AccountPanel.tsx:388                                                                                                                        | Settings nav                                                                                             | none                      | full-page                              | yes     | no               | no  |
| 205 | Settings > Sessions                                                                 | panel         | src/components/chat/settings/SessionsPanel.tsx:155                                                                                                                       | Settings nav                                                                                             | none                      | full-page                              | yes     | no               | no  |
| 206 | Settings > Privacy (media filters, shared messages list)                            | panel         | src/components/chat/settings/PrivacyPanel.tsx:420 (shared rows :338)                                                                                                     | Settings nav                                                                                             | none                      | full-page                              | yes     | no               | no  |
| 207 | Settings > Voice & Video (devices, sensitivity meter, camera card)                  | panel         | src/components/chat/settings/VoiceVideoPanel.tsx:248 (meter: src/components/chat/InputSensitivityMeter.tsx:185, camera: src/components/chat/settings/CameraCard.tsx:420) | Settings nav                                                                                             | none                      | full-page                              | yes     | no               | no  |
| 208 | Settings > Soundboard (trigger rows, embedded picker)                               | panel         | src/components/chat/settings/SoundboardPanel.tsx:248                                                                                                                     | Settings nav                                                                                             | none                      | full-page                              | yes     | no               | no  |
| 209 | Settings > Keybinds                                                                 | panel         | src/components/chat/settings/KeybindsPanel.tsx:35                                                                                                                        | Settings nav                                                                                             | none                      | full-page                              | yes     | no               | no  |
| 210 | Settings > Appearance                                                               | panel         | src/components/chat/settings/AppearancePanel.tsx:191                                                                                                                     | Settings nav                                                                                             | none                      | full-page                              | yes     | no               | no  |
| 211 | Settings > Notifications                                                            | panel         | src/components/chat/settings/NotificationsPanel.tsx:61                                                                                                                   | Settings nav                                                                                             | none                      | full-page                              | yes     | no               | no  |
| 212 | Settings > Desktop (hardware acceleration, updates)                                 | panel         | src/components/chat/settings/DesktopPanel.tsx:246                                                                                                                        | Settings nav (desktop builds, or `&desktop=1` in the fixture)                                            | none                      | full-page                              | yes     | no               | no  |
| 213 | Settings rails (Profile / Voice + mic test / Appearance / Notifications preview)    | panel         | src/components/chat/settings/rails.tsx:64 (voice :182, appearance :245, notifications :290; mic test: src/components/chat/MicTestWidget.tsx:348)                         | Right rail when the modal is ≥840px; stacked under the page otherwise                                    | none                      | full-page (stacked)                    | yes     | no               | no  |
| 214 | Settings inline confirm strip / row error                                           | panel         | src/components/chat/settings/primitives.tsx:584 (row error :532)                                                                                                         | Destructive row actions (revoke session, delete, etc.)                                                   | none                      | full-page                              | no      | no               | no  |
| 215 | Profile editor (full-size)                                                          | modal         | src/components/chat/ProfileEditorModal.tsx:16 (nested in settings: src/components/chat/SettingsModal.tsx:776)                                                            | "Edit Profile" in the account popover (UserPanel :833) or Settings > Account                             | Dialog (custom surface)   | same (100vw-32 card)                   | no      | no               | no  |
| 216 | Profile editor body (avatar, banner, nameplate, colors, collectibles, live preview) | panel         | src/components/chat/SettingsAccountTab.tsx:2982                                                                                                                          | Inside the profile editor                                                                                | none                      | same                                   | no      | no               | no  |
| 217 | Display name style dialog                                                           | modal         | src/components/chat/SettingsAccountTab.tsx:1240                                                                                                                          | "Style" on the display name in the profile editor (:4656)                                                | custom fixed inset-0      | same                                   | no      | no               | no  |
| 218 | Avatar / banner picker (upload, GIF)                                                | modal         | src/components/chat/AvatarPickerModal.tsx:169                                                                                                                            | Change avatar or banner in the profile editor (:4619, :4631)                                             | Dialog (custom surface)   | same                                   | no      | no               | no  |
| 219 | Avatar frame editor (crop/position)                                                 | modal         | src/components/chat/AvatarFrameEditor.tsx:306                                                                                                                            | After picking an avatar image (:4643)                                                                    | custom fixed+createPortal | same                                   | no      | no               | no  |
| 220 | Server settings modal (sidebar + mobile header)                                     | modal         | src/components/chat/ServerSettingsModal.tsx:678 (sidebar :44)                                                                                                            | Server header dropdown "Server Settings" (ChatPageClient :1625)                                          | Dialog (custom surface)   | full-page                              | no      | no               | no  |
| 221 | Server settings > Overview                                                          | panel         | src/components/chat/ServerSettingsModal.tsx:220                                                                                                                          | Default tab                                                                                              | none                      | full-page                              | no      | no               | no  |
| 222 | Server settings > Roles                                                             | panel         | src/components/chat/RoleManagement.tsx:259                                                                                                                               | Roles tab                                                                                                | none                      | full-page                              | no      | no               | no  |
| 223 | Server settings > Bans (+ empty)                                                    | panel         | src/components/chat/ServerSettingsModal.tsx:136                                                                                                                          | Bans tab                                                                                                 | none                      | full-page                              | no      | no               | no  |
| 224 | Server settings > Invites (loading / empty / list with countdown)                   | panel         | src/components/chat/InvitesTab.tsx:261 (loading :469, empty :474)                                                                                                        | Invites tab                                                                                              | none                      | full-page                              | no      | no               | no  |
| 225 | Server settings > Audit log (loading / empty)                                       | panel         | src/components/chat/AuditLogTab.tsx:135 (loading :110, empty :123)                                                                                                       | Audit tab                                                                                                | none                      | full-page                              | no      | no               | no  |
| 226 | Channel settings modal (Overview / Permissions)                                     | modal         | src/components/chat/ChannelSettingsModal.tsx:127                                                                                                                         | Channel context "Edit Channel", or the gear in member-list details (ChannelSidebar :1137, ChatArea :499) | Dialog (custom surface)   | full-page                              | no      | no               | no  |
| 227 | Channel settings > Permissions (role/member overrides, empty)                       | panel         | src/components/chat/ChannelPermissionsTab.tsx:620 (sidebar :126, editor :304, empty :223)                                                                                | Permissions tab                                                                                          | none                      | full-page                              | no      | no               | no  |

### Activities & shop

| #   | View                                                                        | Kind          | Component                                                                     | How reached                                                                                       | Overlay primitive                    | Phone form     | Fixture | Being redesigned | WIP |
| --- | --------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------- | ------- | ---------------- | --- |
| 228 | Voice apps / Activities launcher (menu, activities tabs)                    | modal         | src/components/chat/VoiceAppsModal.tsx:184                                    | Activities button in VoiceControls or the dashboard (ChatPageClient :1600)                        | ResponsiveDialog                     | drawer         | no      | no               | no  |
| 229 | Wordle activity stage                                                       | page          | src/components/chat/WordleActivityStage.tsx:1223 (wrapper :572)               | Launch "Daily Wordle" from Activities; replaces the voice grid (VoiceChannelView :556)            | none                                 | same           | no      | no               | no  |
| 230 | Wordle: solved / missed reveal                                              | overlay-state | src/components/chat/WordleActivityStage.tsx:1391                              | Game completed                                                                                    | none                                 | same           | no      | no               | no  |
| 231 | Wordle: How to play                                                         | modal         | src/components/chat/WordleActivityStage.tsx:452                               | "?" in the Wordle header                                                                          | Dialog (custom surface)              | same           | no      | no               | no  |
| 232 | Wordle: hints                                                               | modal         | src/components/chat/WordleActivityStage.tsx:1508                              | Hints button                                                                                      | Dialog (custom surface)              | same           | no      | no               | no  |
| 233 | Wordle: settings                                                            | modal         | src/components/chat/WordleActivityStage.tsx:1641                              | Settings button                                                                                   | Dialog (custom surface)              | same           | no      | no               | no  |
| 234 | Warp Rush 3D activity stage                                                 | page          | src/components/chat/WarpRushActivityStage.tsx:1122                            | Launch "Warp Rush 3D" from Activities                                                             | none                                 | same           | no      | no               | no  |
| 235 | Warp Rush: crashed / failure                                                | error-state   | src/components/chat/WarpRushActivityStage.tsx:1386 (failure reason :1206)     | Crash or load failure                                                                             | none                                 | same           | no      | no               | no  |
| 236 | Soundboard picker (soundboard / radio / MyInstants / Listen Together views) | popover       | src/components/chat/SoundboardPicker.tsx:1353                                 | Soundboard button in the voice dashboard (VoiceDashboard :928); embedded in Settings > Soundboard | PickerSurface (+ createPortal scrim) | drawer (85dvh) | no      | no               | no  |
| 237 | Soundboard: favorites empty / MyInstants no results / radio no results      | empty-state   | src/components/chat/SoundboardPicker.tsx:1719 (MyInstants :2379, radio :2493) | Empty favorites or search                                                                         | none                                 | drawer         | no      | no               | no  |
| 238 | Listen Together panel (search, results, queue, history)                     | panel         | src/components/chat/ListenTogetherPanel.tsx:889                               | Listen Together view in the soundboard picker (SoundboardPicker :1568)                            | none (inside picker)                 | drawer         | no      | no               | no  |
| 239 | Listen Together: searching / "No results yet"                               | empty-state   | src/components/chat/ListenTogetherPanel.tsx:1118 (no results :1151)           | Search                                                                                            | none                                 | drawer         | no      | no               | no  |
| 240 | Listen Together: "Nothing is queued yet" / "Nothing has played"             | empty-state   | src/components/chat/ListenTogetherPanel.tsx:1404 (history :1466)              | Empty queue or history                                                                            | none                                 | drawer         | no      | no               | no  |
| 241 | Listen Together: playback error                                             | error-state   | src/components/chat/ListenTogetherPanel.tsx:1005                              | Search or playback error                                                                          | none                                 | drawer         | no      | no               | no  |
| 242 | Listen Together now-playing card                                            | panel         | src/components/chat/ListenTogetherNowPlayingCard.tsx:448                      | Top of the panel and inside the floating player                                                   | none                                 | drawer         | no      | no               | no  |
| 243 | Shop (collectibles storefront)                                              | page          | src/components/chat/ShopView.tsx:2017                                         | "Shop" in the DM sidebar (dmHomeView = shop, ChatPageClient :1403)                                | none                                 | same           | no      | yes              | no  |
| 244 | Shop: loading cards                                                         | loading-state | src/components/chat/ShopView.tsx:1462                                         | Catalog loading                                                                                   | none                                 | same           | no      | yes              | no  |
| 245 | Shop: collection banner / shop card                                         | panel         | src/components/chat/ShopView.tsx:924 (card :1338, preview :886)               | Shop grid                                                                                         | none                                 | same           | no      | yes              | no  |
| 246 | Shop: collectible detail                                                    | modal         | src/components/chat/ShopView.tsx:1011                                         | Click a shop card                                                                                 | Dialog (custom surface)              | same           | no      | yes              | no  |
| 247 | Collectibles catalog (pick effects/frames for your profile)                 | modal         | src/components/chat/CollectiblesCatalogModal.tsx:690                          | "Browse collectibles" in the profile editor (SettingsAccountTab :4679)                            | custom fixed+createPortal            | same           | no      | yes              | no  |
| 248 | Collectibles catalog: loading / "No collectibles found" / error             | empty-state   | src/components/chat/CollectiblesCatalogModal.tsx:792 (empty :796, error :784) | Fetch states                                                                                      | none                                 | same           | no      | yes              | no  |

### Mobile

| #   | View                                                               | Kind   | Component                                                                                          | How reached                                                                                                   | Overlay primitive         | Phone form | Fixture      | Being redesigned | WIP |
| --- | ------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------- | ------------ | ---------------- | --- |
| 249 | Mobile home surface (left drawer + tabs)                           | drawer | src/components/chat/MobileNavigationSheet.tsx:58                                                   | Phone: back/"Servers" button in ChatHeader; open by default with no conversation (ChatPageClient :1277)       | Drawer (left)             | drawer     | yes          | no               | no  |
| 250 | Mobile tab: Servers (rail + channel/DM sidebar)                    | panel  | src/components/chat/MobileNavigationSheet.tsx:76                                                   | Servers tab                                                                                                   | Drawer                    | drawer     | yes          | no               | no  |
| 251 | Mobile tab: Messages                                               | panel  | src/components/chat/mobile/MobileMessagesTab.tsx:33                                                | Messages tab                                                                                                  | Drawer                    | drawer     | yes          | no               | no  |
| 252 | Mobile tab: Notifications (inbox as a page)                        | panel  | src/components/chat/mobile/MobileNotificationsTab.tsx:17                                           | Notifications tab                                                                                             | Drawer                    | drawer     | yes          | no               | no  |
| 253 | Mobile tab: You (profile, status, mute/deafen, settings shortcuts) | panel  | src/components/chat/mobile/MobileYouPage.tsx:106                                                   | You tab                                                                                                       | Drawer                    | drawer     | yes          | no               | no  |
| 254 | Mobile bottom tab bar (badges, hides with the keyboard)            | panel  | src/components/chat/mobile/MobileTabBar.tsx:58                                                     | Bottom of the home drawer                                                                                     | none                      | same       | yes          | no               | no  |
| 255 | Mobile conversation view (ChatArea, phone layout)                  | page   | src/components/chat/ChatArea.tsx:268                                                               | Open a channel or DM on a phone (drawer closes)                                                               | none                      | full-page  | yes (mobile) | no               | no  |
| 256 | Mobile profile sheet (other user / self)                           | sheet  | src/components/chat/MobileProfileSheet.tsx:605 (banner :83, header :175, actions :269, cards :361) | Tap an avatar on a phone (UserProfilePopover :485, MemberList :713)                                           | Drawer (bottom)           | drawer     | yes          | no               | no  |
| 257 | Member list mobile header + invite button                          | panel  | src/components/chat/MemberList.tsx:742 (invite :982)                                               | Member list on a phone                                                                                        | none                      | full-page  | no           | no               | no  |
| 258 | Context action sheet (phone context menu)                          | sheet  | src/components/chat/ContextMenu.tsx:73 (primitive: src/components/ui/action-sheet.tsx:63)          | Long-press any context-menu target below md                                                                   | ActionSheet               | sheet      | yes          | no               | no  |
| 259 | Generic Drawer primitive (handle, snap, back button)               | drawer | src/components/ui/drawer.tsx:1                                                                     | Base of MobileNavigationSheet, MobileProfileSheet, ActionSheet, PickerSurface, and ResponsiveDialog on phones | Drawer                    | drawer     | yes          | yes              | no  |
| 260 | Picker surface (phone drawer for emoji / GIF / soundboard)         | sheet  | src/components/chat/PickerSurface.tsx:79 (desktop :118)                                            | Any composer picker on a phone                                                                                | PickerSurface → Drawer    | drawer     | no           | no               | no  |
| 261 | ResponsiveDialog phone drawer form                                 | sheet  | src/components/ui/responsive-dialog.tsx:64                                                         | Every ResponsiveDialog modal below md (13 call sites)                                                         | ResponsiveDialog → Drawer | drawer     | no           | no               | no  |

### System states

| #   | View                                                                       | Kind          | Component                                             | How reached                                                                                                | Overlay primitive         | Phone form | Fixture | Being redesigned | WIP |
| --- | -------------------------------------------------------------------------- | ------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------- | ---------- | ------- | ---------------- | --- |
| 262 | Splash screen (logo, bar, rotating tips)                                   | loading-state | src/components/SplashScreen.tsx:55                    | Router pendingComponent (\_\_root.tsx), sign-in loading, DesktopLogin resolving, desktop Suspense fallback | none                      | same       | yes     | no               | no  |
| 263 | Loading screen (shared shell: dither, logo, bar)                           | loading-state | src/components/ui/LoadingScreen.tsx:38                | Used by Splash, ConnectionOverlay, StandaloneUpdater                                                       | none                      | same       | yes     | no               | no  |
| 264 | Connection overlay: "Connecting..."                                        | overlay-state | src/components/chat/ConnectionOverlay.tsx:134         | First gateway connect in /chat (routes/chat.tsx)                                                           | custom fixed inset-0      | same       | yes     | no               | no  |
| 265 | Connection overlay: "Reconnecting..." / "attempt N" / "Still reconnecting" | overlay-state | src/components/chat/ConnectionOverlay.tsx:118         | Gateway drop after a connect                                                                               | custom fixed inset-0      | same       | no      | no               | no  |
| 266 | Connection overlay: "Connected!" fade-out                                  | overlay-state | src/components/chat/ConnectionOverlay.tsx:118         | Connection restored                                                                                        | custom fixed inset-0      | same       | no      | no               | no  |
| 267 | Standalone updater window (checking / downloading / installing / error)    | loading-state | src/components/StandaloneUpdater.tsx:204 (error :213) | Tauri updater window at launch (desktop/desktop-entry.tsx:50)                                              | none                      | n/a        | no      | no               | no  |
| 268 | Update checker toast (available / downloading / ready / error)             | floating      | src/components/UpdateChecker.tsx:124                  | Tauri desktop when an update exists (desktop/desktop-entry.tsx:56)                                         | none (fixed bottom-right) | n/a        | no      | no               | no  |
| 269 | Lazy Suspense fallbacks (null)                                             | loading-state | src/components/chat/ChatPageClient.tsx:1332           | Every lazy modal and voice view mounts with `fallback={null}` (no visible loading)                         | none                      | same       | no      | no               | yes |

Unclassified:

- src/components/chat/FriendListPanel.tsx:43 is not imported anywhere (dead; FriendsView renders its own list).
- src/components/chat/VoiceChannelStatusPreview.tsx:25 is not imported anywhere (dead).
- src/components/chat/OutgoingCallModal.tsx:104 is not imported (listed under Modals as unreachable).
- src/components/ui/sheet.tsx (Radix Sheet primitive) is not imported anywhere. No view uses `Sheet`.
- Non-visual managers (render null or only mount other views): ChatGateway.tsx, CallVoiceManager.tsx (ActiveCallSession), VoiceMediaManager.tsx, VoiceSoundboardManager.tsx, VoiceListenTogetherManager.tsx, DesktopThumbnailToolbarSync.tsx (renders only CameraSettingsModal), theme-provider.tsx.
- Fragments not listed as their own views: profile layers (ProfileSurfaceShell, ProfileAssetLayer, ProfileCollectiblesLayer, ProfileFrameLayer, UserNameplateLayer, ProfileDisplayName, ProfilePreviewPrimitives), avatars and badges (AvatarImage, MiniAvatar, UserStatusDot, UserPlatformIndicators, MentionBadge, HomeIcon, EmojiToken, InlineEmoji(Text), GifFavoriteButton, GifProviderBranding, AudioCompatibilityHint, SettingsSwitch, MessageInputPlaceholder, InputMentionOverlay, ReplyPreviewContent), auth/CopyMorphIcon, ThemeAwareSplashLogo, ui/DitherField, and the ui/\* primitives (button, IconButton, select, tabs, tooltip, badge, input, label, separator, safe-area-view).
- UiFixtures also has a `drawer-over-dialog` surface (Drawer stacked on a Dialog) that matches no single product view.
- Server-header dropdown entries "Server Boost", "Create Event", "App Directory", "Privacy Settings", and "Edit Per-server Profile" (ChannelSidebar.tsx:1459-1517): I couldn't confirm that any of them opens a view. They may be stubs.

**Count:** 269 views total; 67 with fixture=yes (9 more marked no† have an unlisted UiFixtures surface); 13 being redesigned; 14 WIP.
