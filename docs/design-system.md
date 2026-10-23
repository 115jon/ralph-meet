# Ralph Meet design system (Quiet Pro)

Canonical rules for every view in the app: web, Tauri desktop and Tauri mobile.
Derived from what the Quiet Pro pass already established in `src/styles.css`,
`src/components/ui/*` and the UI Lab decisions (Quiet Pro components, Phosphor
icons, Studio settings), then tightened where the code disagrees with itself.
Each rule is numbered and checkable; `scripts/audit-design-system.mjs` enforces
the ones a regex can see, and `docs/design-audit.md` holds the per-view findings.

Source of truth for values: `src/styles.css` (`:root`, `@theme inline`),
`src/components/ui/interaction.ts`, `src/components/ui/menu.ts`,
`src/components/ui/icon/tokens.ts`, `src/hooks/useMediaQuery.ts`.

Where a rule says "pick", the code was inconsistent and this document picks one
with a reason. Those picks are listed again in section 15.

---

## 1. Principles

1.1 **Flat and tonal.** Fills are tints mixed from the text colour
(`rm-tint-1/2/3`). One solid accent fill per view (`bg-primary`), one solid
danger fill per surface (Leave, delete-forever). Everything else is a tint, a
hairline, or bare.

1.2 **No shadow below the floating layer.** Panels, cards, rows and chrome sit
on surface colour with hairline borders. Shadows appear only on floating
surfaces (menus, popovers, dialogs, drawers, floating players).

1.3 **State is a weight change, not a colour change.** Icons switch
Bold -> Fill for active/on and Bold -> Fill-of-off-partner for muted. Colour is
added on top (`currentColor`), never used alone.

1.4 **4px grid, 8px rhythm.** Every inset, gap and chrome size is a multiple of
4; the rhythm between blocks is a multiple of 8.

1.5 **One phone breakpoint.** `md` (768px). Below it the app is a phone: one
column, drawers instead of dialogs, 44px targets, bottom tab bar. Above it the
app is desktop. Nothing else changes layout by width except the member list at
`lg` (1024).

1.6 **Motion is transform + opacity, ease-out, under 300ms.** Hover exists only
for fine pointers.

---

## 2. Spacing

2.1 **Scale.** Allowed Tailwind steps and what each is for. Arbitrary px lengths
must be on the 4px grid (1px and 2px hairlines excepted); prefer the step.

| step  | px  | role                                                                                                                                        |
| ----- | --- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `0.5` | 2   | optical nudge only (`mt-0.5` next to an avatar, `gap-0.5` icon+label in a tab)                                                              |
| `1`   | 4   | inline gap between an icon and its 11-12px label; padding inside a badge/kbd                                                                |
| `1.5` | 6   | gap inside a compact control (`xs`/`sm` buttons, tab icon+label); inset of a `p-1.5` toolbar                                                |
| `2`   | 8   | gap between controls in a row; menu panel inset (`p-1` is the menu exception, see 12.7); list-row inset on the cross axis (`py-1.5`/`py-2`) |
| `2.5` | 10  | leading-icon gap in menu rows (`gap-2.5`) and dense list rows                                                                               |
| `3`   | 12  | gap between a row's avatar and its text; inset of a dense card (`p-3`); horizontal inset of a sidebar list (`px-3`)                         |
| `4`   | 16  | **default inset** of panels, cards, drawers and phone pages (`p-4`, `px-4`); gap between cards (`gap-4`)                                    |
| `5`   | 20  | inset of settings cards above 560px container width (`@min-[560px]:px-5`) only                                                              |
| `6`   | 24  | dialog inset (`p-6`); section gap inside a page (`gap-6`, `mb-6`); horizontal inset of a wide content column (`px-6`)                       |
| `8`   | 32  | gap between page sections on desktop; empty-state top/bottom padding minimum                                                                |
| `10`  | 40  | - (reserve)                                                                                                                                 |
| `12`  | 48  | empty-state vertical padding (`py-12`)                                                                                                      |
| `16`  | 64  | hero/auth vertical rhythm only                                                                                                              |

Steps not listed (`0.75`, `1.25`, `3.5`, `7`, `9`, `11`, `14`, …) are not used.
`3.5` (14px) appears in settings rows (`py-3.5`) and some cards; it is the one
tolerated exception while settings rows are 14/16; everything new uses `3` or
`4`.

2.2 **Inset vs gap vs stack vs section.**

- **Inset** (padding of a container): phone page/panel/card/drawer `16`; dialog
  `24`; dense card/menu `12`/`4`; list row `px-2 py-1.5` (desktop nav) or
  `px-4 py-3` (phone list).
- **Gap** (between siblings in a row): `2` between controls, `3` between an
  avatar and text, `4` between cards.
- **Stack** (between blocks in a column): `2` label -> control, `3` title ->
  body, `4` card -> card, `6` section -> section.
