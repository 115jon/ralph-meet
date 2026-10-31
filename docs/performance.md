# Performance

How Ralph Meet loads, what each page may weigh, and how to check it.

## What loads when

Every page is server-rendered by TanStack Start, so the HTML paints before any script runs; the
scripts then hydrate it. What differs per page is the chunks it asks for.

| Where                               | Loads                                                                                                                                                                              | Why                                                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Every page                          | The HTML, `styles.css` (render-blocking), the Geist, Bricolage and Martian Mono latin faces (preloaded), `main`, the shared `client` chunk, React DOM                              | Router, Kova auth provider, theme, icons, the public-page frame. All three faces are on every surface. |
| `/`                                 | The `index` chunk (landing sections). After `load`, at idle: the GitHub releases feed, then the `sign-in` and `room` chunks (or the chat shell, if a session token is stored)      | The download button already has a pinned fallback, so the feed can wait                                |
| `/sign-in`, `/sign-up`              | The route chunk and the auth frame. After `load`, at idle: the chat shell                                                                                                          | Signing in lands on `/chat`; the shell is ready by then                                                |
| `/activate`                         | The route chunk and `avatar`. After `load`, at idle: the sign-in chunks (a signed-out visitor is sent there)                                                                       | Device activation                                                                                      |
| `/room/$slug`, before joining       | The route chunk and the name prompt. Nothing from the call stack                                                                                                                   | A guest only needs a name field to start                                                               |
| `/room/$slug`, joining              | `RoomVoiceView` and the call stack (`useVoiceChannel`, the SFU client, the grid, the chat panel). Prefetched at idle after `load`; imported on the first typed character           | Join is instant when the prefetch landed; otherwise the "Connecting to..." screen covers the wait      |
| `/chat`                             | The route, `ChatPageClient`, the chat store, `InlineEmojiText` (the emoji set), `voice-standby` (the SFU client, kept warm), `LinkEmbed`, and the shared base-ui chunk             | The signed-in shell                                                                                    |
| `/chat`, after `load`, idle         | The GIF picker, message search and channel settings                                                                                                                                | Each opens from a click; this warms them (`warmLazyPanels`)                                            |
| `/chat`, on demand                  | Settings, the profile editor, the server settings, the voice dashboard, soundboard, the activity stages (`WarpRushActivityStage` is three.js, `WordleActivityStage`), the shop tab | Opened by the person, not on the first screen                                                          |
| Any page, after the first idle      | The Toaster (`sonner` and the card). On `/chat` it mounts as soon as the chat store loads                                                                                          | No public page raises a toast; the signed-in app does, at once                                         |
| Any page, once the chat store loads | The theme bootstrap (applies or seeds the synced theme)                                                                                                                            | It reads the signed-in user from the chat store, so before the store there is nothing for it to do     |
| Desktop (Tauri) only                | `DesktopLogin`, `DesktopThumbnailToolbarSync`                                                                                                                                      | The web build never draws them                                                                         |

Four seams keep the public pages free of the chat app:

- **`chat-store-loaded`** (`src/stores/chat-store-loaded.ts`): the chat store (reducer, REST actions,
  gateway, sounds, voice tickets, about 25 KB gzip) used to ride in the shared chunk because
  `ThemeProvider` imported it. The theme bootstrap and the Toaster now wait for this flag and load
  themselves. Importing the store flips it.
- **`speaking-source`** (`src/stores/speaking-source.ts`): `Avatar` asks "is this user speaking?" to
  draw its ring. It asks this seam; the chat store registers itself as the source when it loads. Until
  then nobody is speaking, which is true on every page without a call.
- **`lazy-room-voice`** (`src/components/lazy-room-voice.ts`): the lobby (`RoomPageClient`) renders
  the name prompt and holds a `React.lazy` handle on `RoomVoiceView`. `preloadRoomVoiceView()` starts
  the import on the first typed character or a name restored from `sessionStorage`.
- **`lazy-panels`** (`src/components/chat/lazy-panels.ts`): the chat shell's click-opened panels, each
  its own chunk, warmed at idle.

### Prefetch after load

`tools/vite/prefetch-manifest.ts` writes `prefetch-manifest.json` beside the client build: for each
group in `vite.config.ts` (`chat`, `sign-in`, `room`, `room-voice`), the chunk files its entry module
needs, matched by source path so hashes can change. `src/client.tsx` calls `prefetchLikelyNext()`
(`src/lib/prefetch.ts`) once the page has loaded and the browser is idle. It picks the groups for the
current path, skips chunks the page already requested, and adds
`<link rel="prefetch" as="script" crossorigin>` for the rest: downloaded at the lowest priority, not
run. `public/_headers` makes `/assets/*` immutable for a year, so the later `import()` is a cache hit
with no revalidation.

It does nothing on Data Saver or 2G, in dev, or when the manifest is missing (an old deploy).
`crossorigin` is required: module scripts are fetched in CORS mode, and a prefetch without it is
fetched a second time when the import runs.

What it costs: a lobby visitor downloads about 365 KB gzip beyond the lobby after load; a sign-in
visitor about 520 KB (the chat shell). Both after the page is interactive, at idle priority.

### Trade-offs

- A lobby visitor who joins before the prefetch finished (or on Data Saver) waits for the call stack
  on the "Connecting to..." screen, which is the screen they would see during the SFU handshake
  anyway. Nothing is drawn differently.
- The GIF picker, message search and channel settings are fetched at idle, 5 s after load at the
  latest. A click before that waits for one small chunk (no spinner: the panel mounts when it lands).
- A toast raised in the first moments of a public page (before the first idle) would be dropped,
  because sonner only shows toasts that arrive after its Toaster mounts. No public page raises one;
  the chat shell mounts the Toaster when its store loads.

