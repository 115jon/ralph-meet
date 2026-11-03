# Desktop launch flow

How the installed Windows app starts, and what each entry point runs.

## Install root

The installer (`desktop/installer`) installs per user into `%LOCALAPPDATA%\Yap`:

| entry               | what it is                                                                          |
| ------------------- | ----------------------------------------------------------------------------------- |
| `Yap.exe`           | the root launcher stub (`desktop/launcher`), about 380 KB                           |
| `Update.exe`        | a copy of the installer; runs `--uninstall` and the legacy `--processStart Yap.exe` |
| `current.json`      | `currentVersion`, `previousVersion`, `activatedAtUtc`, `pendingCleanup`             |
| `app-<version>\`    | the current and the previous version, each a full app directory                     |
| `staging\`, `logs\` | extraction scratch space; `logs\launcher.log` has one line per stub launch          |

Every payload carries the stub as `app-<version>\YapLauncher.exe`. Each activation copies it to the root
as `Yap.exe`, the same way Squirrel keeps `updater_launcher.exe` in every `app-<version>` of Discord.

## Entry points

Everything the user or the shell starts goes through the root stub:

| entry point                           | command                                                     |
| ------------------------------------- | ----------------------------------------------------------- |
| Start menu and desktop shortcuts      | `Yap.exe`, working directory = install root                 |
| `yap://` handler                      | `"…\Yap\Yap.exe" "%1"`                                      |
| Open on startup (HKCU `Run`)          | `"…\Yap\Yap.exe" --autostart`                               |
| In-app restart, after-update relaunch | the root stub                                               |
| Uninstall (Apps settings)             | `"…\Yap\Update.exe" --uninstall`; `DisplayIcon` is the stub |

`yap://` is the only scheme. `ralphmeet://` is not registered, and the app ignores `ralphmeet://` links.

The stub:

1. Reads `current.json` and starts `app-<currentVersion>\Yap.exe` if it exists.
2. Otherwise (missing or corrupt state, or a version directory that is gone) starts the highest
   `app-<semver>\Yap.exe` that exists.
3. Otherwise runs `Update.exe --processStart Yap.exe`.
4. Otherwise shows an error and exits 1.

The caller's command line after `argv[0]` is passed through unparsed, so deep links and flags reach the app
byte for byte. The working directory is the version directory. Before starting the app the stub calls
`AllowSetForegroundWindow(ASFW_ANY)`: the shell gave the stub the right to take the foreground, and this passes
it on, both to a new app process and to an already running instance that the new process hands off to through
the single-instance plugin. The stub exits as soon as the app process is created; the app process's parent
is the exited stub.

The stub is a separate crate with no Tauri or CEF dependencies (`opt-level = "z"`, LTO, `panic = "abort"`,
Windows subsystem). It embeds the app icon, version information (`FileDescription` and `ProductName`
`Yap`) and an `asInvoker` manifest. Its logic lives in `desktop/launcher/src/launch.rs` and is unit tested.

`Update.exe --processStart Yap.exe` still works, for pins and shortcuts made before the stub existed.

## Taskbar identity

The shortcuts carry the AppUserModelID `com.115jon.yap` (the Tauri `identifier`, which the notification
plugin also uses for toasts), and the installed app sets the same ID on its process before creating a window
(`set_windows_app_user_model_id` in `desktop/src-tauri/src/lib.rs`). The taskbar groups the window with the
shortcut, and a pin made from the running window starts the root stub instead of `app-<version>\Yap.exe`,
which a later update deletes. Dev builds, which do not run from an `app-*` directory, keep the default identity.

## Updates