- **Section** (between major areas): `8` on desktop, `6` on phone.

  2.3 **Group spacing is >= 2x inner spacing.** If rows inside a card are 8px
  apart, cards are at least 16px apart. Separator lines are the last resort
  (settings cards use `divide-y` inside one card; between cards use space).

  2.4 **Edges are shared.** Inside one panel every text block and control aligns
  to the same left edge: the panel inset (16). Rows that have a leading icon or
  avatar align the _icon_, not the text, to that edge; text alignment comes from
  a fixed icon column (`size-5`/`size-6` + `gap-3`).

  2.5 **No negative margins to undo a parent's padding** except
  `MENU_SEPARATOR`'s `-mx-1` inside a `p-1` menu and `-mx-4` for an edge-to-edge
  list inside a `px-4` drawer. Any other `-m*` is a finding.

---

## 3. Layout and breakpoints

3.1 **Breakpoints.** Exactly two: `md` 768 (phone -> desktop) and `lg` 1024
(desktop -> wide; member list auto-shows). Tailwind `sm:` (640), `xl:`, `2xl:`
are not used (the shadcn `sm:` defaults inside `ui/dialog.tsx` are migrated to
`md:` when touched). Component-level adaptation uses container queries
(`@min-[560px]:` in settings) not viewport queries.

3.2 **JS breakpoints** go through `useIsMobile()` / `isMobileViewport()` from
`src/hooks/useMediaQuery.ts`. `window.innerWidth < N` comparisons are not
allowed; clamping a popover to the viewport edge is fine.

3.3 **Desktop grid** (>= 768).

| region                              | width                         | notes                                                        |
| ----------------------------------- | ----------------------------- | ------------------------------------------------------------ |
| server rail                         | 72 (`--rm-size-rail`)         | 48px tiles, 8px between                                      |
| channel / DM sidebar                | 240                           | rail + sidebar = 312 (`w-[312px]`)                           |
| main column                         | flex                          | min-width 0                                                  |
| member list                         | 240                           | shows at `lg`, toggled below                                 |
| thread / pinned / search side panel | 360                           | overlays main below `lg`, docks at `lg`+                     |
| header                              | 48 (`--rm-size-header`)       | every main-column header, side-panel header and sheet header |
| composer                            | min 40, grows to 50% viewport | `px-4` on desktop, `px-2` on phone                           |
| voice dock (user panel)             | 52 + voice strip              | sits under the sidebar                                       |

3.4 **Viewport units.** Heights use `dvh` (`h-dvh`, `min-h-dvh`,
`max-h-[calc(100dvh-24px)]`). `vh`, `h-screen`, `min-h-screen` and `w-screen`
are not used: `vh` hides under phone toolbars and the keyboard, `w-screen`
includes the scrollbar and causes horizontal scroll on desktop.

3.5 **Phone layout** (< 768). One column. The home surface is the tab bar
(`MobileTabBar`, 56px + safe area) with Servers / Messages / Notifications /
You. A conversation fills the column with the header on top and the composer at
the bottom; the tab bar is gone inside a conversation. Side panels become full
height drawers (`direction="left"`/`"right"`) or bottom drawers.

3.6 **Safe areas.** Chrome that touches a screen edge pads with
`var(--safe-area-top|bottom|left|right, 0px)` (the Tauri shells write these on
`<html>`). Rules: top bar `pt-[var(--safe-area-top,0px)]`; bottom tab bar,
bottom drawers and the composer `pb-[max(16px,var(--safe-area-bottom,0px))]`
or `pb-[var(--safe-area-bottom,0px)]`; any `fixed inset-0` surface pads both.
`SafeAreaView` is the helper for a full page.

3.7 **Scroll.** Exactly one scroller per column: `flex min-h-0 flex-1
overflow-y-auto overscroll-contain`. Every flex ancestor between the viewport
and the scroller has `min-h-0`. Sticky headers set `scroll-padding-block-start`
to their height. Horizontal strips (reactions, tabs) are `overflow-x-auto
scrollbar-none` and must be swipeable on touch (no `touch-action: none`,
no pointer handlers that `preventDefault` on `touchstart`).

3.8 **Chrome never scrolls.** Headers, tab bars, composers and docks are
`shrink-0` siblings of the scroller, never inside it.

3.9 **Text containers size by `max-w`/`min-h`, never fixed `h`/`w`** (labels
grow in translation). `truncate` only with the full value reachable (tooltip,
detail view). Long-form text caps at `max-w-[62ch]`.

---

## 4. Type

4.1 **Scale.** Only the `text-ui-*` utilities (and the two display steps) set a
font size. Tailwind's `text-xs/sm/base/lg/xl/...` (12/14/16/18/20) and
`text-[Npx]` are not used: they land between the steps (14 vs 13/15) and break
the vertical rhythm.

| utility           | size / line | role                                                                                                     |
| ----------------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| `text-ui-2xs`     | 11 / 14     | eyebrow category labels (uppercase, `tracking-[0.08em]`, 600), count badges, tab-bar labels, kbd         |
| `text-ui-xs`      | 12 / 16     | timestamps, meta, captions, tooltip, menu group labels, helper text under a field                        |
| `text-ui-sm`      | 13 / 18     | controls (buttons, inputs on desktop, menu rows, tabs), secondary rows, descriptions, dialog description |
| `text-ui-base`    | 15 / 1.375  | message body, composer, primary row text (channel/DM/member rows), action-sheet rows                     |
| `text-ui-md`      | 16 / 22     | card titles, phone inputs (iOS zoom floor), sheet titles, phone row text                                 |
| `text-ui-lg`      | 18 / 24     | dialog and drawer titles                                                                                 |
| `text-ui-xl`      | 22 / 28     | page titles (Friends, settings panel heading, voice channel name on landing)                             |
| `text-ui-2xl`     | 28 / 32     | display numbers (device code, stats), empty-state title on wide screens                                  |
| `text-display`    | 36 / 1.05   | auth hero, marketing (Instrument Serif)                                                                  |
| `text-display-lg` | 44 / 1.02   | marketing only                                                                                           |

