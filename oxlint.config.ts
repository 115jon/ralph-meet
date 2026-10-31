import { defineConfig } from "oxlint";

/**
 * Oxlint replaces the old ESLint setup. Where each rule family comes from:
 *
 * - ESLint `js.configs.recommended` and typescript-eslint `recommended` are
 *   native Oxlint rules, listed explicitly so parity does not depend on which
 *   rules Oxlint's `correctness` category happens to contain.
 * - `react/rules-of-hooks` and `react/exhaustive-deps` are native. They report
 *   under the `react-hooks` scope, so the existing
 *   `eslint-disable react-hooks/exhaustive-deps` comments keep working.
 * - The React Compiler rules run through the real `eslint-plugin-react-hooks`
 *   as a JS plugin (alias `react-hooks-js`). Oxlint 1.85 ships native ports of
 *   most of them, but the ports flag code the real compiler accepts (56
 *   findings in this repo), and `component-hook-factories` has no native port.
 *   `react-hooks` itself is a reserved plugin name, which is why the alias
 *   exists: suppressions for these rules must say `react-hooks-js/<rule>`.
 * - `react-refresh/only-export-components` also runs as a JS plugin: it
 *   reproduces ESLint's count exactly and keeps `react-refresh/...` disables
 *   valid, while the native `react/only-export-components` differs by one.
 * - TanStack Router rules run as a JS plugin (alias `tanstack-router`).
 * - anti-slop rules are the vendored plugins under tools/oxlint/anti-slop.
 *
 * Scope: ESLint ignored realtime/, desktop/ and mobile/. realtime/ is linted
 * now (0 errors, 50 warnings, mostly anti-slop ratchets). desktop/ and mobile/
 * stay ignored because their vendored Tauri plugin code produces errors we
 * cannot fix locally.
 */
