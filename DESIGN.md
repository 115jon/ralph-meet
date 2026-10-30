---
name: Ralph Meet
description: A black anodised panel with white silkscreen and coloured LEDs; one live tree of who is in the call and who is talking.
colors:
  ply-0: "#000000"
  ply-1: "#0b0b0d"
  ply-2: "#141417"
  ply-3: "#1b1b1f"
  ply-4: "#232328"
  ink-1: "#f2f2f3"
  ink-2: "#b4b4ba"
  ink-3: "#8b8b92"
  ink-off: "#55555c"
  primary-fill: "#f2f2f3"
  on-primary: "#000000"
  accent-ink: "#a5adff"
  talk: "#3ddc84"
  on-talk: "#000000"
  live: "#4cc2ff"
  danger-fill: "#d4343a"
  on-danger: "#ffffff"
  danger-ink: "#ff6b6b"
  idle: "#f5b83d"
  badge: "#d42f33"
  on-badge: "#ffffff"
typography:
  display:
    fontFamily: "Bricolage Grotesque Variable, Geist Variable, Segoe UI Variable Display, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 800
    lineHeight: "37px"
    letterSpacing: "-0.04em"
  page-headline:
    fontFamily: "Bricolage Grotesque Variable, Geist Variable, Segoe UI Variable Display, system-ui, sans-serif"
    fontSize: "44px"
    fontWeight: 800
    lineHeight: "42px"
    letterSpacing: "-0.035em"
  dialog-title:
    fontFamily: "Bricolage Grotesque Variable, Geist Variable, Segoe UI Variable Display, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 800
    lineHeight: "32px"
    letterSpacing: "-0.03em"
  section-title:
    fontFamily: "Bricolage Grotesque Variable, Geist Variable, Segoe UI Variable Display, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: "24px"
    letterSpacing: "-0.01em"
  column-title:
    fontFamily: "Bricolage Grotesque Variable, Geist Variable, Segoe UI Variable Display, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 800
    lineHeight: "24px"
    letterSpacing: "-0.02em"
  author-name:
    fontFamily: "Bricolage Grotesque Variable, Geist Variable, Segoe UI Variable Display, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: "20px"
  control:
    fontFamily: "Bricolage Grotesque Variable, Geist Variable, Segoe UI Variable Display, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: "1"
  message:
    fontFamily: "Geist Variable, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "22px"
  row:
    fontFamily: "Geist Variable, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "20px"
  description:
    fontFamily: "Geist Variable, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "18px"
  caption:
    fontFamily: "Geist Variable, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
  silkscreen:
    fontFamily: "Martian Mono Variable, Geist Mono Variable, Cascadia Mono, Consolas, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: "14px"
    letterSpacing: "0.08em"
    fontStretch: "90%"
  silkscreen-light:
    fontFamily: "Martian Mono Variable, Geist Mono Variable, Cascadia Mono, Consolas, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: "14px"
    letterSpacing: "0.1em"
    fontStretch: "100%"
  number:
    fontFamily: "Martian Mono Variable, Geist Mono Variable, Cascadia Mono, Consolas, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "16px"
    letterSpacing: "0"
    fontFeature: "tnum"
  number-small:
    fontFamily: "Martian Mono Variable, Geist Mono Variable, Cascadia Mono, Consolas, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: "14px"
    letterSpacing: "0"
    fontFeature: "tnum"
  code:
    fontFamily: "Geist Mono Variable, Cascadia Mono, Consolas, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "20px"
rounded:
  key: "2px"
  sheet-top: "4px"
  avatar: "2px"
  full: "9999px"