4.2 **Weights.** 400 body and descriptions; 500 every control, row label and
menu item (`font-medium`); 600 titles, selected tab, card headings
(`font-semibold`); 700 only the count badge and uppercase eyebrows. Nothing
lighter than 400 at any size.

4.3 **Roles by colour.** Primary text `text-rm-text`; secondary
`text-rm-text-secondary` (descriptions, subtitles, inactive tabs on phone);
muted `text-rm-text-muted` (meta, timestamps, placeholders, idle icons); ghost
`text-rm-text-ghost` (scrollbars, disabled decoration only, never text).

4.4 **Faces.** `font-ui` (Figtree) for the app; `font-display` (Instrument
Serif) for auth/marketing display only. The display face never appears inside
the chat shell.

4.5 **Wrapping.** Titles `text-balance`; descriptions `text-pretty`; URLs,
IDs and usernames `break-words` or `truncate`; labels, badges, timestamps
`whitespace-nowrap`. Changing numbers (timers, counts, ping) are
`tabular-nums`.

4.6 **Inputs on phones are 16px** (`text-ui-md` below `md`, `text-ui-sm` on
desktop) so iOS does not zoom.

4.7 **Uppercase only for eyebrows** (`text-ui-2xs font-semibold uppercase
tracking-[0.08em]`). No uppercase buttons, titles or tab labels.

---

## 5. Radius

5.1 **Scale** (`@theme` in `styles.css`). Only these tokens; `rounded-[Npx]`
is not used.

| token          | px  | use                                                                                |
| -------------- | --- | ---------------------------------------------------------------------------------- |
| `rounded-xs`   | 4   | kbd, inline code, tiny chips                                                       |
| `rounded-sm`   | 6   | controls under 32px (`xs`/`sm` buttons, badges, tooltip), nested inside an 8px row |
| `rounded-md`   | 8   | controls at 32-40px (buttons, inputs, icon buttons, menu rows, nav rows)           |
| `rounded-lg`   | 12  | cards, menus/popovers, composer, attachments, 48px icon buttons, server rail tiles |
| `rounded-xl`   | 16  | dialogs, floating players, image/embeds inside messages                            |
| `rounded-2xl`  | 20  | bottom drawers (top corners), phone full-page sheets                               |
| `rounded-3xl`  | 24  | - (reserve; the auth card is `xl`)                                                 |
| `rounded-full` | -   | avatars, status dots, count badges, pills, the drawer handle                       |

5.2 **Concentric corners.** Nested surfaces with an even inset use
`outer = inner + padding`: a `p-4` card (`rounded-lg` 12) holds `rounded-xs`
(4) children; a `p-1` menu (`rounded-lg`) holds `rounded-md` rows (8 = 12 - 4);
a `p-6` dialog (`rounded-xl` 16) holds `rounded-md`/`rounded-lg` blocks. Past
24px of padding, pick each radius by its own role.

5.3 **The menu panel is `rounded-lg`** (12). `MENU_PANEL` in `ui/menu.ts` says
`rounded-[10px]`; 10 is off the scale and the lab spec was 8/12/16. Pick 12 so
the menu matches cards and popovers; its `p-1` rows stay `rounded-md`.

---

## 6. Elevation, borders, scrim

6.1 **Shadow ramp.** Three tokens, mapped so the Tailwind classes resolve to
them: `--rm-shadow-1` (`shadow-sm`/`shadow-md`): floating players, drag
previews, stream thumbnails. `--rm-shadow-2` (`shadow-lg`/`shadow-xl`): menus,
popovers, tooltips (tooltip is inverted and needs none). `--rm-shadow-3`
(`shadow-2xl`): dialogs, drawers, side sheets. No hand-rolled `shadow-[...]`.
The only inset shadow is the `<kbd>` bottom hairline.

6.2 **Borders for structure, shadows for depth.** Hairline `border-rm-border`
(6-8% alpha) separates chrome regions (header bottom, sidebar edge, card edge,
divider rows). `border-rm-border-strong` (14-18%) is for interactive outlines
(outline buttons, drawer handle, confirm strips, field edges that need 3:1 via
`border-rm-field-edge`). Never a border _and_ a shadow on a non-floating
surface.

6.3 **No blur.** `styles.css` neutralises `backdrop-blur*` and `blur*` globally
(`filter: none !important`). Any `backdrop-blur-*` class in a component is dead
weight and is removed; scrims and overlays rely on `bg-rm-scrim` and solid
surfaces.

6.4 **Surface levels** (background roles, see 7.2). Base page
`bg-rm-bg-primary`; sidebar column `bg-rm-bg-secondary`/`bg-rm-sidebar`; cards
and panels on the page `bg-rm-bg-surface`; floating surfaces `bg-rm-bg-surface
dark:bg-rm-bg-elevated`; rail `bg-rm-server-bar`. A surface never uses the same
token as its parent (a card on `bg-rm-bg-primary` is `bg-rm-bg-surface` or a
tint, not `bg-rm-bg-primary`).

