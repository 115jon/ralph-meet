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

## Writing the pull request

- Title: a conventional commit in plain language, such as
  `fix(voice): rejoining no longer leaves one-way audio`.
- Body: follow `.github/pull_request_template.md` (Problem, Change,
  Verification). Write it as a record for reviewers, not a message to the
  person who asked for the work: no "you can…", "let me know", questions,
  progress narration, or sign-offs. Anything meant for that person goes in
  the conversation, not the PR.
- Verification lists the checks actually run and what they showed, and names
  what was not checked. UI changes need before/after screenshots; motion or
  timing needs a short recording. Upload evidence to the PR; never commit
  PR-only assets.
- No AI attribution: no `Co-Authored-By` trailers, "Generated with" footers,
  or model and harness credits in commits or PRs.
- One request is one PR unless a split is asked for.

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
