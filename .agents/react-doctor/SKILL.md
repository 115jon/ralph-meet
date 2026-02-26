---
name: react-doctor
description: Run after making React changes to catch issues early and optimize performance. Use when reviewing code, finishing a feature, or fixing bugs.
version: 1.1.0
---

# React Doctor

Scans your React codebase for security, performance, correctness, and architecture issues. Outputs a 0-100 score with actionable diagnostics.

## Usage

### Scan (Full Project)
```bash
npx -y react-doctor@latest . --verbose
```

### Optimize (Changed Files Only)
```bash
npx -y react-doctor@latest . --verbose --diff
```

## Optimization Workflow

1. **Run Doctor**: Get the current health score.
2. **Fix Errors**: Address all `✗` errors first (A11y, correctness).
3. **Apply Performance Tips**:
   - Replace `<img>` with `next/image`.
   - Extract default prop literals (`[]`, `{}`) to module-level constants.
   - Use `useReducer` for components with many `useState` calls.
   - Remove unnecessary `useMemo` on cheap expressions.
4. **Verify**: Re-run to see the score improve.

## Advanced Tips

- **Fix hydration flashes**: For theme-dependent or client-only components, use `suppressHydrationWarning` on the wrapper and provide a sensible SSR default instead of returning `null` or a generic loader.
- **Handle large assets**: For extremely large SVGs (e.g., >100kb), keep them as strings and use `dangerouslySetInnerHTML` with `aria-hidden="true"` to avoid JSX bundle bloat, but prioritize standard `next/image` for normal images.
- **Form optimization**: Use Server Actions for progressive enhancement where possible, especially if fixing `preventDefault()` warnings.

> [!TIP]
> Use `. --verbose` to see exactly where issues are located.