6.5 **Scrim.** `bg-rm-scrim` (60% black dark / 40% light) on every modal
overlay, drawer overlay and sheet overlay. Nothing else darkens the page. Media
overlays (gradients over images, control bars on video) use
`bg-black/60`-class values because they sit on photos, not on theme surfaces;
that is the one place pure black/white alpha is allowed.

---

## 7. Colour roles

7.1 **Tokens only.** No hex, `rgb()`, `oklch()`, Tailwind palette hues
(`amber-400`, `slate-300`, `emerald-500`, …) or `text-white` on theme surfaces
in a component. If a role is missing, add a `--rm-*` token in `styles.css` for
every theme (light, dark, miku-light/dark, spiderman-light/dark) and map it in
`@theme inline`. Exceptions, listed in the checker allowlist: third-party brand
marks, theme swatches that render their own palette, and media overlays (6.5).

7.2 **Role table.**

| role                  | token (utility)                                                               | notes                                                                |
| --------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| page                  | `bg-rm-bg-primary`                                                            | the chat column, settings page                                       |
| secondary column      | `bg-rm-bg-secondary`, `bg-rm-sidebar`                                         | sidebar, tab bar                                                     |
| rail                  | `bg-rm-server-bar`                                                            | server rail; tiles `bg-rm-rail-item`                                 |
| surface               | `bg-rm-bg-surface`                                                            | cards, panels, inputs' container, light-theme floating               |
| elevated              | `bg-rm-bg-elevated`                                                           | dark-theme floating surfaces (`dark:bg-rm-bg-elevated`)              |
| tint 1/2/3            | `bg-rm-tint-1/2/3`                                                            | 6/10/16% of text colour: secondary fill, hover/selected row, pressed |
| hairline              | `border-rm-border`                                                            | structure                                                            |
| strong line           | `border-rm-border-strong`                                                     | interactive outline, handle                                          |
| field edge            | `border-rm-field-edge`                                                        | inputs (>= 3:1)                                                      |
| text 1/2/3            | `text-rm-text`, `-secondary`, `-muted`                                        | 100 / 70 / 54%                                                       |
| ghost                 | `text-rm-text-ghost`                                                          | scrollbar thumb, decoration only                                     |
| accent solid          | `bg-primary text-primary-foreground` (`bg-rm-accent-solid text-rm-on-accent`) | the one solid fill                                                   |
| accent ink            | `text-rm-accent-ink`                                                          | accent as text or line (links, active indicator, focus ring)         |
| accent tint           | `bg-rm-accent-tint`                                                           | accent badge, search target, selected chip                           |
| danger solid          | `bg-rm-danger text-rm-on-danger`                                              | Leave / irreversible only                                            |
| danger ink / tint     | `text-rm-danger-ink`, `bg-rm-danger-tint`                                     | destructive buttons and menu rows, errors                            |
| success / warning ink | `text-rm-success-ink`, `text-rm-warning-ink`                                  | status text; pair with an icon                                       |
| status dots           | `--rm-status-online/idle/dnd/offline`                                         | presence only                                                        |
| badge                 | `badge-count` utility (`--rm-badge`)                                          | unread counts; the one red fill that is not danger                   |
| scrim                 | `bg-rm-scrim`                                                                 | overlays                                                             |
| focus                 | `--rm-focus` ring, 2px, offset 2                                              | global `:focus-visible`; never `outline-none` without it             |
| selection             | `--rm-selection`                                                              | text selection                                                       |

7.3 **Semantic hues have one meaning each.** Red = danger/unread, green =
online/success, amber = idle/warning, accent = primary/selected/link. A status
colour never decorates; a decorative colour never signals. Activity stages
(Wordle, WarpRush) that need their own palette get `--rm-activity-*` tokens
rather than palette classes.

7.4 **Contrast floors** (measured per theme in `styles.css` comments): text and
icons >= 4.5:1 on the surface they render on; field edges, focus rings and
icon-only control glyphs >= 3:1. Text on a tint is measured against the tint
over its ground.

7.5 **Light and dark are the same layout.** A component never changes radius,
spacing or structure by theme; only `dark:` colour tokens change, and only
where the role table needs a second value (`dark:bg-rm-bg-elevated`).

---

## 8. Icons

8.1 **One icon component.** `<Icon name state size />` from
`@/components/ui/icon` (Phosphor Bold idle, Fill active/off). No `lucide-react`,
no inline SVG icons in components (brand marks and illustrations excepted). New
concepts are added to `mapping.ts` and generated.

8.2 **Sizes** (`ICON_SIZE`). The step is chosen by the text or target beside it,
never ad hoc:

| step          | px      | where                                                              |
| ------------- | ------- | ------------------------------------------------------------------ |
| `xs`          | 12      | chevrons, inline status inside 11-12px text                        |
| `sm`          | 16      | menu rows, inline actions, badges, 13px controls, dialog close     |
| `md`          | 18      | channel rows, settings nav, 15px row text (default)                |
| `lg`          | 20      | headers, message hover bar, composer, 32-40px icon buttons         |
| `xl`          | 24      | server rail, voice dock, tab bar, 44-48px targets                  |
| `2xl` / `3xl` | 32 / 48 | empty-state and placeholder illustrations only, never in a control |