spacing:
  grid: "4px"
  inset: "8px"
  section: "16px"
  header: "48px"
  rail: "60px"
  tree-panel: "264px"
  tree-row: "32px"
  occupant-row: "28px"
  branch-label-row: "24px"
  control: "40px"
  control-lg: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary-fill}"
    textColor: "{colors.on-primary}"
    typography: "{typography.control}"
    rounded: "{rounded.key}"
    height: "48px"
    padding: "0 12px 0 20px"
  button-secondary:
    textColor: "{colors.ink-1}"
    typography: "{typography.control}"
    rounded: "{rounded.key}"
    height: "48px"
    padding: "0 20px"
  button-ghost:
    textColor: "{colors.ink-1}"
    typography: "{typography.control}"
    rounded: "{rounded.key}"
    height: "48px"
    padding: "0 20px"
  button-danger:
    backgroundColor: "{colors.danger-fill}"
    textColor: "{colors.on-danger}"
    typography: "{typography.control}"
    rounded: "{rounded.key}"
    height: "48px"
    padding: "0 20px"
  icon-button:
    textColor: "{colors.ink-1}"
    rounded: "{rounded.key}"
    size: "40px"
  input:
    backgroundColor: "{colors.ply-2}"
    textColor: "{colors.ink-1}"
    typography: "{typography.message}"
    rounded: "{rounded.key}"
    height: "48px"
    padding: "0 16px"
  menu-panel:
    backgroundColor: "{colors.ply-3}"
    textColor: "{colors.ink-1}"
    rounded: "{rounded.key}"
    padding: "4px"
  menu-item:
    textColor: "{colors.ink-1}"
    typography: "{typography.row}"
    rounded: "{rounded.key}"
    height: "36px"
    padding: "0 12px"
  dialog:
    backgroundColor: "{colors.ply-3}"
    textColor: "{colors.ink-1}"
    rounded: "{rounded.key}"
  tooltip:
    backgroundColor: "{colors.ink-1}"
    textColor: "{colors.ply-0}"
    typography: "{typography.caption}"
    rounded: "{rounded.key}"
    height: "28px"
    padding: "4px 8px"
  tree-row:
    textColor: "{colors.ink-2}"
    typography: "{typography.row}"
    rounded: "{rounded.key}"
    height: "32px"
    padding: "0 8px"
  occupant-row:
    textColor: "{colors.ink-2}"
    typography: "{typography.description}"
    rounded: "{rounded.key}"
    height: "28px"
  branch-label:
    textColor: "{colors.ink-3}"
    typography: "{typography.silkscreen}"
    height: "24px"
    padding: "0 8px"
  count-badge:
    backgroundColor: "{colors.badge}"
    textColor: "{colors.on-badge}"
    typography: "{typography.number-small}"
    rounded: "{rounded.key}"
    height: "18px"
    padding: "0 4px"
  avatar:
    backgroundColor: "{colors.ply-4}"
    textColor: "{colors.ink-1}"
    rounded: "{rounded.avatar}"
  empty-state-title:
    textColor: "{colors.ink-1}"
    typography: "{typography.section-title}"
---

# Design System: Ralph Meet

This document records what shipped on branch `ui/redesign` and supersedes the Quiet Pro document `docs/design-system.md`. Where the two disagree, this one wins. The frontmatter describes the default dark theme; the other five themes are colourways, listed under Colors and in the sidecar.

## Overview

**Creative North Star: "The Talk Tree"**

A black anodised panel with white silkscreen and coloured LEDs, in the manner of TeamSpeak's voice-server tree rebuilt with modern finish. The app is one live tree of who is where and who is talking. A friend glancing over from a game should see in one second who is in the call, who is speaking and where they are, then reach mic, deafen or leave in one place. The surface is a tool for an evening-long call: dense, calm, fixed in place, and cheap when nothing is happening.

Depth comes from five strictly ordered plies, hairline seams and ink tints; structure is drawn in hard 2px ink rules and 2px key corners. Colour appears only as light: talk green, live azure, muted red, idle amber. Everything that is not a light is neutral, and the one primary per view is a white notched key. Three faces split the work: Bricolage Grotesque prints titles, names and key labels, Martian Mono is the panel's silkscreen (labels, readouts, counts), and Geist carries everything you read for hours. Motion is instrument motion: lights change, panels settle on a critically damped spring, popups grow from their anchor, and nothing loops at rest.

The component kit behind this (keys, plates and lights) was picked on 2026-10-28 from the mockup at `/ui-fixtures?surface=component-kit` (`src/components/dev/component-kit-mockups.tsx`, options C1/C2/C3 per primitive); the picks are recorded under Components.

**Key Characteristics:**

- Five plies from a pure black canvas to a graphite float, separated by 1px seams rather than shadows (shadow only on floats and dialogs).
- Squared: every corner is a 2px key corner, avatars included. Section structure is a 2px ink-1 rule, not a box.
- Dither only in a few still places: a primary key's trailing cap, the fader range, a title rule, the poster word and a time-left bar. Never under text, never moving.
- Hover, selected and pressed are ink tints (6, 10 and 16 percent of the ink), never a hue.
- The tree is drawn in 1px guide strokes at 12 percent ink; the you-are-here path is lit in accent ink.
- One LED language everywhere a person appears: 60ms on, 220ms off, opacity only.
- Six themes (dark, light, Miku dark and light, Spider-Man dark and light) share one structure and change only tint, primary, accent, brand and shadow colour.
- Idle budget: 0 rAF callbacks per second, at most 2 compositor frames per second, at most 1 style recalculation per second, no infinite animation, except the ring on ringing DM-call surfaces (`scripts/idle-probe.mjs`).

## Colors

Near-black neutrals with one cool indigo accent for links and focus, and four fixed LED hues that carry all state.

### Primary

