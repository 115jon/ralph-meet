# anti-slop provenance

- Source repository: https://github.com/dmmulroy/anti-slop
- Source commit: `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`
- Copied tree: `skills/install-anti-slop/assets/anti-slop` at that commit (the install script's bundle, not a later HEAD)
- Installed path: `tools/oxlint/anti-slop`
- Entry point: `tools/oxlint/anti-slop/index.ts`
- Dependencies: `oxlint@1.85.0` and `@oxlint/plugins@1.85.0`, pinned exact, matching the version the bundle was validated against.
- Effect plugin: `effect/index.ts`, registered next to the main plugin in `oxlint.config.ts`. Ralph Meet has no Effect code yet, so those rules sit at `error` and only start to matter once Effect is adopted.
- Provenance: copied from the dt-estimator install of the same commit, with CRLF line endings normalised to LF. No rule source was edited.
- Local rule edits: none.
- Formatting and typecheck: the whole tree is excluded from `oxfmt` (`.oxfmtrc.json`), keeps its upstream tab indentation, and is outside the `tsc` project (`tsconfig.json` only includes `src/**` and `vite.config.ts`).
- Extra ignore patterns beyond the skill defaults: none needed in Ralph Meet.