8.3 **IconButton** sizes carry their icon: `xs` 24 -> `sm`, `sm` 32 -> `lg`,
`md` 40 -> `lg`, `lg` 48 -> `xl`. Don't pass a different `iconSize` without a
reason in a comment.

8.4 **State.** `state="active"` for on/selected/open, `state="off"` for
muted/deafened/hidden. Never two different glyphs for one concept's on/off.

8.5 **Icons are decorative by default** (`aria-hidden`); the control names
itself. A standalone meaningful glyph passes `label`.

---

## 9. Interaction and touch

9.1 **Targets.** Every pressable gets `HIT` (44x44 on coarse pointers, via the
`::before` extension) or a real `min-h-11`. Visual sizes: 24 (`xs`), 28
(`sm`), 32 (default), 40 (`lg`), 48 (rail/dock). Phone list rows are >= 48;
menu rows 32 desktop / 44 coarse (`pointer-coarse:min-h-11`).

9.2 **Press.** `PRESS` from `interaction.ts`: `scale(0.97)` over 150ms
ease-out, hover/press overlay in `currentColor` at 8/14%, disabled never
scales. No `active:scale-95`, no `whileTap` below 0.96.

9.3 **Hover only on fine pointers.** `pointer-fine:hover:` and
`pointer-fine:group-hover:`; a bare `hover:` or `group-hover:` is a finding
(it latches after a tap). Hover changes colour/opacity only (<= 150ms); it
never moves or resizes. Actions revealed on hover (message hover bar) are
always reachable another way on touch (long-press action sheet).

9.4 **Focus.** Global 2px `--rm-focus` ring with 2px offset on
`:focus-visible`; fields use offset 0. Components use `outline-none` only
because the global rule restores it; never `focus:outline-none` with no ring.

9.5 **Long press** (`useLongPress`) opens the action sheet on touch where
right-click opens a context menu on desktop. The item model is shared.

9.6 **Keyboard-initiated actions do not animate** (command menu open/close,
tab switch via arrows).

9.7 **Disabled** is `opacity-45` + `cursor-not-allowed` (`DISABLED`), never a
different colour set.

---

## 10. Motion

10.1 **Tokens.** `--rm-ease-out: cubic-bezier(0.23,1,0.32,1)` (enter, hover,
press), `--rm-ease-in-out: cubic-bezier(0.77,0,0.175,1)` (on-screen movement),
`--rm-ease-drawer: cubic-bezier(0.32,0.72,0,1)` (drawers). Durations
`--rm-dur-1` 120 (press/hover), `--rm-dur-2` 180 (menus, popovers, tooltip
125), `--rm-dur-3` 240 (dialogs), drawers 280. Hard cap 300ms. `--rm-dur-4` is
declared as 320 and should be reset to 280 (the vaul override already uses
280); nothing may use `duration-500`/`700`/`1000` except loaders and the
reduced-motion spinner. `ease-in` is never used.

10.2 **Only transform and opacity animate.** Never `transition-all`; use
`transition-ui` (named properties, house curve, 180ms), `transition-colors`,
`transition-opacity` or `transition-transform`. Height/width/padding never
animate; use `clip-path` or layout-neutral reveals. Framer Motion uses
`transform` strings or `scale`/`opacity`, `bounce: 0`.

10.3 **Enter / exit.** Enter from `opacity-0 scale-[0.97]` (dialogs, tooltip,
popovers) or `translateY(100%)` (drawers); never from `scale(0)`. Exits are
faster than enters (dialog 150 out / 200 in, `animate-out` 120 by default).
Popovers scale from their trigger (`origin-(--radix-*-transform-origin)`);
modals stay centred.

10.4 **Frequency decides.** Hover and row highlight are instant or <= 150ms.
Menus 180. Dialogs/drawers 240-280. Loaders may loop. Stagger (30-80ms) only on
first-time or rare surfaces (empty state, auth).

10.5 **Reduced motion.** `styles.css` strips travel from `animate-in/out` and
stops decorative loops under `prefers-reduced-motion`. Component-level motion
(framer, keyframes) must also gate behind `motion-reduce:` or
`useReducedMotion()` and fall back to an opacity fade.

10.6 **Theme switch suppresses transitions** (`disableTransitionOnChange` in
the theme provider) so colours do not smear.

---

## 11. Layers (z-index)

11.1 **Ladder.** Only these values; `z-[N]` and in-between numbers (5, 15, 40,
90, 150, 1100…) are not used.

| z     | layer           | examples                                                                         |
| ----- | --------------- | -------------------------------------------------------------------------------- |
| `0`   | content         | messages, grid tiles                                                             |
| `10`  | in-panel raised | sticky date separators, in-list headers, unread banner, badges over avatars      |
| `20`  | chrome          | chat header, voice dock, composer, tab bar, side-panel headers                   |
| `30`  | floating in-app | floating stream preview, listen-together player, soundboard window, drag overlay |
| `50`  | modal           | scrim + dialog, drawer, sheet, popover, command menu                             |
| `60`  | modal-stacked   | pickers and selects opened from a dialog, nested drawer                          |
| `70`  | menus           | context menus, action sheet over a modal                                         |
| `80`  | transient       | tooltips, toasts                                                                 |
| `100` | system          | connection overlay, splash, updater, incoming-call                               |

