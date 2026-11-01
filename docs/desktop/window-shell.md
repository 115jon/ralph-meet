# Desktop window shell

Who decides whether the main window is visible, how `ralphmeet://` links reach the page, and where the desktop
settings live. The frontend sends intents; Rust decides.

## Modules

| module                                                                   | owns                                                                               |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| [`main_window.rs`](../../desktop/src-tauri/src/main_window.rs)           | the launch handoff, reveal, close to tray, deep-link routing                       |
| [`desktop_settings.rs`](../../desktop/src-tauri/src/desktop_settings.rs) | `desktop-settings.json`, `get_desktop_settings`, `set_desktop_settings`            |
| [`window.rs`](../../desktop/src-tauri/src/window.rs)                     | the Win32 tray-state helpers (`make_window_invisible`, `restore_window_from_tray`) |
| [`window_state.rs`](../../desktop/src-tauri/src/window_state.rs)         | size, position and maximized state (unchanged)                                     |
| [`tray.rs`](../../desktop/src-tauri/src/tray.rs)                         | the tray icon and menu; calls `reveal`                                             |

## Tray state

The CEF runtime cannot hide the window: `hide()` stops its message loop, `minimize()` crashes the GPU process
(`0x80000003`) and `set_skip_taskbar()` is unimplemented. "In the tray" therefore means shown, alpha 0,
`WS_EX_TOOLWINDOW` (off the taskbar and Alt+Tab) and `WS_EX_TRANSPARENT` (click-through). `restore_window_from_tray`
removes those styles, restores a minimized window and foregrounds it. Windows only; elsewhere close quits and start
minimized is ignored.

## Showing the window

The main window is created hidden (`visible: false`) while the updater window checks for updates.

| path                               | entry                                  | does                                                    |
| ---------------------------------- | -------------------------------------- | ------------------------------------------------------- |
| updater handoff                    | `launch_main_window` command           | `complete_launch`: show and focus, or start in the tray |
| updater window closed without it   | `Destroyed` event of `updater`         | `complete_launch` (no-op if it already ran)             |
| tray click, tray "Show Ralph Meet" | `tray.rs`                              | `reveal`                                                |
| second launch (shortcut, Run key)  | single-instance callback               | `reveal`, or `route_deep_link` if argv has a link       |
| `ralphmeet://` link                | single-instance argv, deep-link plugin | `route_deep_link`, which calls `reveal`                 |
| close button                       | `CloseRequested` on `main`             | `on_close_requested`: tray state, or quit               |

`complete_launch` runs once. It starts in the tray only when all three hold (`launch_to_tray`):

| condition            | source                                                                         |
| -------------------- | ------------------------------------------------------------------------------ |
| autostart launch     | `--autostart` on this process's command line, read once into `MainWindowState` |
| start minimized on   | `desktop-settings.json`                                                        |
| nothing asked for it | no second launch or link arrived before the handoff                            |

Otherwise it shows the window. In the tray case it applies the tray state and then shows the window, so the window
is shown (CEF keeps running, the deferred maximize from `window_state` applies) but invisible.

`reveal` before the handoff does not touch the window; it marks the handoff to show it.

## Autostart flag

`--autostart` (`AUTOSTART_ARG` in `lib.rs`) marks a launch by the OS autostart entry. Only such launches honor start
minimized; a double-click, a shortcut, the in-app restart and the relaunch after an update open the window.

| launch                          | command                                   | `--autostart` |
| ------------------------------- | ----------------------------------------- | ------------- |
| HKCU `Run` value (stub install) | `"…\RalphMeet\RalphMeet.exe" --autostart` | yes           |
| autostart plugin (off Windows)  | registered with `--autostart`             | yes           |
| in-app restart (restart helper) | `windows_relaunch_arguments`: none        | no            |
| installer relaunch after update | the stub, no arguments                    | no            |
| legacy `Update.exe` `Run` value | `--processStart RalphMeet.exe`            | no            |

