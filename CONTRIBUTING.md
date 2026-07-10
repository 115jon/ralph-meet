# Contributing to Ralph Meet

Contributions are welcome through GitHub pull requests. Keep changes scoped,
include focused tests where behavior changes, and do not add generated binaries
or locally built release payloads to the repository.

## Before opening a pull request

- Read the [Code of Conduct](CODE_OF_CONDUCT.md) and [Security Policy](SECURITY.md).
- Use the repository's pinned `pnpm` toolchain.
- Run the relevant lint, typecheck, and focused test commands.
- Explain changes to installer behavior, native code, release workflows, or
  bundled third-party components in the pull request description.

## Review expectations

One pull request should contain one logical change. Changes to installer
behavior, release workflows, signing configuration, authentication, CEF runtime
provenance, policies, or game capture require explicit maintainer review before
merge. Do not commit directly to `main` or bypass review for release-sensitive
files.

By submitting a contribution, you confirm that you have the right to contribute
it under the license applicable to the files you change. Ralph Meet-owned source
is distributed under GPL-3.0-or-later; the OBS-derived capture subtree remains
GPL-2.0-only.