11.2 Portals: every `z-50`+ surface is portalled to `body`; nothing inside a
panel sets `z-50`+.

---

## 12. Anatomy

Exact paddings per surface. "Inset" is the padding of the surface; "row" is a
list item inside it.

12.1 **Page (desktop main column).** Header 48 (`h-12`, `px-4`, `border-b
border-rm-border`, title `text-ui-md font-semibold`, icon buttons `size-8` with
`lg` icons, `gap-2`). Body is the scroller (3.7). Content columns cap at
`max-w-[720px] mx-auto` for prose (settings, friends) and full width for chat.

12.2 **Phone page.** Header 48 + safe-area top; `px-4`; back/menu button `size-10`
(`md` IconButton) at the leading edge; title `text-ui-md font-semibold
truncate`. Body `px-4` for forms and cards, `px-0` for edge-to-edge lists.
Bottom chrome adds safe-area bottom.

12.3 **Sidebar list (channels, DMs, members).** List inset `px-2 py-2`; row
`h-8 rounded-md px-2 gap-2.5 text-ui-base font-medium` on desktop; phone rows
`min-h-11 px-3`. Icon `md` (18) in a fixed `size-5` slot. Selected row
`bg-rm-tint-2 text-rm-text`; hover `pointer-fine:hover:bg-rm-tint-1`; unread
`text-rm-text font-semibold` + 2px left pill; mention count `badge-count`.
Category header: `text-ui-2xs uppercase tracking-[0.08em] font-semibold
text-rm-text-muted px-2 pt-4 pb-1` (first category `pt-2`).

12.4 **Phone list row (friends, DMs, settings nav, you page).** `min-h-12
px-4 gap-3`; avatar 40; primary `text-ui-base font-medium`; secondary
`text-ui-xs text-rm-text-secondary`; trailing chevron `xs` muted. Rows divide
with `divide-y divide-rm-border` inside a `rounded-lg bg-rm-tint-1` group
(action-sheet pattern) or sit edge-to-edge with no divider.

12.5 **Card.** `rounded-lg border border-rm-border bg-rm-bg-surface p-4`
(dense variant `p-3`; settings card has its own 16/20 header + row recipe,
12.6). Title `text-ui-md font-semibold`; description `mt-1 text-ui-sm
text-rm-text-secondary max-w-[62ch] text-pretty`; stack `gap-3`. Cards never
carry a shadow. Cards in a list are `gap-4` apart. Pick: `p-4` is the one card
inset (the code has `p-3`, `p-3.5`, `p-4`, `p-5`, `p-6` on `rounded-xl`
cards); `p-6` is reserved for dialogs, `p-3` for dense media/attachment cards.

12.6 **Settings card and row** (`settings/primitives.tsx`, the Studio
reference). Card header `px-4 pt-4 pb-1` (`px-5` above 560 container width),
title `text-ui-md font-semibold`, description `text-ui-sm text-rm-text-secondary`.
Rows `px-4 py-3.5` with `divide-y`; label `text-ui-sm font-medium`,
description `mt-0.5 text-ui-sm text-rm-text-secondary max-w-[56ch]`; control
trailing (`gap-x-6`), stacks under the text below 560; selects `h-9 w-[260px]`.
Every other "settings-like" surface (server settings, channel settings, room
settings, profile editor) adopts this recipe.

12.7 **Menu / popover.** `MENU_PANEL`: `rounded-lg border border-rm-border
bg-rm-bg-surface dark:bg-rm-bg-elevated p-1 shadow-lg`, max-width 280 (menus)
or 360 (rich popovers), rows `MENU_ITEM` (`min-h-8 px-2 py-1.5 gap-2.5
rounded-md text-ui-sm font-medium`, `pointer-coarse:min-h-11`), labels
`MENU_LABEL`, separators `MENU_SEPARATOR`. Rich popovers (profile, account)
use the same panel with a `p-4` body.

12.8 **Dialog** (`ui/dialog.tsx`). `rounded-xl border border-rm-border
bg-rm-bg-surface dark:bg-rm-bg-elevated p-6 gap-4 shadow-2xl`, width
`max-w-[calc(100%-2rem)]` then one of: confirm `md:max-w-sm` (384), form
`md:max-w-md` (448), content `md:max-w-lg` (512, default), workbench
`md:w-[min(1120px,calc(100vw-32px))] md:h-[min(820px,calc(100dvh-32px))]`
(settings, pickers). Header `gap-2`: title `text-ui-lg font-semibold
text-balance`, description `text-ui-sm text-rm-text-secondary`. Footer:
buttons right-aligned, `gap-2`, primary last; on phone the footer is a column
of full-width `min-h-11` buttons (ResponsiveDialog does this). Close button
`size-8` top-right (`top-3 right-3`) with `sm` icon. Scrolling body:
`min-h-0 overflow-y-auto overscroll-contain -mx-6 px-6` so the scrollbar sits
at the edge.

