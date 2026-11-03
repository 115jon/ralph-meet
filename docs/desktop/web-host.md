# Web host

How the shared web UI (`src/`) reaches the shell it runs in. The browser and the desktop app run the same React
code; what differs is one object, the host. UI code calls `getHost()` and never imports `@tauri-apps/*` for the
things the host covers.

## Modules

| module                                                                   | owns                                                                   |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| [`src/lib/runtime.ts`](../../src/lib/runtime.ts)                         | `isDesktop()`, `isMobile()`, `isTauri()`; imports nothing              |
| [`src/lib/host/types.ts`](../../src/lib/host/types.ts)                   | the `Host` interface, grouped by capability                            |
| [`src/lib/host/index.ts`](../../src/lib/host/index.ts)                   | `getHost()`, `setHostForTests()`                                       |
| [`src/lib/host/web.ts`](../../src/lib/host/web.ts)                       | the web adapter: browser behavior and no-ops                           |
| [`src/lib/host/desktop.ts`](../../src/lib/host/desktop.ts)               | the desktop adapter                                                    |
| [`src/lib/host/tauri-gateway.ts`](../../src/lib/host/tauri-gateway.ts)   | typed `invokeCommand` / `listenEvent`: every command and event it uses |
| [`src/lib/host/desktop-tray.ts`](../../src/lib/host/desktop-tray.ts)     | the tray badge                                                         |
| [`src/lib/host/desktop-toasts.ts`](../../src/lib/host/desktop-toasts.ts) | the notification plugin, toasts, taskbar attention                     |
| [`src/lib/app-updates.ts`](../../src/lib/app-updates.ts)                 | the one update client over `host.updates`                              |
| [`src/lib/desktop-deep-link.ts`](../../src/lib/desktop-deep-link.ts)     | the page's deep-link listener (behind `host.deepLinks`)                |

## The interface

| capability      | methods                                                                                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`          | `"web"` or `"desktop"`                                                                                                                                                                                                                 |
| `updates`       | `check()`, `install(onEvent)`, `getAppVersion()`                                                                                                                                                                                       |
| `window`        | `restart()`, `openExternal(url)`, `focus()`, `setTitleBarDarkMode(dark)`, `toggleDevtools()`, `launchMainWindow()`, `closeCurrentWindow()`, `closeUpdaterWindow()`, `syncThumbnailToolbar(state)`, `onThumbnailToolbarAction(handler)` |
| `notifications` | `setBadge(state)`, `showToast(options)`                                                                                                                                                                                                |
| `settings`      | `load()`, `save(patch)`                                                                                                                                                                                                                |
| `deepLinks`     | `subscribe(handler)` → `{ unsubscribe, ready }`                                                                                                                                                                                        |
| `media`         | `listNativeAudioDevices()`, `listNativeVideoDevices()`, `probeHardwareVideoEncoders()`, `onNativeScreenShareEnded(handler)`                                                                                                            |

What the web adapter does:

| call                                     | web                                          |
| ---------------------------------------- | -------------------------------------------- |
| `updates.check`, `updates.getAppVersion` | `null`                                       |
| `settings.load`, `settings.save`         | `null` (the store keeps its localStorage)    |
| `media.list*`                            | `[]`                                         |
| `window.restart`                         | reloads the page                             |
| `window.openExternal`                    | `window.open(url, "_blank", "noopener,…")`   |
| `deepLinks.subscribe`                    | never calls the handler; `ready` is resolved |
| everything else                          | resolves and does nothing                    |

Native screen share (`src/lib/voice/native-screen-share-transport.ts`, `useNativeShareStats`,
`DesktopScreenPickerModal`) keeps its own `invoke`; it is not part of the host.

## Selection and tree-shaking

Each Vite config defines two build flags (declared in `src/env.d.ts`):

| config                   | `__IS_DESKTOP__` | `__IS_MOBILE__` |
| ------------------------ | ---------------- | --------------- |
| `vite.config.ts` (web)   | `false`          | `false`         |
| `desktop/vite.config.ts` | `true`           | `false`         |
| `mobile/vite.config.ts`  | `false`          | `true`          |

`getHost()` reads `__IS_DESKTOP__` inline:

```ts
selected ??=
  typeof __IS_DESKTOP__ !== "undefined" && __IS_DESKTOP__
    ? createDesktopHost()
    : webHost;
