# Desktop launch flow

How the installed Windows app starts, and what each entry point runs.

## Install root

The installer (`desktop/installer`) installs per user into `%LOCALAPPDATA%\RalphMeet`:

| entry               | what it is                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `RalphMeet.exe`     | the root launcher stub (`desktop/launcher`), about 380 KB                                 |
| `Update.exe`        | a copy of the installer; runs `--uninstall` and the legacy `--processStart RalphMeet.exe` |
| `current.json`      | `currentVersion`, `previousVersion`, `activatedAtUtc`, `pendingCleanup`                   |
| `app-<version>\`    | the current and the previous version, each a full app directory                           |
| `staging\`, `logs\` | extraction scratch space; `logs\launcher.log` has one line per stub launch                |

Every payload carries the stub as `app-<version>\RalphMeetLauncher.exe`. Each activation copies it to the root
as `RalphMeet.exe`, the same way Squirrel keeps `updater_launcher.exe` in every `app-<version>` of Discord.

## Entry points

Everything the user or the shell starts goes through the root stub:

| entry point                           | command                                                           |
| ------------------------------------- | ----------------------------------------------------------------- |
| Start menu and desktop shortcuts      | `RalphMeet.exe`, working directory = install root                 |
| `ralphmeet://` handler                | `"…\RalphMeet\RalphMeet.exe" "%1"`                                |
| Open on startup (HKCU `Run`)          | `"…\RalphMeet\RalphMeet.exe" --autostart`                         |
| In-app restart, after-update relaunch | the root stub                                                     |
| Uninstall (Apps settings)             | `"…\RalphMeet\Update.exe" --uninstall`; `DisplayIcon` is the stub |

The stub:

1. Reads `current.json` and starts `app-<currentVersion>\RalphMeet.exe` if it exists.
2. Otherwise (missing or corrupt state, or a version directory that is gone) starts the highest
   `app-<semver>\RalphMeet.exe` that exists.
3. Otherwise runs `Update.exe --processStart RalphMeet.exe`.
4. Otherwise shows an error and exits 1.

The caller's command line after `argv[0]` is passed through unparsed, so deep links and flags reach the app
byte for byte. The working directory is the version directory. Before starting the app the stub calls
`AllowSetForegroundWindow(ASFW_ANY)`: the shell gave the stub the right to take the foreground, and this passes
it on, both to a new app process and to an already running instance that the new process hands off to through
the single-instance plugin. The stub exits as soon as the app process is created; the app process's parent
is the exited stub.

The stub is a separate crate with no Tauri or CEF dependencies (`opt-level = "z"`, LTO, `panic = "abort"`,
Windows subsystem). It embeds the app icon, version information (`FileDescription` and `ProductName`
`RalphMeet`) and an `asInvoker` manifest. Its logic lives in `desktop/launcher/src/launch.rs` and is unit tested.

`Update.exe --processStart RalphMeet.exe` still works, for pins and shortcuts made before the stub existed.

## Taskbar identity

The shortcuts carry the AppUserModelID `site.115jon.ralphmeet` (the Tauri `identifier`, which the notification
plugin also uses for toasts), and the installed app sets the same ID on its process before creating a window
(`set_windows_app_user_model_id` in `desktop/src-tauri/src/lib.rs`). The taskbar groups the window with the
shortcut, and a pin made from the running window starts the root stub instead of `app-<version>\RalphMeet.exe`,
which a later update deletes. Dev builds, which do not run from an `app-*` directory, keep the default identity.

## Updates

The in-app updater (`tauri-plugin-updater`) downloads `RalphMeetSetup.exe`, runs it with `/S`, and exits. The
installer stops the running app, extracts the payload to `staging\`, moves it to `app-<version>\`, writes
`current.json` (the previous version stays as `previousVersion` for rollback; older directories are deleted),
refreshes the root stub, rewrites shortcuts and registry entries, and starts the app through the stub.

The stub is replaced in place when possible. If it is locked (for example while it is still starting the app),
it is renamed to `RalphMeet.exe.old` and the new copy takes its place; `.old` copies are deleted on a later
activation. If it can be neither replaced nor renamed, the old stub stays: it reads `current.json`, so it starts
the new version anyway.

## Migration from Update.exe launches

Installs made before the stub launched everything through `Update.exe --processStart RalphMeet.exe`. The first
update that ships the stub moves them over:

- Start menu and desktop shortcuts and the `ralphmeet://` handler are rewritten on every install.
- The HKCU `Run` value `RalphMeet` is rewritten if it points into this install (`Update.exe` or an
  `app-<version>\RalphMeet.exe`). The app writes it when the open-on-startup setting changes, and at
  startup when the setting is on and the value differs from the current command (which adds `--autostart`); see
  [window-shell.md](window-shell.md).
- Taskbar pins in `%APPDATA%\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar` that point into this
  install are retargeted to the stub and given the AppUserModelID. Other pins are not touched.
- Uninstall removes the `Run` value if it belongs to this install, and the `ralphmeet://` handler if it is the
  stub or the old `Update.exe` form.

## Testing on a sandbox root

Setting `RALPHMEET_SANDBOX_ROOT` redirects the installer for tests and local verification: the install root is
that directory, shortcuts, taskbar pins, the legacy directory and installer logs go to `<root>.sandbox\`, the
registry goes under `HKCU\Software\115jon\RalphMeetSandbox`, and running processes are matched only by path
inside the sandbox root (the by-name stop of `RalphMeet` processes is skipped). A sandbox install never touches
or stops the real one. Use a stand-in `RalphMeet.exe` in the sandbox payload: the real app would hand off to an
already running instance through the single-instance plugin.

## Follow-up: payload-free Update.exe

`Update.exe` is still a full copy of the installer, payload included (about 140 MB). It now only runs
`--uninstall` and the legacy `--processStart`, so it could be a build of the installer without the embedded
payload (about 1 MB). That needs a second installer build in `build-installer.ps1` and `desktop-release.yml`
whose output the full installer embeds and writes as `Update.exe`, with the current self-copy as a fallback.
Not done here.