12.9 **Drawer (bottom)** (`ui/drawer.tsx`). `rounded-t-2xl`, handle 36x4,
`max-h-[calc(100dvh-24px)]`, `pb-[max(16px,var(--safe-area-bottom))]`. Header
`px-4 pt-2 pb-3 gap-1`, title `text-ui-lg font-semibold`; body `px-4 gap-4`;
footer `px-4 pt-3 gap-2` with full-width `min-h-11` buttons. Lists inside a
drawer go edge-to-edge with `-mx-4` or use the action-sheet group
(`mx-3 rounded-xl bg-rm-tint-1`, rows `min-h-12 px-4 text-ui-base`).

12.10 **Side sheet** (`ui/sheet.tsx`, desktop only; phones use a Drawer with
`direction`). Width 360 (`md:max-w-sm` -> 384 today, pick 360 to match side
panels), header `h-12 px-4 border-b`, body `px-4 py-4` scroller, no footer.

12.11 **Composer.** `rounded-lg border border-rm-border bg-rm-bg-elevated`,
inner `px-3 py-2.5`, text `text-ui-base` (`text-ui-md` on phone), attach
button `size-8` leading, action icons `lg` trailing, `gap-2`. Outer `px-4
pb-4` desktop / `px-2 pb-2` + safe area phone.

12.12 **Message row.** `px-4 py-0.5` with `pt-4` on a group start; avatar 40
(`size-10`) in a `w-14` column (16 inset + 40 + 16 gap -> text starts at 72);
name `text-ui-base font-medium`, timestamp `text-ui-xs text-rm-text-muted
ml-2`, body `text-ui-base`; compact continuation rows show the time in the
avatar column on hover. Hover bar: `IconButton xs` group, `rounded-md
bg-rm-bg-surface border border-rm-border shadow-sm`, top-right `-mt-4 mr-4`.
Attachments and embeds `mt-2 rounded-xl max-w-[520px]`.

12.13 **Voice tiles.** Grid gap `gap-2` (phone) / `gap-3` (desktop), tile
`rounded-xl bg-rm-bg-surface` (speaking ring 2px `--rm-success`), name chip
bottom-left `badge`-like `rounded-sm px-1.5 text-ui-xs` over a `bg-black/60`
media overlay. Dock: 48px icon buttons `gap-2`, muted = `bg-rm-danger-tint
text-rm-danger-ink` with `state="off"` glyph, Leave = `variant="danger"`.

12.14 **Tab bar (phone).** `h-14` + safe-area, 4 equal cells, icon `xl` +
`text-ui-2xs` label, active `text-rm-text` + Fill glyph + `font-semibold`,
inactive `text-rm-text-muted`.

12.15 **Auth pages.** Split layout at `md`; card `rounded-xl border p-6 max-w-[420px]`
on `bg-rm-bg-primary`; display face only in the art panel.

---

## 13. Component usage rules

13.1 **Which overlay.**

| need                                                       | desktop                                           | phone (< md)                                        | component                                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| confirm / short form / single task                         | centred dialog                                    | bottom drawer                                       | `ResponsiveDialog` (always; plain `Dialog` only for workbench dialogs that have their own phone layout) |
| workbench (settings, server settings, pickers with tabs)   | large dialog (12.8 workbench)                     | full-screen page with header + back                 | `Dialog` + `DialogSurface` with `md:` sizing, or `PickerSurface`                                        |
| navigation / profile / long list on phone                  | n/a (inline panel)                                | drawer (`direction="left"` nav, bottom for profile) | `Drawer`                                                                                                |
| side panel over content (search, thread, pins)             | docked column at `lg`, `Sheet` side="right" below | left/right `Drawer` or full page                    | `Sheet` desktop, `Drawer` phone                                                                         |
| context actions                                            | `ContextMenu` popover (12.7)                      | `ActionSheet`                                       | shared item model, `useContextMenu` / `useLongPress`                                                    |
| anchored picker / menu (emoji, gif, audio device, account) | popover (`MENU_PANEL`)                            | bottom drawer                                       | `PickerSurface` or `ResponsiveDialog`                                                                   |
| transient hint                                             | tooltip (inverted)                                | none (no hover)                                     | `Tooltip`; never on touch-only surfaces                                                                 |
| system state (connection, call)                            | `z-100` overlay                                   | same                                                | `ConnectionOverlay`, `IncomingCallModal`                                                                |

Hand-rolled `fixed inset-0` + `createPortal` modals are migrated to one of the
above; a component may not implement its own scrim, focus trap or back-button
handling.

13.2 **Buttons.** `Button` variants: `default` (the one solid), `secondary`
(tint), `outline`, `ghost`, `destructive` (red tint), `danger` (solid red,
irreversible only), `link`. Sizes `xs` 24 / `sm` 28 / default 32 / `lg` 40;
icon-only via `IconButton`. One `default` per view; a dialog footer has
exactly one.

13.3 **Lists.** Rows are `<button>` or `<a>` (never a `div` with `onClick`),
full-width, `rounded-md`, with `PRESS`-style feedback and the tint selected
state. Virtualised lists keep row height on the 4px grid (32/40/48/56).

13.4 **Forms.** `Label` (13px/500) above the field, `gap-2`; helper or error
below at `text-ui-xs` (`text-rm-danger-ink` for errors, `aria-invalid` on the
field); fields `h-9` desktop / `min-h-11` phone; one primary action per form.