- **White Silkscreen** (`primary-fill` #f2f2f3, ink `on-primary` #000000): the one solid button per view. Switch tracks and the Continue button on sign-in also use it. In light it inverts to near-black (#0b0b0d on #ffffff).

### Secondary

- **Indigo Lamp** (`accent-ink` #a5adff): links, the focus ring, text caret, selected indicators, the lit you-are-here path, and `accent-tint` (accent at 16 percent dark, 12 percent light) behind mentions and selected chips. It is never a fill and never a state colour. It is at least 4.5:1 on plies 0 to 3 in every theme.

### Tertiary (LEDs)

- **Talk Green** (`talk` #3ddc84, `on-talk` #000000): speaking and connected; the speaking ring; Accept-call fills; online presence.
- **Live Azure** (`live` #4cc2ff, ink and tint derived): camera on, screen sharing, streaming.
- **Muted Red** (`danger-ink` #ff6b6b, tint at 14 percent): muted mic, deafened, errors, destructive rows. `muted-state` is a named alias of it so it can be retuned alone.
- **Solid Red** (`danger-fill` #d4343a, `on-danger` #ffffff): Leave and irreversible deletes only.
- **Idle Amber** (`idle` #f5b83d): idle presence, warnings, reconnecting.
- **Badge Red** (`badge` #d42f33, `on-badge` #ffffff): mention and unread-DM counts only.

### Neutral

- **Canvas** (`ply-0` #000000): chat column, rail, member panel, stage.
- **Panel** (`ply-1` #0b0b0d): the tree panel, settings nav.
- **Card** (`ply-2` #141417): tiles, composer, input fill, embeds, settings cards.
- **Float** (`ply-3` #1b1b1f): menus, popovers, dialogs, sheets, toasts.
- **Float Hover** (`ply-4` #232328): hover and nesting inside a float.
- **Ink 1 / 2 / 3** (`ink-1` #f2f2f3, `ink-2` #b4b4ba, `ink-3` #8b8b92): primary, secondary, meta text, each at least 4.5:1 on plies 0 to 3. `ink-off` (#55555c) is decoration only, never text.
- **Lines**: `line` (ink at 8 percent) for seams, `line-strong` (14) for outline buttons and unlit LEDs, `line-field` (40) for input edges at 3:1 or better, `guide` (12) for tree strokes. Light themes run 9, 16, 48 and 18.

### Themes

Themes are colourways. Each sets neutral tint, `primary-fill`, `accent-ink`, `brand`/`brand-2` and `shadow-rgb`; LED hues are fixed and only their lightness moves for contrast on light plies.

- **Light**: ply-0 #f4f4f5, ply-1 #fafafa, ply-2 and ply-3 #ffffff, ply-4 #f0f0f2; ink #0b0b0d / #4a4a52 / #6b6b73; accent #4a54d4; talk #1a9a52; live #0a7ec2; danger fill #c8282e.
- **Miku dark / light**: indigo-night neutrals (ply-0 #06060b / #f1f3f7); teal primary (#39c5bb on #06060b in dark, #007a72 on white in light); teal accent ink; brand teal with pink `brand-2` (#f872a5 / #e04f8a).
- **Spider-Man dark / light**: navy neutrals (ply-0 #02030a / #f2f4f8); blue primary (#2563eb / #1d4ed8) and blue accent ink; red brand (#e50914 / #d0101c) as identity only, never as state or interaction.

### Named Rules

**The Colour Is Light Rule.** Saturated colour appears only as an LED, a lit path or a theme's primary. Surfaces, borders, hover states and text are neutral. A theme may tint the neutrals; it may not paint a surface in a hue.

**The Ink Tint Rule.** Hover, selected and pressed are 6, 10 and 16 percent ink tints over whatever ply they sit on. Never a hue, never an in-between ply.

**The Separate Hues Rule.** A muted mic and a live camera never share a hue, and accent ink and danger ink stay at least ΔE 20 apart in every theme. `src/styles/__tests__/theme-contract.test.ts` enforces this, plus every ink, fill and tint contrast pair, for all six themes.

**The Brand Is Identity Rule.** `brand`, `brand-2` and `brand-ink` decorate only: the rail home mark, the theme mark, text selection and the theme banner rule. Never state, never interaction.

## Typography

**Body:** Geist Variable (with Segoe UI Variable Text, Segoe UI, system-ui), 400-600. Messages, rows, descriptions, inputs, menus, tooltips: everything read for hours.
**Display:** Bricolage Grotesque Variable (`--font-display`, `font-display`), 600-800 with optical sizing on. Titles, column and channel headings, dialog titles, author names, control labels (keys, segmented cells, tabs).
**Silkscreen:** Martian Mono Variable (`--font-silk`, the `silkscreen` utility and `text-num-*` / `Num`). 11px uppercase labels, kickers, legends, status words, readouts, kbd, counts, device codes. On dark grounds it runs condensed (wdth 90, 500, 0.08em); on light grounds (`light`, `miku-light`, `spiderman-light`) the utility widens it to wdth 100, 600, 0.10em, because the condensed cut was hard to read dark-on-white.
**Code:** Geist Mono (`--font-mono`, `font-mono`) for inline code and code blocks only.

All four are self-hosted (`styles.css` imports Bricolage `opsz.css` and Martian `wdth.css`); the latin Geist, Bricolage and Martian files are preloaded from `routes/__root.tsx`. Geist Mono is not preloaded: it is code only (plus the `/activate` entry field), so it loads on demand.

**Character:** a printed instrument panel. Bricolage is the maker's mark on the keys and titles, Martian is the small print silkscreened beside each control, and Geist stays out of the way for reading.

### Hierarchy

- **Poster** (Bricolage 800, 40/37, -0.04em): poster dialog titles (device approval, first run); the last word may be dithered.
- **Page headline** (Bricolage 800, 36-44/~0.95, -0.035em): a settings panel headline, under a silkscreen kicker and over the dithered rule.
- **Dialog title** (Bricolage 800, 28/32, -0.03em; 22/28 at 700 in a confirm): every plate dialog.
- **Section title** (Bricolage 700, 20/24): a rule card title, an empty-state title.
- **Column title** (Bricolage 800, 17-18/24, -0.02em): the 48px column headers (server name, channel name, Settings).
- **Author name** (Bricolage 700, 15/20): message authors; role colours still apply.
- **Control** (Bricolage 600, 15/1; 14 on sm keys): key labels, segmented cells, rule tabs (15), index tab labels (17 at 700).
- **Message** (Geist 400, 15/22): message body and composer, capped at a 72ch measure.
- **Row** (Geist 500, 14/20): tree channel rows, member and DM rows, menu rows, settings row labels (15); unread rows 600.
- **Description** (Geist 400, 13/18): settings descriptions, occupant rows, toast bodies.
- **Caption** (Geist 400-500, 12/16): meta lines, helper text, tooltips.
- **Silkscreen** (Martian 500, 11/14, 0.08em, uppercase, wdth 90; light themes 600, 0.10em, wdth 100): branch and group labels, kickers, field legends, status words, rule-card legends and indexes, the day divider, "GIF".
- **Number** (Martian 500, 12/16 tabular): call clocks, ping, bitrate, file sizes. **Number small** (11/14): timestamps, counts, kbd, menu hints. The device code runs Martian 600 at 0.04em: 32px under 380px wide and 40px from 380px up on the browser approval page (`DeviceActivation`), 28px on the desktop "Check your browser" screen (`DeviceCodeDisplay`). The code entry field on `/activate` is the one live input set in Geist Mono (28/32, 600, 0.12em).

### Named Rules

**The Three Faces Rule.** Bricolage names things, Martian labels and counts things, Geist says things. A sentence is never in Bricolage or Martian; a key label is never in Geist.

**The Silkscreen Rule.** Uppercase is the panel's own printing: Martian at 11px only. It labels (branch rows, legends, kickers over a title, status words); it is never a sentence and never above 11px.

**The 11px Floor Rule.** Nothing in the app sits below 11px, avatar initials included. Unread rows are `ink-1` at 600; read rows are `ink-2` at 500. Titles use `text-balance`, descriptions `text-pretty`.

## Layout

A fixed four-column instrument on desktop: a 60px rail on the canvas, a 264px tree panel on ply-1 with a 1px seam on its right, the chat column (messages capped at 72ch, embeds up to 640), and a member tree that appears at 1280px and wider. Every column header is 48px. Phone and narrow layouts keep the same tokens with edge-to-edge 48px-minimum rows and 40px avatars.

Rhythm is a 4px grid with an 8px rhythm, tuned tight for a tool used for hours. Lists inset 8px with rows 2px apart; a tree branch label is a fixed 24px row with 16px above it (8px for the first). Row heights: tree channel 32, occupant 28 (24px avatar), member and DM 40 with a status line (32px avatar), settings nav 36, menu 36, settings rows 48 and up. Keys are 32 (sm), 40 (default) and 48 (dialogs, settings, call keys); on coarse pointers every control gains an invisible 44px hit area and menu rows grow to 44px. The stage fits its grid to the viewport height with 8px gaps.

Controls appear once per viewport. The account row at the bottom of the tree panel always owns identity, mic, deafen and settings. The call strip appears only during a call, above it, with camera, share, activities, soundboard and Leave, and collapses to its status line while the stage is on screen. Hover actions overlay the trailing edge of a row (fading the name beneath) instead of reserving width.

### Named Rules

**The Once Per Viewport Rule.** A call control exists in one place at a time. Never duplicate a dock.

## Elevation & Depth

Hybrid, but flat by default: depth is the ply order plus 1px seams. Nothing on plies 0 to 2 carries a shadow. Ply-3 floats take `shadow-2` with a line; dialogs and drawers take `shadow-3`. Light themes run the same geometry at about a third of the alpha and lean more on the seam. Backdrop blur and filter blur are disabled globally in `styles.css`, so overlays stay crisp.

### Shadow Vocabulary

- **Seam** (`1px` border in `line`): the default edge between regions and around cards.
- **Hairline** (`0 1px 2px rgb(shadow / 0.3)`, `shadow-1`): switch thumbs only.
- **Float** (`0 8px 24px -6px rgb(shadow / 0.6)`, `shadow-2`, utility `shadow-float`): menus, popovers, toasts, floating players.
- **Modal** (`0 24px 64px -12px rgb(shadow / 0.72)`, `shadow-3`, utility `shadow-modal`): dialogs and drawers.
- **Scrim** (`rgb(0 0 0 / 0.56)` dark, `0.28` light; stacked layer `0.24`).
- **LED halo** (`0 0 0 2px led/22%, 0 0 8px led/45%`): painted once on the LED's `::after`; only its opacity changes.

### Named Rules

**The Strict Ply Rule.** Lift is monotonic and nothing invents an in-between elevation. Dark plies get lighter, light plies get whiter and add line and shadow.

## Shapes

Squared. Every corner in the app is a 2px key corner: keys, fields, plates, menus, tooltips, toasts, dialogs, tiles, embeds, rail tiles, count chips and avatars (`rounded-avatar`). The radius tokens (`rounded-xs` to `rounded-xl`) all resolve to 2px; the phone sheet top is 4px; `rounded-full` is kept for LEDs, the radio dot and spinners. The one primary key per view has a 10px notch cut from its top-right corner. Structure is drawn in rules, not boxes: a settings section is a 2px ink-1 rule, the menu panel carries a 2px ink top rule, the call strip and phone call bar sit under a 2px ink rule, and the rail divides Home from servers with a 2px by 24px ink rule. Edges between regions stay 1px hairlines; the tree is still 1px guide strokes with 8px ticks. The only side mark is the 2px by 8px unread pill flush with the panel edge.

## Components

### Buttons (keys)

`ui/button`. Squared 2px, Bricolage 600 labels, 32 (sm) / 40 (default) / 48 (lg; every dialog footer, sheet footer and settings action via `ButtonDefaults`).

- **Primary: C2 notched key.** `primary-fill` with a 10px cut top-right corner and a still dithered cap (on-primary dots, 12px wide) after the label, never under it. One per view. The notch is painted by the fill (`.rm-notch`, a gradient), not `clip-path`, so the global 2px focus ring on the button's own box is never clipped. At sm/xs, with `notch={false}`, or as `asChild`, it is the C1 solid key. Disabled goes tonal (`tint-2`, `ink-3`) and drops the cap.
- **Secondary: C1 key with an edge.** 2px `line-strong` by default; 2px `ink-1` when it sits beside a primary (`paired`, automatic in dialog and sheet footers).
- **Ghost** (no fill), **Outline** (1px line-strong), **Danger** (`danger-fill`, irreversible only: Leave, delete forever), **Destructive** (danger-ink on danger-tint, reversible), **Link** (accent ink).
- **Rule: C3.** No box: a 2px ink-1 rule under a Bricolage 700 label that turns accent on hover and focus. Inline actions and settings footers ("Reset to defaults").
- **Hover / Press:** an ink overlay of the key's own colour at 8 percent (12 on filled), 14 on press, fine pointers only; press scales to 0.97 over 100ms. Focus is a 2px accent ring with 2px offset, drawn at once. Loading swaps the label for a spinner without changing the width.

### Icon buttons and the call keys

`IconButton` sizes 24, 28, 32, 40, 48 with 16 to 24px Phosphor glyphs, 2px corners. Idle is a Bold glyph, bare until hovered; toggled is `tint-2` with the Fill glyph. Call keys are 48px squares: rest `tint-1`, open `tint-3` + Fill, muted `muted-state-tint` + danger ink + the "off" Fill glyph, live `live-tint` + live ink + Fill. Leave (`danger-fill`) is the only solid fill in any call surface and sits at the trailing end.

### Fields

- **C2 legend plate** (`Input` / `Textarea` / `SelectTrigger` inside `FieldPlate`): a `ply-2` plate, 1px `line-field` edge (3:1 on ply-2), 2px corners, 48px (`inputSize="lg"`, `size="lg"`) in settings and dialogs, 40 elsewhere; the label is printed across the top edge in silkscreen on a backing of the ground it sits on. Hover lifts the edge to `ink-2`; focus turns it `ink-1` and the global ring joins it.
- **C1 underline** (`FIELD_UNDERLINE`): no box, a 2px `line-field` rule that turns `ink-2` on hover and accent on focus. Header search only, with an outline `/` key cap.
- **Error / Disabled:** edge and ring go `danger-ink`; disabled fades to 45 percent.

### Toggles

- **Switch: C1 LED switch** (`ui/switch`): a 56x28 key. Off is a `tint-3` track with an `ink-2` thumb; on fades `primary-fill` in, the on-primary thumb slides 28px and a talk LED lights in the track (on is a light). `size="sm"` (40x20) for dense rows.
- **Checkbox: C1 hard check** (`ui/checkbox`): a 24px square with a 2px `ink-2` edge; checked fills primary with the Fill check.
- **Segmented rail** (`ui/segmented-control`): any choice of two to four. A 2px ink-1 rail, cells split by 2px ink rules, the chosen cell lit in `primary-fill`. 48px Bricolage cells in settings, 32px silkscreen cells inside a row. Arrow keys move and select.
- **Radio** (`RadioGroup`): round, only in long lists.

### Tabs

- **C2 index tabs** (`Tabs variant="index"`): top-level switches such as the Studio groups on a phone (01 You, 02 Calls, 03 App). Equal cells on a 2px rule, a silkscreen number over a 17px Bricolage label; the chosen cell's rule and label are ink-1 and its number accent.
- **C1 rule tabs** (`Tabs`, default): inside a page. Bricolage 600 15px labels on a 1px line; the 2px ink-1 indicator slides with transform only.

### Badge · LED

- **Count chip (C1)** (`CountBadge`): 18px square chip, 2px corners, `badge` fill, Martian 11 at 600. Mentions and unread DMs only, never pins or totals.
- **LED label (C2)** (`LedLabel`): every status word is an LED plus a silkscreen word in the light's ink: Talking, Live, Muted, Reconnecting, Offline, Voice connected, Saved. The word carries the meaning; the LED is decorative.
- Tint chips (`Badge`) stay for non-status labels, squared.

### Menus, Tooltips, Kbd

- **Menu: C1 panel** (`ui/menu.ts`, shared by DropdownMenu, Select and the context menus): ply-3, 2px corners, a `line-strong` edge with a 2px ink-1 top rule, `shadow-float`, 4px padding. An optional silkscreen title row; rows 36px (44 on touch), 2px corners, Geist 14 at 500 with a 16px `ink-2` icon column; hints in Martian 11 `ink-3`. Toggle rows carry an LED in the trailing slot (unlit off, talk-lit on). Highlight is `tint-2`, instant.
- **Tooltip: C1 inverted**: `ink-1` fill, `ply-0` text, 12px at 500, 28 high, 2px corners. A key inside it is a translucent cap. 500ms before the first, then instant between neighbours for 300ms.
- **Kbd** (`ui/kbd`): C1 key cap (default; `tint-2` with a 2px `ink-2` bottom edge, 24 high); C2 outline inside menus (automatic); C3 inverted for a key on a light patch. All Martian 11 at 600.

### Dialogs, Sheets, Toasts

- **Dialog: C1 plate** (`ui/dialog`): ply-3, 2px corners, `line-strong` edge, `shadow-modal`, 24px padding. A silkscreen kicker (`DialogKicker`, "Invite · Ralph HQ"), a Bricolage 28 title, an optional dithered rule (`DialogRule`), a 15/22 `ink-2` body, a footer of 48px keys (ghost or paired secondary, then the notched primary). The close key is a 40px `tint-2` square in the kicker row. Opens with a 0.96 scale and fade in 200ms; keyboard-opened dialogs fade only at 100ms.
- **Dialog: C2 poster** (`DialogTitle poster ditherLast`): for one-off moments only (device approval, first run). A 40px Bricolage 800 title whose last word is printed in two accent inks through a Bayer field (`DitherWord`); both inks must clear 4.5:1 on the float or it stays solid accent, and it is CanvasText under forced colours.
- **Phone:** dialogs become bottom sheets (`ResponsiveDialog` to `Drawer`) with a 4px top corner, a 22px Bricolage title and full-width 48px keys.
- **Toast: C1 LED toast** (`ui/toast`): ply-3, 2px corners, `line-strong` edge, `shadow-float`; an LED (talk for success, unlit for info, muted for error), a Bricolage 15 title, a 13px body, an optional silkscreen rule action. A timed toast carries a still dithered time-left bar along its foot that steps down once a second (clip only; pauses while the stack is hovered); errors persist with no bar. **Inverted** (`toast.call`): an `ink-1` fill, for a call-state change only (muted, deafened, disconnected, moved).

### Cards and rows

- **C2 rule card** (`RuleCard`): settings sections. No fill, no box: one 2px ink-1 rule, a silkscreen legend and `01 / 04` index on the rule line, an optional 20px Bricolage title.
- **C1 legend plate** (`LegendPlate`): floats and side panels ("What others get"): ply-2, a `line-strong` edge, the legend printed across the top edge.
- Rows are 48px where the row is the control (settings rows); list rows keep the Navigation heights.

### Avatar

C1 square (`ui/avatar`, `MiniAvatar` and every avatar in the app): 2px corners (`rounded-avatar`), a Bricolage 800 initial on `tint-3` (11px floor at small sizes), and presence as an LED in a square-cut notch at the bottom-right, cut out of the ply it sits on (online talk, idle amber, dnd muted red, offline unlit). The speaking ring stays the 2px talk `rm-speak` ring and follows the square. An avatar wearing a collectible decoration keeps a round crop under the decoration, because its ring art is drawn for a circle; frames around profile cards are unaffected.

### Slider

**C1 dither fader** (`ui/slider`): an 8px `tint-3` track whose range is a still accent dither that gets denser toward the value, a 12x28 `ink-1` fader cap with 2px corners, and a Martian readout beside it where the value matters. Under forced colours the range is a solid Highlight bar.

### Dither in the app

`ui/dither` (`DitherDots`, `DitherRamp`, `DitherRule`, `DitherWord`) and `ui/dither-glyph` (`DitherGlyph`). Allowed in exactly these places: the notched primary's trailing cap, the fader range, the rule under a dialog or settings headline, a poster dialog's last word, a time-left bar (toasts, the device code), and the glyph above an empty state or loader (see DitherGlyph and EmptyState). Every one is a still Bayer pattern painted once (an alpha mask over a role colour, so a theme change costs nothing), `aria-hidden`, without pointer events, hidden under forced colours, never under running text and never moving at rest. The public pages add three more still fields, listed under Public pages.

### Public pages (C poster)

Picked from `/ui-fixtures?surface=type-mockups` (now only this direction; the Archivo and Fraunces variants were removed).

- **Landing** (`components/home`, recipes in `home/ui.ts`): a Bricolage 800 hero headline (56 to 176px, leading 0.86) whose last word is a two-ink `DitherWord ground="ply-0"`; a 20px dithered rule (`HomeDither` `DitherRule`, 12px on phones) under it; then three columns: the lede, the keys (the notched primary plus a paired secondary; `KeyLink` gives links the notch and cap) and a right-aligned silkscreen manifest. The real product stands on the still dithered horizon (`DitherHorizon`), which starts under the screenshot. Each feature opens on an oversized dithered numeral (`NUMERAL`, aria-hidden), a silkscreen kicker and a Bricolage head; facts and the kit are 3- and 4-up columns under 2px ink rules. Nav, footer headings and links are silkscreen.
- **Access frame** (`auth/PublicFrame`): the sign-in dither in a panel on the leading edge at lg (36 percent, max 600; a 160 to 320px strip beside a shared message), a 64px band across the top below lg; a 440px column on plain ground. `PublicKicker` (silkscreen), `PublicTitle` (Bricolage 800, 44 to 68px for an entry screen, 28/32 after it) over a dithered rule, `PublicBody`, a squared `StatusTile`, `FieldPlate` fields and 48px keys. Every public page, 404 and route errors included, is this frame.
- **Kova card** (`auth/auth-card-appearance.ts` plus the `.auth-split` block in `styles.css`): the same title, rule, legend-plate fields, rule tabs, notched Continue with its cap, secondary provider keys and a silkscreen footer. The SDK owns the title and subtitle wording.
- **Voice stats** (`voice/DitherChart`): figures sit under a 2px ink rule (no box), every chart label is silkscreen, and the debug screen leads with a Bricolage "Connection" title, an LED status label and a 4-up Martian readout row with peaks (`DitherReadouts`).

### Navigation (tree rows)

Tree channel rows are 32px, 16px icon, Geist 14 at 500; state is an ink tint (hover `tint-1`, selected `tint-2`). Unread is `ink-1` at 600 with a 2px left pill at the panel edge. Branch labels are Martian silkscreen in `ink-3` with a 12px chevron and a right-aligned count. Voice occupants are 28px rows with a 24px square avatar and their LED on the guide. Mention and unread-DM counts use the square count chip. Settings navigation groups print their number in `ink-1` before the name (01 You, 02 Calls, 03 App).

### LED

The state light. 6px (8 optional) dot. Off is a dot in `line-strong`; on it fills with its colour (talk, live, muted, idle) and a halo painted once. Only opacity transitions: 60ms on, 220ms off. No pulse, breathing or level-reactive scale. It follows `[data-speaking]` on its leaf or any ancestor, set by `useSpeakingAttr`, so a speaking flip re-renders only that leaf. The same 60/220 timing drives the `rm-speak` ring (2px talk ring at -2px inset) on avatars and tiles. Someone starts talking and their node lights in the tree, the call strip and their tile at the same instant.

### Tree (TreeBranch / TreeLeaf)

The signature. Every leaf draws its own three segments in CSS, so nothing is measured: an upper trunk from row top to row middle, an 8px tick to the node, and a lower trunk to the next sibling unless it is last. A leaf marked `self` or `current` lights its segments and every earlier sibling's trunk in `path` (accent ink) up to the branch root, and its own unlit node fills in the path colour; a lit talk LED still paints over it. A voice channel branch carries a `stem` so the path rises to the channel glyph. A row inserted after first paint fades in from 4px above in 200ms and its segments draw from their origin in 160ms (40ms late). Initial render and history loads never animate.

### Num and NumClock

Martian, tabular readouts. `NumClock` ticks in its own leaf with one aligned timeout per second and stops while the app is inactive, catching up on return.

### DitherGlyph and EmptyState

`DitherGlyph` (replaced TreeArt on 2026-10-30) is a small pixel drawing on a cell grid at 2, 3 or 4px cells (`sm`, `md`, `lg`): structure in solid `ink-3` cells, light in an accent-ink 8x8 Bayer dither, the two inks of the cold-load mark. One motif per context: `mark` (the Ralph Meet mark printed through a diagonal dither; the updater, the empty chat column, full-screen loaders), `empty` (a dashed slot with light pooled in one corner; the default empty state), `screen` (a monitor lit from the top-left; the screen picker) and `voice` (a still level meter with peak-hold cells; the voice landing). `pending` prints the same drawing with its light about 40 percent resolved, as the cold-load mark is before its last step: that is the whole loading signal, because nothing moves. Alpha masks over role colours, `aria-hidden`, hidden under forced colours. `EmptyState` (`motif`, `loading`) is the glyph over a Bricolage 700 title (20, 15 at sm), a 13px description in `ink-2` at a 40ch measure, and at most one action. No card, no eyebrow.

### Theme slots

Theme personality lives in `ThemeMark` (a glyph over the rail home mark) and `ThemeBanner` (a 2px brand rule in the 48px header, brand then brand-2 as a hard stop, plus a 16px glyph at the end), registered by theme id in `THEME_SLOTS`. Components never branch on the active theme or sniff theme classes.

### Motion

Instrument motion: only transform, opacity, translate, scale and rotate animate. Durations are 100 (hover, press), 150 (tooltip, toggle), 200 (menu, popover, list insert), 250 (dialog, panel, drawer) with exits at about 0.7x; LED and ring 60 on and 220 off. Curves: `ease-out` (default, enter and exit), `ease-in-out` (on-screen movement), `ease-drawer`, and a critically damped `ease-spring` for panels. No `ease-in`, no bounce, nothing over 300ms except loaders. Presence grows from the anchor at 0.97; side panels slide 16px on the spring. Reactions land in 220ms with no overshoot and leave in 150ms. Under `prefers-reduced-motion`, one global rule zeroes travel and scale and caps fades at 100ms; LEDs and the speaking ring keep working with instant transitions.

### Named Rules

**The Light Once Rule.** Everywhere a person appears in a call, the same LED lights at the same 60ms and decays over the same 220ms. No second speaking treatment.

**The Silent Idle Rule.** Nothing loops at rest. The only infinite animations are a pending spinner and an incoming or outgoing call ring; each unmounts when its state ends. When the app is hidden, minimised, or unfocused behind a fullscreen game, `useAppActive` sets `data-app-inactive` on the root, which pauses every CSS animation, and every rAF, canvas and video loop stops.

## Do's and Don'ts

### Do:

- **Do** build with the role names only (`bg-ply-2`, `text-ink-3`, `border-line`, `text-accent-ink`, `bg-talk`), never the legacy `--rm-*` or shadcn aliases in new code.
- **Do** show state as light: an `Led`, a lit guide, the speaking ring, a tint plus a matching glyph weight (Bold idle, Fill active, "off" partner for muted).
- **Do** put hover, selected and pressed on ink tints and keep one `primary` button per view.
- **Do** set every live number in `Num` or `text-num-*`, and let clocks tick in their own leaf.
- **Do** use `shadow-float` on ply-3 floats and `shadow-modal` on dialogs and drawers; nothing else casts a shadow.
- **Do** keep every corner a 2px key corner (`rounded-*` tokens, `rounded-avatar`) and keep 44px hit areas on coarse pointers.
- **Do** use the kit primitives: one notched primary per view, `FieldPlate` for fields, `SegmentedControl` for two to four choices, `LedLabel` for status words, `RuleCard` for settings sections.
- **Do** change any token through the layer-1 `--t-*` inputs in `src/styles/tokens.css`, one hex per line, so the contrast contract test keeps covering it.
- **Do** gate entrance motion behind `[data-animate-enter]` (first paint) and leave through view transitions.

### Don't:

- **Don't** use a hue for hover, selected or pressed, or for any surface or border.
- **Don't** share a hue between a muted mic and a live camera, or use brand colour (Spider-Man red, Miku pink) for state or interaction.
- **Don't** add a second call dock, duplicate mic or deafen controls in the call strip, or draw avatar-tile walls with giant initials.
- **Don't** loop anything at rest: no pulse, breathing or level-reactive scale on the LED, no shimmering skeletons (skeletons are static `tint-1`), no new infinite animation outside the two allowed.
- **Don't** animate layout or paint properties (width, height, background-position, box-shadow), and don't use `ease-in` or bounce.
- **Don't** set a card side-stripe over 1px, a gradient fill, glass or backdrop blur as decoration. (The theme banner's hard-stop rule, the notch fill and media scrims over user images are not decoration of this kind.)
- **Don't** put dither anywhere but the cap, the fader, a title rule, the poster word, a time-left bar and the empty-state or loader glyph; never under text, never animated, never without `aria-hidden`.
- **Don't** clip a focusable element with `clip-path` (it cuts the focus ring); paint the shape instead, as `.rm-notch` does.
- **Don't** set prose in Bricolage or Martian, or a key label in Geist. A kicker above a title is Martian silkscreen, never a sentence.
- **Don't** put text below 11px, set Geist above 600 or Bricolage below 600, or use a serif or system display face.
- **Don't** round an avatar (except under a collectible decoration), or put a status word in a tint chip; use `LedLabel`.
- **Don't** branch on the active theme in a component; add a slot in `THEME_SLOTS`.
- **Don't** put a count chip on pins or totals; counts are mentions and unread DMs only.