## Budgets

Gzip, from `pnpm run build`; `pnpm run perf:budgets` builds and fails when one is exceeded
(`scripts/check-bundle-budgets.mjs`). Cloudflare serves brotli, a little smaller. Groups include the
shared entry chunks but not React DOM (55 KB gzip, loaded by every page).

| Asset                                         | Budget | Now   | Before   |
| --------------------------------------------- | ------ | ----- | -------- |
| Entry: `main`, `client`, React DOM, small     | 225 KB | 217.8 | 258.2    |
| CSS                                           | 42 KB  | 40.3  | 44.2     |
| Group `sign-in` (entry + route)               | 170 KB | 165.5 | 211      |
| Group `room` (the lobby)                      | 170 KB | 166.0 | 521      |
| Group `room-voice` (lobby + call stack)       | 535 KB | 519.0 | 521      |
| Group `chat` (the signed-in shell)            | 690 KB | 673.8 | 709      |
| `RoomVoiceView`                               | 7 KB   | 6.2   | new      |
| `chat-store`                                  | 26 KB  | 24.7  | in entry |
| `toast` (sonner and the card)                 | 12 KB  | 11.0  | in entry |
| `ChatPageClient`                              | 142 KB | 137.2 | 147.7    |
| `InlineEmojiText` (emoji set)                 | 86 KB  | 83.7  | 83.7     |
| `voice-standby` (SFU client)                  | 77 KB  | 74.2  | 85.9     |
| `GifProviderBranding` (base-ui, Radix)        | 96 KB  | 93.1  | 93.3     |
| `LinkEmbed`                                   | 47 KB  | 45.5  | 45.1     |
| `WarpRushActivityStage` (three.js, on demand) | 145 KB | 141.5 | 141.4    |

The shared `client` chunk alone went from 197.8 to 153.3 KB gzip (640 to 477 KB raw). "Before" for the
groups is the route's preload list in the old build (`sign-in` 211, the lobby 521, `chat` 709).

A change that grows a budget says why in its commit and raises the number in the script and here.

## Lighthouse

Mobile, 4 pages, `vite preview` uncompressed (so byte counts are raw bytes on the wire, about 3.3x
the gzip numbers above). Accessibility 100 on every page; CLS 0 everywhere.

Median over 6 runs per page and build (3 rounds of 2, base and change alternating, order flipped
each round), 2026-10-30. "Before" is the build at the start of this work.

| Page               | Perf     | FCP           | LCP           | TBT        | CLS | JS (KB)     | Unused JS (KB) |
| ------------------ | -------- | ------------- | ------------- | ---------- | --- | ----------- | -------------- |
| `/`                | 58 to 60 | 6.9 to 5.9 s  | 9.3 to 8.2 s  | 111 to 103 | 0   | 869 to 746  | 405 to 278     |
| `/sign-in`         | 57 to 59 | 6.5 to 5.6 s  | 8.4 to 7.4 s  | 186 to 172 | 0   | 853 to 729  | 389 to 262     |
| `/activate`        | 59 to 60 | 6.8 to 5.9 s  | 9.6 to 9.1 s  | 22 to 22   | 0   | 904 to 776  | 404 to 277     |
| `/room/lighthouse` | 55 to 62 | 13.4 to 5.4 s | 15.4 to 7.5 s | 92 to 21   | 0   | 1995 to 730 | 1015 to 276    |

JS is the transfer size of script requests. The change also moves bytes after the page has loaded,
which Lighthouse sees as `prefetch` requests and counts in total bytes, not in JS: about 16 KB on `/`,
6 KB on `/activate`, 1.8 MB raw (the chat shell) on `/sign-in` and 1.3 MB raw (the call stack) in the
lobby. They start after `load` at idle priority and are not in FCP, LCP or TBT. The numbers above are
uncompressed; in production the same files are about a third of that.

`/chat` is not in the table: it needs a session (`LHCI_KOVA_SESSION_TOKEN`), so its weight is tracked by
the `chat` budget above, 709 to 674 KB gzip. Best Practices is 93 to 96 on a local run only because the
auth server's CORS policy rejects `localhost`.

Performance stays in the high 50s to low 60s because a mobile run is bandwidth-bound: the page asks for
about 240 KB of CSS, 143 KB of fonts and 730 KB of JS before it can paint, and Lighthouse's simulated
1.6 Mbps link shares that between them. What is left is the shared `client` chunk (TanStack Start,
the Kova auth SDK, the icon table, tailwind-merge), the stylesheet, and React DOM.

## Measuring

Lighthouse CI (`lighthouserc.cjs`) builds, serves the build with `vite preview`, and runs the four
public pages five times as a throttled phone. Reports land in `.lighthouseci/reports`.
`LHCI_PORT` moves the server off 4801. With `LHCI_KOVA_SESSION_TOKEN` set it also runs `/chat`.

```sh
pnpm run perf
```

Runs of one build vary by up to 10 points on a busy machine, so compare builds by alternating them
in one session: build the baseline, copy `dist` aside, build the change, then for each round serve
one, run `lhci collect --numberOfRuns=2` on the four URLs, stop it, swap `dist`, and serve the other.
Reverse the order every round. Take the median of each metric over all runs, not the old table.

What is in a chunk: `pnpm exec vite build --sourcemap`, then
`pnpm dlx source-map-explorer dist/client/assets/<chunk>.js --no-border-checks`. A chunk is named
after its first module, so a name like `GifProviderBranding` can hide a shared vendor chunk (here:
base-ui and the Radix select used by the chat panels); read the explorer, not the name.

Which chunks a route loads: the `preloads` list of its entry in
`dist/server/assets/_tanstack-start-manifest_v-*.js`, plus React DOM (a dynamic import from `main`).
