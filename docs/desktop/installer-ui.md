# Installer window

The window `RalphMeetSetup.exe` shows during an interactive install or uninstall. Silent runs
(`/S`, `--silent`, `--passive`, and `--uninstall` with one of them) show no window, as before.
The install itself is unchanged; this covers only the presentation layer.

## Look

It is the app's updater window grown into a setup plate, built from the Talk Tree tokens in
`src/styles/tokens.css` and the rules in `DESIGN.md`:

- **Canvas**: `ply-0` with a 1px `line-strong` edge, square corners, our own 40px title bar
  (`WindowChrome`, so it drags and snaps like a native caption) with a silkscreen label and
  40px minimize and close keys (Phosphor Bold `minus` and `x`).
- **Mark**: the `DitherGlyph` "mark" motif. The logo (`Assets/LogoGeometry.xaml`) printed in
  accent ink through the 32-cell Bayer ramp, 70 percent resolved while anything is pending and
  whole when it is done. It never moves.
- **Type**: a silkscreen kicker (Martian Mono 11, condensed on dark and wide on light), a
  Bricolage 800 28/32 title, a Geist 15/22 status line, Martian tabular readouts, Bricolage 600
  key labels. The fonts are embedded (below).
- **Progress**: a 4px `tint-2` track whose accent fill grows by `scaleX`, a `163 / 407 MB` and
  percent readout, and a steps tree (Unpack files, Add shortcuts and links, Start Ralph Meet or
  Finish) drawn like the app's tree: 1px guides, the current leaf's path lit in accent, LEDs
  that light talk green when a step is done and red when it failed.
- **Keys**: the notched primary with its dithered cap (Try again), the paired secondary (Close,
  Cancel), danger fill for Uninstall. Hover and press are ink overlays; focus is a 2px accent
  ring at a 2px offset.
- **Failure**: an LED status word, the error message (with the missing file's name when the
  exception carries one), and an "Installer log" legend plate with the path as selectable text
  plus Copy path and Open log keys. Try again re-runs the install (or the uninstall); Close
  quits. Enter and Esc map to them.

Themes follow Windows: the light palette when "Choose your app mode" is Light, dark otherwise,
and system colours under high contrast (the dither is hidden there, as in the app). A theme
change while the window is open applies at once.

## Progress

`PayloadExtractor` reports payload bytes through `InstallProgress.PayloadProgress` as it writes
them (a side channel: nothing in the install waits on a listener). The window coalesces those
reports into one UI update at a time and eases the fill to each new value in 250ms. The steps
after extraction (activation, registry, shortcuts, launch) are not reported separately: the
window shows them as one "Add shortcuts and links" step, with the meter full, until
`RunInstallationAsync` returns. "Getting ready" (stopping a running app, cleaning up) and
uninstalling have nothing to measure and show a sliding segment instead.

## Motion

Opacity and transforms only: a new screen fades in and settles 4px in 200ms, the fill eases
over 250ms, a pressed key scales to 0.97. The indeterminate segment is the only loop, and only
while waiting. With Windows' "Animation effects" off (`SystemParameters.ClientAreaAnimation`)
all of it is off: values are set at once and the segment is hidden.

## Window

- Per-monitor v2 DPI awareness (`app.manifest`, which also restates `asInvoker`, the compiler's
  default).
- Closing the window (Alt+F4, the system menu, the taskbar) is ignored while an install or
  uninstall is running, so it can't stop halfway.
- No layered window (`AllowsTransparency` is off), so WPF renders it on the GPU directly.
- Keyboard: Tab moves through the keys (footer, then the log plate, then the title bar keys),
  Enter is the primary key, Esc the secondary. Every key and the progress bar has an automation
  name, the status line is a polite live region, and each step announces its state.

## Fonts

WPF on .NET Framework reads neither WOFF2 nor variable-font instances, so
`desktop/scripts/build-installer-fonts.py` cuts static instances from the app's Fontsource
packages (`pip install fonttools brotli`, then run it with the path to `node_modules`):
Bricolage 800 at opsz 28 (titles) and 600 at opsz 15 (keys), Geist 400 and 500, Martian Mono
500 at wdth 90 and 600 at wdth 100 (silkscreen, with the 0.08em and 0.10em tracking baked into
the advances because WPF has no letter-spacing) and 500 at wdth 100 (numbers). They are
renamed `RM ...`, subset to Latin, about 180 KB together, and compiled in as `Resource` items,
so the exe stays one file. All three families are SIL OFL 1.1 (`Assets/Fonts/OFL.txt`).

## Libraries

None. WPF-UI 4.3 (`Wpf.Ui.dll`, 6.5 MB for net462) and ModernWpf 0.9.6 (1.6 MB in two DLLs
plus satellite assemblies, unmaintained since 2022) were considered. Both bring Fluent styling
(rounded corners, Mica, accent fills) that the Talk Tree design would have to override almost
entirely, and both would need Costura or ILRepack to stay one exe, which adds a load-time
decompression step. The hand-rolled styles in `Ui/Styles.xaml` cost about 35 KB.

## Previewing states

Debug builds take two extra arguments, handled before the logger starts, so nothing is
installed and no log is written:

```powershell
dotnet build desktop/installer -c Debug
$exe = "desktop/installer/bin/Debug/net48/RalphMeetSetup.exe"
& $exe --preview installing            # also: preparing, setting-up, installed, installed-nolaunch,
                                       # error, uninstall, uninstalling, uninstalled, uninstall-error
& $exe --preview error --theme light   # dark, light or contrast
& $exe --capture C:\temp\installer-ui  # every state, dark and light, to PNG
& $exe --capture C:\temp\installer-ui --scale 1.5 --theme dark
```

Release builds compile none of this. To watch a real install, run it against a sandbox root
(`RALPHMEET_SANDBOX_ROOT`, see [launch.md](launch.md)) with a test payload and `/NoLaunch`.
