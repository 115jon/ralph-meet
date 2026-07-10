# Ralph Meet

Ralph Meet is an open-source real-time communication application for chat,
voice, video, screen sharing, and user-authorized game capture.

[Web app](https://meet.115jon.site) ·
[Windows releases](https://github.com/115jon/ralph-meet/releases) ·
[Source repository](https://github.com/115jon/ralph-meet)

## Highlights

- Chat, voice, video, screen sharing, and room-based collaboration.
- A Windows desktop client built with Tauri and a custom CEF/Chromium
  runtime.
- Optional game capture using a separately licensed OBS Studio `win-capture`-
  derived component.
- Cloudflare-backed realtime services with a web client and desktop client.

## Getting started

Open the [web app](https://meet.115jon.site), or download the latest Windows
installer from the [GitHub Releases page](https://github.com/115jon/ralph-meet/releases).

Release notes and version history are kept in [CHANGELOG.md](CHANGELOG.md).

## Desktop release contents

The desktop client includes a custom CEF/Chromium runtime and an in-repository
Tauri fork. The optional capture feature ships separately built
OBS-derived hook and helper binaries. Their source, attribution, license text,
and written source offer are documented in
[`desktop/src-tauri/resources/obs-capture`](desktop/src-tauri/resources/obs-capture)
and [desktop third-party notices](desktop/THIRD_PARTY_LICENSES.md).

The capture component injects a graphics hook into a user-selected game process
to capture that process. It is not a security scanner, exploit tool, or bypass
tool.

## Documentation and policies

- [Privacy Policy](PRIVACY.md)
- [Code Signing Policy](CODE_SIGNING_POLICY.md)
- [Security Policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Desktop third-party notices](desktop/THIRD_PARTY_LICENSES.md)

## Development

Install dependencies with the repository's pinned package manager and run the
available validation commands:

```powershell
pnpm lint
pnpm typecheck
pnpm test
```

Do not use locally built desktop or CEF artifacts as release-signing inputs.
Release provenance must be verified by the repository's release workflow.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Changes
to installer behavior, release workflows, signing configuration,
authentication, CEF provenance, policies, or game capture require maintainer
review.

## License

Ralph Meet-owned source is distributed under the GNU General Public License,
version 3 or later (`GPL-3.0-or-later`). The OBS-derived capture component
remains separately licensed under GPL-2.0-only. The canonical root license is
in [LICENSE](LICENSE).
