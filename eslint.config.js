import js from "@eslint/js";
import pluginRouter from "@tanstack/eslint-plugin-router";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // ── Global ignores ────────────────────────────────────────────────────
  {
    ignores: [
      "node_modules/",
      "dist/",
      "coverage/",
      ".output/",
      ".vinxi/",
      ".wrangler/",
      "target-test/",
      "public/mediapipe/",
      "packages/*/dist/",
      "worker/",
      "desktop/",
      "mobile/",
      "src/routeTree.gen.ts",
      // Third-party minified yt-dlp solver payloads are consumed as opaque
      // runtime assets; linting them creates hundreds of non-actionable
      // diagnostics that cannot be repaired locally.
      "src/lib/ytdlp/assets/*.min.js",
    ],
  },

  // ── Base JS rules ─────────────────────────────────────────────────────
  js.configs.recommended,

  // ── TypeScript ────────────────────────────────────────────────────────
  ...tseslint.configs.recommended,

  // ── Node.js tooling ──────────────────────────────────────────────────
  {
    files: [
      "*.{js,cjs,mjs,ts,cts,mts}",
      "scripts/**/*.{js,cjs,mjs,ts,cts,mts}",
    ],
    languageOptions: {
      globals: globals.node,
    },
  },

  // ── TanStack Router ───────────────────────────────────────────────────
  ...pluginRouter.configs["flat/recommended"],

  // ── React Hooks + Refresh ─────────────────────────────────────────────
  {
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // Core hooks rules — always errors
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // ── React Compiler rules (new in react-hooks v5) ──────────────────
      // These enforce component purity, correct memoization, and ref safety
      // required by the React Compiler for automatic optimisation.
      //
      // They ARE genuine best practices and WILL improve performance.
      // Now set to "error" to enforce compliance across the project.
      "react-hooks/purity": "error",
      "react-hooks/preserve-manual-memoization": "error",
      "react-hooks/immutability": "error",
      "react-hooks/refs": "error",
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/set-state-in-render": "error",
      "react-hooks/static-components": "error",
      "react-hooks/use-memo": "error",
      "react-hooks/globals": "error",
      "react-hooks/error-boundaries": "error",
      "react-hooks/component-hook-factories": "error",

      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },

  // ── Project-specific overrides ────────────────────────────────────────
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    rules: {
      // ── TypeScript ────────────────────────────────────────────────────
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-require-imports": "off",

      // ── General ───────────────────────────────────────────────────────
      "no-empty": ["error", { allowEmptyCatch: true }],
      "prefer-const": "warn",
    },
  },

  // TanStack route modules must co-locate route definitions and route exports.
  {
    files: ["src/routes/**/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },

  // These modules deliberately export shared helpers beside their components.
  // Moving them would change established import contracts without improving HMR.
  {
    files: [
      "packages/kova-react/src/components/icons.tsx",
      "packages/kova-react/src/components/social-buttons.tsx",
      "packages/kova-react/src/context.tsx",
      "src/components/DesktopScreenPickerUI.tsx",
      "src/components/StandaloneUpdater.tsx",
      "src/components/chat/ImageViewerToolbar.tsx",
      "src/components/chat/ProfileCollectiblesLayer.tsx",
      "src/components/chat/ReplyPreviewContent.tsx",
      "src/components/ui/badge.tsx",
      "src/components/ui/button.tsx",
    ],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
);
