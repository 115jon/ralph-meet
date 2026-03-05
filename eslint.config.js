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
      ".output/",
      ".vinxi/",
      ".wrangler/",
      "worker/",
      "desktop/",
      "mobile/",
      "src/routeTree.gen.ts",
    ],
  },

  // ── Base JS rules ─────────────────────────────────────────────────────
  js.configs.recommended,

  // ── TypeScript ────────────────────────────────────────────────────────
  ...tseslint.configs.recommended,

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
);