The in-app updater (`tauri-plugin-updater`) downloads `YapSetup.exe`, runs it with `/S`, and exits. The
installer stops the running app, extracts the payload to `staging\`, moves it to `app-<version>\`, writes
`current.json` (the previous version stays as `previousVersion` for rollback; older directories are deleted),
refreshes the root stub, rewrites shortcuts and registry entries, and starts the app through the stub.

The stub is replaced in place when possible. If it is locked (for example while it is still starting the app),
it is renamed to `Yap.exe.old` and the new copy takes its place; `.old` copies are deleted on a later
activation. If it can be neither replaced nor renamed, the old stub stays: it reads `current.json`, so it starts
the new version anyway.

## Migration from Update.exe launches

Installs made before the stub launched everything through `Update.exe --processStart Yap.exe`. The first
update that ships the stub moves them over:

- Start menu and desktop shortcuts and the `yap://` handler are rewritten on every install.
- The HKCU `Run` value `Yap` is rewritten if it points into this install (`Update.exe` or an
  `app-<version>\Yap.exe`). The app writes it when the open-on-startup setting changes, and at
  startup when the setting is on and the value differs from the current command (which adds `--autostart`); see
  [window-shell.md](window-shell.md).
- Taskbar pins in `%APPDATA%\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar` that point into this
  install are retargeted to the stub and given the AppUserModelID. Other pins are not touched.
- Uninstall removes the `Run` value if it belongs to this install, and the `yap://` handler
  if it is the stub or the old `Update.exe` form.

## Migration from Ralph Meet

The app was renamed from Ralph Meet to Yap (install root, data folder, executable, registry names, identifier).
An existing `%LOCALAPPDATA%\RalphMeet` install is cleaned up by the normal install, interactive or the silent
`/S` path the old in-app updater runs, after the new version is activated. `YapSetup.exe --cleanup-legacy` runs
the same cleanup on its own. In order:

1. Stop running `RalphMeet` processes.
2. Activate the new version in `%LOCALAPPDATA%\Yap`.
3. Move `%APPDATA%\RalphMeet` into `%APPDATA%\Yap`: the whole folder when `Yap` does not exist yet, otherwise each
   top-level entry that is not already present in `Yap`. Colliding entries stay in the old folder, which is
   removed only once it is empty. `logs` is disposable.
4. Carry the `RalphMeet` Run value over to `Yap`.
5. Retarget legacy taskbar pins to the new stub.
6. Remove the `RalphMeet` shortcuts, uninstall key, publisher key and legacy Vulkan layer registrations, and delete
   the `HKCU\Software\Classes
alphmeet` key whatever it points at.
7. Delete the known install entries of `%LOCALAPPDATA%\RalphMeet`: `Update.exe`, `current.json`, `RalphMeet.exe*`,
   `app.ico`, `app-*`, `staging`, `logs`, `capture-hook`, `obs-capture`. A legacy `cef` profile folder there
   (very old builds) is moved to `%APPDATA%\Yap\cef` when Yap has no profile, and kept otherwise. Unknown
   entries are kept, and the folder stays until it is empty.
8. Register `yap://` to `Yap.exe`.

Each step is safe to repeat, and a failure in steps 3 to 7 is logged without failing the install.
The CEF profile folder name is set in the tauri-fork (`WINDOWS_CEF_PROFILE_DIR_NAME` in
`crates/tauri-runtime-cef/src/lib.rs`) and must match the productName.

The uninstaller removes both the `Yap` install and any `RalphMeet` leftovers, and keeps user data.

The app itself, on first run, moves `%APPDATA%\RalphMeet` into `%APPDATA%\Yap` before CEF starts when the
installer did not (dev and portable runs).

## Testing on a sandbox root

Setting `YAP_SANDBOX_ROOT` (the installer still honors `RALPHMEET_SANDBOX_ROOT` as a fallback) redirects the
installer for tests and local verification: the install root is that directory, shortcuts, taskbar pins, the
legacy directory and installer logs go to `<root>.sandbox\`, the registry goes under
`HKCU\Software\115jon\YapSandbox`, and running processes are matched only by path inside the sandbox root (the
by-name stop of `Yap` and `RalphMeet` processes is skipped). A sandbox install never touches or stops the real
one. Use a stand-in `Yap.exe` in the sandbox payload: the real app would hand off to an already running instance
through the single-instance plugin.

## Follow-up: payload-free Update.exe

`Update.exe` is still a full copy of the installer, payload included (about 140 MB). It now only runs
`--uninstall` and the legacy `--processStart`, so it could be a build of the installer without the embedded
payload (about 1 MB). That needs a second installer build in `build-installer.ps1` and `desktop-release.yml`
whose output the full installer embeds and writes as `Update.exe`, with the current self-copy as a fallback.
Not done here.