13.5 **Tabs.** `Tabs` (underline, text-colour indicator). Phone tab bar is the
`MobileTabBar`. No pill/segmented tab styles elsewhere; segmented choice uses
`RadioList`.

13.6 **Badges.** `Badge` tints only; counts use `badge-count`. Never a solid
accent badge.

13.7 **Tooltips** only on icon-only controls and truncated values; never
restyled.

---

## 14. States

14.1 **Empty state.** Centred in the scroller: illustration `Icon size="3xl"`
(`2xl` on phone) in `text-rm-text-muted`; title `text-ui-md font-semibold`
(`text-ui-lg` for a whole-page empty); body `text-ui-sm text-rm-text-secondary
max-w-[36ch] text-pretty text-center`; one action (`Button` default or
secondary); stack `gap-3`, padding `py-12 px-6`. Never a border or card around
it.

14.2 **Loading.** Inline: `Spinner` (`size-4` in controls, `size-6` in
panels) with `sr-only` "Loading". Lists: skeleton rows `bg-rm-tint-1
rounded-md animate-pulse` at the real row height (reduced motion stops the
pulse). Whole page: `LoadingScreen` / `SplashScreen` (`rm-breathe`,
`rm-loading-bar`). Buttons use `loading` (keeps width).

14.3 **Error.** Inline strip `rounded-md bg-rm-danger-tint px-3 py-2 text-ui-sm
text-rm-danger-ink` (`RowError`) with an icon `sm`; field errors per 13.4;
whole-view error uses the empty-state anatomy with the danger ink title and a
retry button. Toasts are `z-80`, bottom-centre on phone, bottom-right on
desktop, 4s.

14.4 **Offline / reconnecting.** `ConnectionOverlay` at `z-100`; nothing else
blocks input.

14.5 **Selected / active / on.** Tint fill + Fill icon + 600 weight; never a
colour-only change.

---

## 15. Picks made where the code disagreed

| topic            | found                                                                         | pick                                                                   | why                                                                                 |
| ---------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| card inset       | `p-3`, `p-3.5`, `p-4`, `p-5`, `p-6` on `rounded-xl` cards                     | `p-4` (`rounded-lg`); `p-6` only for dialogs; `p-3` dense media        | matches the drawer/page inset and the settings card; 16+12 keeps concentric corners |
| card radius      | `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-[10px]`, `rounded-[24px]` | `rounded-lg` cards, `rounded-xl` dialogs/embeds, `rounded-2xl` drawers | one radius per elevation tier (styles.css comment)                                  |
| menu radius      | `rounded-[10px]` (`menu.ts`), 10x elsewhere                                   | `rounded-lg` 12                                                        | off-scale value; lab spec 8/12/16                                                   |
| text sizes       | 631 Tailwind `text-*`, 115 `text-[Npx]`, `text-ui-*` elsewhere                | `text-ui-*` only                                                       | 14px (`text-sm`) is not on the scale; 13/15 are                                     |
| hover gating     | 593 `pointer-fine:hover`, 353 bare `hover:`/`group-hover:`                    | `pointer-fine:` everywhere                                             | tap latches hover on touch                                                          |
| row height       | 32 / 36 / 40 / 44 / 48 mixed                                                  | 32 desktop nav, 44 phone nav, 48 phone list, 56 tab bar                | 4px grid; HIT covers coarse targets on 32                                           |
| side panel width | 320 / 360 / 384 (`max-w-sm`)                                                  | 360                                                                    | fits 390 phones as a drawer with 30px of scrim; divides into the 1280 layout        |
| `--rm-dur-4`     | 320ms                                                                         | 280ms                                                                  | cap is 300; drawers already run 280                                                 |
| breakpoints      | `sm:` in dialogs, `lg:` member list, `md` elsewhere                           | `md` + `lg` only                                                       | one phone breakpoint; `sm` (640) splits phones                                      |
| z-index          | 0/5/10/15/20/30/40/50/60/70/80/90/100/150 + `z-[1..1200]`                     | ladder in 11.1                                                         | arbitrary values fight each other across portals                                    |
| shadows          | 165 hand-rolled `shadow-[...]`                                                | 3 tokens                                                               | elevation reads as one system; themes set alpha                                     |
| blur             | 158 `backdrop-blur-*` (neutralised)                                           | remove                                                                 | dead classes mislead the next reader                                                |
| phone inputs     | `text-sm` (14) and `text-base` (16)                                           | `text-ui-md` below `md`                                                | iOS zoom floor                                                                      |

---

## 16. Checking

`node scripts/audit-design-system.mjs` reports the regex-visible rules (2.1,
3.1, 3.2, 3.4, 4.1, 5.1, 6.1, 6.3, 7.1, 8.1, 9.2, 9.3, 10.1, 10.2, 11.1) per
file and in total; `--list` prints every finding; exceptions live in
`scripts/audit-design-system.allow.json` (with a reason) or inline as
`ds-allow:<rule>`. Rules that need a browser (targets, overflow, scroll, safe
areas, contrast on rendered pairs, states) are checked per view in
`docs/design-audit.md` with the fixtures at `/ui-fixtures?surface=…&theme=…`.