```

Vite replaces the flag with a constant, so the condition folds and Rollup drops the branch it does not take. In the
web build `createDesktopHost` is unused, so `desktop.ts`, the gateway, the tray and toast modules and the
`@tauri-apps/api` modules they import are not bundled. `isDesktop()` and `isMobile()` read the same flags, so their
branches fold too. Vitest defines neither flag; the `typeof` guard makes both false there.

`isTauri()` is a runtime check (`__TAURI_INTERNALS__` on `window`) and is true on desktop and mobile. Use it only for
what both native shells share: bearer-token auth, the client-only SPA root, the native title bar color. Anything
desktop-only goes through the host or `isDesktop()`.

`platform.ts` re-exports the three checks for existing importers. `desktop-auth.ts` imports them from `runtime.ts`,
which is why `runtime.ts` imports nothing: `platform.ts` imports `desktop-auth.ts`.

To check the web bundle, build it and search the client output:

```sh
pnpm build
grep -rlF "get_desktop_settings" dist/client      # nothing
grep -rlF "take_pending_deep_links" dist/client   # nothing
```

Some modules outside the host still `import()` `@tauri-apps/api` directly behind runtime checks: the native share
transport (`native-screen-share-transport.ts`), `useNativeShareStats`, `DesktopScreenPickerModal`, `DesktopLogin`,
`useAppActive` and `useBackButton` (the last two also serve Tauri mobile). Their `core`/`window` chunks stay in the
web output, but nothing on the web start path imports them, so a browser never loads them. Moving those call sites
onto the host would drop the chunks.

## Updates

Rust keeps one pending update (`PendingUpdate` in `app_updates.rs`): `fetch_update` replaces it, `install_update`
takes it. `app-updates.ts` is the page's one client for it:

- one check in flight; callers at the same time share it, with a 10 s timeout (`withTimeout`);
- no check while an install runs;
- `install()` only installs what the last check found;
- progress is folded once (`createProgressTracker`, 0–1; `progressPercent` for display).

The three surfaces read the same state (`useAppUpdateState()`) and keep their own copy:

| surface             | where                          | maps state to                                  |
| ------------------- | ------------------------------ | ---------------------------------------------- |
| `StandaloneUpdater` | updater window at launch       | checking / downloading / installing / starting |
| `UpdateChecker`     | toast in the main window       | available / downloading / ready / error        |
| `useAppUpdater`     | Settings, Desktop, Updates row | the Settings status line and button            |

The toast stays silent on a failed check; Settings shows it.

## Tray badge

`notifications.setBadge` on desktop goes to `applyTrayBadge`. It remembers what it applied and only crosses IPC for
a change: the tooltip when its text changes, the icon when the label changes (`"dot"`, `"1"`…`"99"`, `"99+"`,
default), the taskbar overlay once per page, taskbar attention off when the badge clears. The window icon's pixels
are read once. Every `Image` it creates is closed after `setIcon`. The `TrayIcon` handle is looked up once and kept,
never closed: closing a `TrayIcon` resource removes the tray icon from the app (`Resource for TrayIcon` in tauri).

## Adding a capability

1. Add the methods to `Host` in `types.ts`, under an existing capability or a new one.
2. Implement them in `web.ts` (browser behavior or a no-op) and `desktop.ts`.
3. Add each new command to `DesktopCommands` and each new event to `DesktopEvents` in `tauri-gateway.ts`, and call
   them through `invokeCommand` / `listenEvent`.
4. Call `getHost().<capability>.<method>()` from the UI. Do not add `isDesktop()` + `invoke` at the call site.
5. Test the web behavior in `src/lib/host/__tests__/host.test.ts`. Component tests inject a fake with
   `setHostForTests({ ...webHost, ... })`, or the real desktop adapter over a mocked `@tauri-apps/api/core`
   (`setHostForTests(createDesktopHost())`).

## Mobile

Mobile (`mobile/`, `apps/mobile/`) is out of scope. The Tauri mobile build gets the web adapter (`__IS_DESKTOP__` is
false) and keeps its own code paths (`isMobile()`, `safe-area.ts`, `useBackButton`). Do not add mobile behavior to
the desktop adapter or branch on `isMobile()` inside the host.