The root stub forwards its arguments byte for byte, and the installer's `MigrateRunValue` keeps caller arguments, so
the flag reaches the app. Installs whose `Run` value still points at `Update.exe --processStart` do not forward it,
so start minimized does not apply there. The flag is not a `ralphmeet:` URL, so deep-link extraction skips it, and the
restart-helper parser only looks for `--ralph-restart-helper`.

At startup, if open on startup is on, the app reads the current `Run` value (`RegGetValueW`) and rewrites it only
when it differs (ASCII case ignored) from `build_windows_startup_command()`, or is missing. That adds the flag to
values written by older builds.

## Deep links

Every source goes through `route_deep_link`:

| source           | how the URL is found                                                    |
| ---------------- | ----------------------------------------------------------------------- |
| cold start       | `deep_link_from_args(std::env::args())` in `setup`                      |
| second instance  | `deep_link_from_args(argv)` in the single-instance callback             |
| deep-link plugin | `on_open_url` (macOS `Opened` events, or the plugin seeing argv itself) |

`deep_link_from_args` skips `argv[0]` and takes the first argument that parses as a `ralphmeet:` URL, normalized
through `tauri::Url` so the same link from two sources compares equal. The same URL again within 2 s is dropped.

Event contract:

| item                      | value                                                |
| ------------------------- | ---------------------------------------------------- |
| event                     | `rm://deep-link`, emitted once per accepted link     |
| payload                   | `{ "url": "ralphmeet://invite/<code>" }`             |
| before the page listens   | queued in Rust                                       |
| `take_pending_deep_links` | returns the queued URLs and marks the listener ready |

The page has one listener, [`src/lib/desktop-deep-link.ts`](../../src/lib/desktop-deep-link.ts): it listens once per
page, then calls `take_pending_deep_links`. `DesktopDeepLinkBridge` in `src/routes/__root.tsx` subscribes and navigates
to `/invite/$code`. The old `deep-link` and `deep-link://new-url` listeners and the plugin's `getCurrent()` call are
gone.

## Settings

| item       | value                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------- |
| file       | `%APPDATA%\RalphMeet\desktop-settings.json` (`~/.config/RalphMeet/` elsewhere)           |
| write      | temp file `desktop-settings.json.tmp`, then rename over the old one                      |
| read       | once, in `run()`, before the builder; CEF arguments, close to tray and the launch use it |
| unknown    | unknown fields are ignored, missing fields take their defaults                           |
| unreadable | treated as missing (defaults, `persisted: false`)                                        |

```json
{
  "openOnStartup": false,
  "startMinimized": false,
  "closeToTray": true,
  "hardwareAcceleration": true,
  "desktopNotifications": true
}
```

Commands:

| command                           | returns                         | notes                                                  |
| --------------------------------- | ------------------------------- | ------------------------------------------------------ |
| `get_desktop_settings`            | `{ settings, persisted }`       | `persisted` is false until the file was written once   |
| `set_desktop_settings({ patch })` | the full settings now in effect | `patch` holds only the keys to change; writes the file |

`set_desktop_settings` writes or deletes the HKCU `Run` value `RalphMeet` (the autostart plugin off Windows) only when
`openOnStartup` changes; the startup repair above is the only other write. Hardware acceleration takes effect on the next launch. The Zustand store
([`useDesktopSettingsStore.ts`](../../src/stores/useDesktopSettingsStore.ts)) mirrors the settings and keeps its
localStorage copy for first paint and for the web build.

### Migration from localStorage

Before this file existed the frontend owned the settings in localStorage and pushed them to Rust on every start.

1. The main window calls `hydrateDesktopSettings()` on mount (`desktop/desktop-entry.tsx`).
2. It calls `get_desktop_settings`. With `persisted: true` the store takes Rust's values. Done.
3. With `persisted: false` it sends its localStorage values for `openOnStartup`, `startMinimized`, `closeToTray` and
   `desktopNotifications` in one `set_desktop_settings`. Rust writes the file and the store takes the answer.
4. Hardware acceleration is not sent: Rust took it from the old `runtime-settings.json`, which is what CEF used.

The first autostart launch after the upgrade still opens the window if start minimized was on, because the setting
only reaches Rust once the page migrates it; the next autostart launch honors it.
