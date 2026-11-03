# Code Signing Policy

Yap's Windows release binaries are Authenticode-signed with
[Azure Artifact Signing](https://learn.microsoft.com/azure/artifact-signing/)
(formerly Trusted Signing). The Public Trust certificate is issued to the
maintainer as an individual developer after Microsoft identity validation, so the
signer is `Jonathan Martinez` (Chicago, Illinois, US). Certificates are
short-lived and renewed by the service. Every signature carries an RFC 3161
timestamp from `timestamp.acs.microsoft.com`, so it stays valid after the
certificate that made it expires.

## Signing roles

| Role      | Responsibility                                           | Member                              |
| --------- | -------------------------------------------------------- | ----------------------------------- |
| Committer | Maintains the source code and release configuration      | [115jon](https://github.com/115jon) |
| Reviewer  | Reviews changes from contributors who are not committers | [115jon](https://github.com/115jon) |
| Approver  | Approves each release by merging the release PR          | [115jon](https://github.com/115jon) |

The three roles are currently held by the same maintainer. Contributions from
other people still require maintainer review before merge. Automated tools may
assist review but do not hold a signing role.

## Signing scope

The release workflow (`.github/workflows/desktop-release.yml`) signs:

| File                                                                 | Origin                                                      |
| -------------------------------------------------------------------- | ----------------------------------------------------------- |
| `app-<version>\Yap.exe` (the app, built as `ralph-meet-desktop.exe`) | this repository                                             |
| Root `Yap.exe` / `YapLauncher.exe` (launcher stub)                   | this repository (`desktop/launcher`)                        |
| `YapSetup.exe` (installer, also kept as `Update.exe`)                | this repository (`desktop/installer`)                       |
| `libcef.dll`, `chrome_elf.dll`, `bootstrap.exe`, `bootstrapc.exe`    | the project's custom CEF build (`cef-build-assets` release) |

It never signs or re-signs the OBS Studio capture files
(`obs-capture/obs-signed/graphics-hook*.dll`, `inject-helper*.exe`,
`get-graphics-offsets*.exe`). They ship byte-for-byte as OBS released them and
keep the OBS Project, LLC signature that anti-cheat vendors allowlist.
`desktop/scripts/stage-payload.ps1` fails the build if their hashes differ from
`desktop/packaging/obs-signed-hook.lock.json`. Other bundled runtime files
(DirectX, ANGLE and SwiftShader DLLs, data files) ship as received.

## Release controls

Each release follows this sequence:

1. The maintainer merges the release-please PR on `main`. Release-please tags the
   release and calls the desktop release workflow on a GitHub-hosted runner.
2. The workflow signs in to Azure with a GitHub OIDC token. The Entra app
   registration trusts only this repository's `main` branch and `v*` tags, and
   holds only the Artifact Signing Certificate Profile Signer role. No Azure
   secret is stored in GitHub.
3. CI signs the app, launcher, and custom CEF binaries before packing the
   payload, then signs `YapSetup.exe` once the installer is built.
4. `desktop/scripts/verify-authenticode.ps1` runs `signtool verify /pa` on every
   signed file and checks the signer name and timestamp. Any failure stops the
   release.
5. Only then does CI cover the signed installer with the Tauri updater
   (minisign) signature in `latest.json`, upload it, and publish the release.

## Privacy policy

Yap's privacy policy is available at [PRIVACY.md](PRIVACY.md) and will be
published at <https://yap.115jon.com/privacy>. The installer must present this
policy and required choices before a first installation that enables automatic
data transfers.

## Verification and incident response

Check a download with `signtool verify /pa YapSetup.exe`, or in the file's
Properties → Digital Signatures tab. The signer must be `Jonathan Martinez`.

Report suspected malicious artifacts, signing-policy violations, or certificate
concerns to <115jon@proton.me> and through the project's security-reporting
channel. The maintainer will investigate, preserve relevant release evidence,
and ask Microsoft to revoke the affected certificate if a signature was misused.
