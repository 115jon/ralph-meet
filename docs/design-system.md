# Ralph Meet design system

This file used to hold the Quiet Pro rules. The Talk Tree redesign replaced
them, and the system now lives in [`DESIGN.md`](../DESIGN.md) at the
repository root.

- **Tokens:** `src/styles/tokens.css`. The contrast contract test,
  `src/styles/__tests__/theme-contract.test.ts`, covers all six themes.
- **Motion and idle rules:** `src/styles/motion.css`, plus the budget in
  `scripts/idle-probe.mjs` (`pnpm idle-probe`).
- **Primitives:** `src/components/ui/`.
- **Specimen page:** `/ui-fixtures?surface=foundation` (dev only).
- **Checker:** `scripts/audit-design-system.mjs` still enforces the rules a
  regex can see (no hex, no arbitrary px sizes, no palette hues).

The Quiet Pro audit in `docs/design-audit.md` is kept as history. Its findings
predate Talk Tree.
