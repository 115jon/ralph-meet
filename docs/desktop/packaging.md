# Desktop packaging

How the Windows installer (`RalphMeetSetup.exe`) gets its files, and how CI checks them.

## What ships

One file defines it: [`desktop/packaging/payload-manifest.json`](../../desktop/packaging/payload-manifest.json).
Each entry names a `source` and a path to copy (`to` defaults to `from`):

| source      | directory                          | what comes from it                                                |
| ----------- | ---------------------------------- | ----------------------------------------------------------------- |
| `cef`       | `CEF_PATH` (`D:\cef` in CI)        | the 17 CEF root files and the whole `locales` directory           |
| `release`   | `desktop/src-tauri/target/release` | `ralph-meet-desktop.exe` (as `RalphMeet.exe`) and `obs-capture/*` |
| `resources` | `desktop/src-tauri/resources`      | the GPLv2 documents in `obs-capture/`                             |

`obs-capture/` holds the six OBS hook/injector binaries, the two Vulkan layer JSONs, and `LICENSE-GPLv2.txt`,
`ATTRIBUTION.md` and `SOURCE-OFFER.md`. Nothing is dropped for size: every CEF locale and rendering DLL ships.

Changing what ships means editing the manifest. Three things read it:

- `desktop/scripts/stage-payload.ps1` stages and packs the payload (below).
- `desktop/src-tauri/build.rs` copies the `cef` entries into `target/<profile>` for dev runs when `CEF_PATH` is set.
- `build.rs` (with `game-capture-hook`) fails the build unless every `REQUIRED_MATERIALS` name from
  `build_support/packaging_guard.rs` is in the manifest under `obs-capture/`.

### GPL obligation

The OBS-derived hook and injector are GPL-2.0-only. The license text, attribution and written source offer must
be installed next to them, in `obs-capture\`. They are checked-in files under `resources/obs-capture/`, but they
used to be missing from the installed app because only the built binaries were copied from `target/release`. The
manifest now ships them, and the build fails if they are dropped. See `desktop/THIRD_PARTY_LICENSES.md`.

## Payload format (RMPK v1)

The installer embeds `Assets/payload.rmpk` as a resource instead of a zip. It is LZMA, with no extra DLLs: the
LZMA SDK sources (`desktop/packaging/Shared/Lzma`, public domain) and the container code
(`desktop/packaging/Shared/Rmpk`) are compiled into both the installer and the packer.

All integers are little-endian.

```
header   "RMPK", u32 version=1, u32 blockSize, u32 fileCount, u32 blockCount, u64 totalSize
         files[]  : u16 pathLength, UTF-8 relative path ('/' separated), u64 size
         blocks[] : u32 compressedLength, u32 rawLength, u8[5] lzmaProps, u8[32] sha256(raw block)
         u8[32]   : sha256 of every header byte above
payload  the block streams, concatenated (raw LZMA, no end marker)
```

Files are laid end to end in table order (sorted by path) and that byte stream is cut into 48 MiB blocks, each
compressed alone with a 48 MiB dictionary. Blocks share nothing, so the installer decodes up to
`min(cores, 4)` of them in parallel, checks each block's SHA-256, and fails the install on a mismatch. A bad
header checksum or inconsistent sizes also fails. Extraction keeps the old behavior: entries that resolve
outside the install directory are skipped, and opening each destination file is retried 5 times with lock
diagnostics. Empty directories are not represented; every file has an entry, including empty ones.

An x86 BCJ filter was measured (about 2.3 MB on the PE files) and left out: it is under the 3 MB bar and adds a
reversible transform to maintain.

## Building locally

`desktop/scripts/build-installer.ps1` does the whole thing. To run only the payload step after a release build:

```powershell
.\desktop\scripts\stage-payload.ps1 -CefDir D:\cef       # stages, packs, then decodes and compares
.\desktop\scripts\stage-payload.ps1 -CefDir D:\cef -NoPack   # validate the manifest only
```

It fails listing every missing file. The packer can also be run by hand (`dotnet build desktop/packaging/PayloadPacker`):
`PayloadPacker pack|extract|verify`, with `--block-mb`, `--dict-mb`, `--fast-bytes`, `--threads`.
Then `dotnet build desktop/installer/installer.csproj -c Release` embeds the payload if `payload.rmpk` exists.
The `payload.rmpk` file is git-ignored.

## How CI checks it

`desktop-validation.yml` (on changes under `desktop/`, including the installer, packaging and scripts):

- `installer` job (Windows): `dotnet test desktop/installer.tests` (pack/extract roundtrip across several blocks,
  corruption, path traversal, locked-file retry) and `desktop/scripts/test-payload-pipeline.ps1`, which runs the
  manifest, stage script and packer on synthetic inputs and checks that a missing file fails staging.
- `desktop` job: builds the OBS capture binaries, then `cargo check` with the shipped features
  (`cef,native-screen-share,game-capture-hook`) whose `build.rs` also enforces the manifest check above.

`desktop-release.yml` runs the installer tests, stages and packs through `stage-payload.ps1`, checks that the
built installer is larger than its payload, and runs `desktop/scripts/validate-latest-json.ps1` before
publishing. That script requires the updater manifest's version to match `tauri.conf.json` and the tag, the URL
to end in `/releases/download/<tag>/RalphMeetSetup.exe`, `pub_date` to be UTC, and the signature to be a
minisign signature whose key id matches the updater public key. It does not verify the signature itself, since
the Tauri CLI has no verify command.