export default defineConfig({
  ignorePatterns: [
    "node_modules/**",
    "dist/**",
    "coverage/**",
    ".output/**",
    ".vinxi/**",
    ".wrangler/**",
    ".lighthouseci/**",
    "target-test/**",
    "public/mediapipe/**",
    "packages/*/dist/**",
    "desktop/**",
    "mobile/**",
    "src/routeTree.gen.ts",
    // Third-party minified yt-dlp solver payloads are consumed as opaque
    // runtime assets; linting them creates hundreds of non-actionable
    // diagnostics that cannot be repaired locally.
    "src/lib/ytdlp/assets/*.min.js",
    // Vendored third-party plugin sources; they keep upstream style.
    "tools/oxlint/anti-slop/**",
    // Local agent tooling directories.
    ".agent/**",
    ".agents/**",
    ".claude/**",
    ".codex/**",
    ".cursor/**",
    ".impeccable/**",
    ".mira/**",
    ".opencode/**",
  ],
  plugins: ["typescript", "react"],
  env: { browser: true, es2022: true },
  jsPlugins: [
    "eslint-plugin-react-refresh",
    { name: "react-hooks-js", specifier: "eslint-plugin-react-hooks" },
    { name: "tanstack-router", specifier: "@tanstack/eslint-plugin-router" },
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    {
      name: "anti-slop-effect",
      specifier: "./tools/oxlint/anti-slop/effect/index.ts",
    },
  ],
  rules: {
    // ── ESLint js.configs.recommended ────────────────────────────────────
    "constructor-super": "error",
    "for-direction": "error",
    "getter-return": "error",
    "no-async-promise-executor": "error",
    "no-case-declarations": "error",
    "no-class-assign": "error",
    "no-compare-neg-zero": "error",
    "no-cond-assign": "error",
    "no-const-assign": "error",
    "no-constant-binary-expression": "error",
    "no-constant-condition": "error",
    "no-control-regex": "error",
    "no-debugger": "error",
    "no-delete-var": "error",
    "no-dupe-class-members": "error",
    "no-dupe-else-if": "error",
    "no-dupe-keys": "error",
    "no-duplicate-case": "error",
    "no-empty": ["error", { allowEmptyCatch: true }],
    "no-empty-character-class": "error",
    "no-empty-pattern": "error",
    "no-empty-static-block": "error",
    "no-ex-assign": "error",
    "no-extra-boolean-cast": "error",
    "no-fallthrough": "error",
    "no-func-assign": "error",
    "no-global-assign": "error",
    "no-import-assign": "error",
    "no-invalid-regexp": "error",
    "no-irregular-whitespace": "error",
    "no-loss-of-precision": "error",
    "no-misleading-character-class": "error",
    "no-new-native-nonconstructor": "error",
    "no-nonoctal-decimal-escape": "error",
    "no-obj-calls": "error",
    "no-prototype-builtins": "error",
    "no-redeclare": "error",
    "no-regex-spaces": "error",
    "no-self-assign": "error",
    "no-setter-return": "error",
    "no-shadow-restricted-names": "error",
    "no-sparse-arrays": "error",
    "no-this-before-super": "error",
    "no-undef": "error",
    "no-unexpected-multiline": "error",
    "no-unreachable": "error",
    "no-unsafe-finally": "error",
    "no-unsafe-negation": "error",
    // Oxlint also flags `(a?.b as T).c`, which ESLint's rule does not see
    // through a TS assertion. It is a real hazard, so keep it visible, but
    // as a warning until the 4 existing test cases are cleaned up.
    "no-unsafe-optional-chaining": "warn",
    "no-unused-labels": "error",
    "no-unused-private-class-members": "error",
    "no-useless-backreference": "error",
    "no-useless-catch": "error",
    "no-useless-escape": "error",
    "no-with": "error",
    "require-yield": "error",
    "use-isnan": "error",
    "valid-typeof": "error",
    "no-var": "error",
    "prefer-const": "warn",
    "prefer-rest-params": "error",
    "prefer-spread": "error",

    // ── typescript-eslint recommended ────────────────────────────────────
    "typescript/no-array-constructor": "error",
    "typescript/no-duplicate-enum-values": "error",
    "typescript/no-extra-non-null-assertion": "error",
    "typescript/no-misused-new": "error",
    "typescript/no-namespace": "error",
    "typescript/no-non-null-asserted-optional-chain": "error",
    "typescript/no-this-alias": "error",
    "typescript/no-unnecessary-type-constraint": "error",
    "typescript/no-unsafe-declaration-merging": "error",
    "typescript/no-unsafe-function-type": "error",
    "typescript/no-wrapper-object-types": "error",
    "typescript/prefer-as-const": "error",
    "typescript/prefer-namespace-keyword": "error",
    "typescript/triple-slash-reference": "error",
    // Project overrides of the recommended set.
    "typescript/no-explicit-any": "off",
    "typescript/ban-ts-comment": "off",
    "typescript/no-empty-object-type": "off",
    "typescript/no-require-imports": "off",
    "typescript/no-unused-expressions": "warn",
    "typescript/no-unused-vars": [
      "warn",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
      },
    ],

    // ── React hooks ──────────────────────────────────────────────────────
    "react/rules-of-hooks": "error",
    "react/exhaustive-deps": "warn",

    // React Compiler rules, from the real eslint-plugin-react-hooks.
    "react-hooks-js/purity": "error",
    "react-hooks-js/preserve-manual-memoization": "error",
    "react-hooks-js/immutability": "error",
    "react-hooks-js/refs": "error",
    "react-hooks-js/set-state-in-effect": "error",
    "react-hooks-js/set-state-in-render": "error",
    "react-hooks-js/static-components": "error",
    "react-hooks-js/use-memo": "error",
    "react-hooks-js/globals": "error",
    "react-hooks-js/error-boundaries": "error",
    // Registered, but dormant: in eslint-plugin-react-hooks 7.0.1 the compiler
    // flag behind it (validateNoDynamicallyCreatedComponentsOrHooks) defaults
    // to false, so it never fires under ESLint either.
    "react-hooks-js/component-hook-factories": "error",
    // Native ports of the same compiler rules. Off because they disagree with
    // the real compiler (set-state-in-effect 36, refs 16,
    // preserve-manual-memoization 3, immutability 1 findings that the compiler
    // does not report). The JS plugin rules above are authoritative.
    "react/purity": "off",
    "react/preserve-manual-memoization": "off",
    "react/immutability": "off",
    "react/refs": "off",
    "react/set-state-in-effect": "off",
    "react/set-state-in-render": "off",
    "react/static-components": "off",
    "react/use-memo": "off",
    "react/globals": "off",
    "react/error-boundaries": "off",
    "react/only-export-components": "off",

    "react-refresh/only-export-components": [
      "warn",
      { allowConstantExport: true },
    ],

    // ── TanStack Router ──────────────────────────────────────────────────
    "tanstack-router/create-route-property-order": "warn",
    "tanstack-router/route-param-names": "error",

    // ── anti-slop ────────────────────────────────────────────────────────
    // The number after each rule is its violation count in Ralph Meet when
    // this config was added (src, scripts and realtime). Rules with zero
    // violations are errors; the rest are ratchets to tighten over time.
    "anti-slop/no-reflect-apply": "error", // 0
    "anti-slop/no-unknown-type-aliases": "error", // 0
    "anti-slop/no-reflect-get": "warn", // 1
    "anti-slop/no-object-parameters": "warn", // 4
    "anti-slop/no-widen-then-assert": "warn", // 7
    "anti-slop/no-array-filter-map": "warn", // 23
    "anti-slop/no-unknown-returns": "warn", // 49
    "anti-slop/no-shape-in-symbol-names": "warn", // 87
    "anti-slop/no-conditional-empty-object-spread": "warn", // 113
    "anti-slop/no-known-value-widening": "warn", // 155
    "anti-slop/no-unknown-parameters": "off", // 255
    "anti-slop/no-chained-type-assertions": "off", // 305
    "anti-slop/no-unsafe-dictionary-type": "off", // 315
    // 402 diagnostics (about 88 vi.mock calls). A later step removes the
    // module mocks; turn this on once that lands.
    "anti-slop/no-module-mocking": "off",
    "anti-slop/no-runtime-typeof": "off", // 689
    "anti-slop/require-safety-comment-for-type-assertion": "off", // 2185
    // 15077, autofixable, but a repo-wide rewrite is out of scope for step 0.
    "anti-slop/require-readable-spacing": "off",
    // Effect rules. The Worker request path (src/server/) runs on Effect.
    "anti-slop-effect/no-manual-effect-error-tag": "error", // 0
    "anti-slop-effect/no-manual-tag-comparison": "error", // 0
    "anti-slop-effect/no-manual-tagged-construction": "error", // 0
    "anti-slop-effect/no-service-constructor-imports": "error", // 0
    // Chained literal ternaries; the rule wants Effect's `Match`. A ratchet:
    // new code should not add to it.
    "anti-slop-effect/prefer-effect-match": "warn", // 63
  },
  overrides: [
    {
      // typescript-eslint turns these core rules off for TS files because the
      // compiler (and the TS-aware replacements) already cover them.
      files: ["**/*.{ts,tsx,mts,cts}"],
      rules: {
        "constructor-super": "off",
        "getter-return": "off",
        "no-class-assign": "off",
        "no-const-assign": "off",
        "no-dupe-class-members": "off",
        "no-dupe-keys": "off",
        "no-func-assign": "off",
        "no-import-assign": "off",
        "no-new-native-nonconstructor": "off",
        "no-obj-calls": "off",
        "no-redeclare": "off",
        "no-setter-return": "off",
        "no-this-before-super": "off",
        "no-undef": "off",
        "no-unreachable": "off",
        "no-unsafe-negation": "off",
        "no-with": "off",
      },
    },
    {
      files: [
        "*.{js,cjs,mjs,ts,cts,mts}",
        "scripts/**/*.{js,cjs,mjs,ts,cts,mts}",
      ],
      env: { node: true },
    },
    {
      // AudioWorklet scope globals are not part of Oxlint's browser env.
      files: ["src/lib/voice/vad-processor.worklet.js"],
      globals: {
        AudioWorkletProcessor: "readonly",
        registerProcessor: "readonly",
        sampleRate: "readonly",
        currentFrame: "readonly",
        currentTime: "readonly",
      },
    },
    {
      // TanStack route modules must co-locate route definitions and route exports.
      files: ["src/routes/**/*.{ts,tsx}"],
      rules: { "react-refresh/only-export-components": "off" },
    },
    {
      // These modules deliberately export shared helpers beside their components.
      // Moving them would change established import contracts without improving HMR.
      files: [
        "src/components/DesktopScreenPickerUI.tsx",
        "src/components/StandaloneUpdater.tsx",
        "src/components/chat/ImageViewerToolbar.tsx",
        "src/components/chat/ProfileCollectiblesLayer.tsx",
        "src/components/chat/ReplyPreviewContent.tsx",
        "src/components/ui/badge.tsx",
        "src/components/ui/button.tsx",
      ],
      rules: { "react-refresh/only-export-components": "off" },
    },
  ],
});
