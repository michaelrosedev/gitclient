import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// Guard against re-drifting the shared string-unions / sentinels we consolidated
// (see TODO "Replace repeated magic-string literals"). Each entry flags a
// re-declaration of a union we now have a single source of truth for, or a use
// of a raw backend-paired sentinel, and points at the canonical import. The
// files that legitimately *define* these are exempted below, as are tests.
const noDriftRules = [
  {
    // Re-declaring the write/preview markdown-editor tab union.
    selector:
      "TSUnionType:has(TSLiteralType > Literal[value='write']):has(TSLiteralType > Literal[value='preview'])",
    message:
      "Don't re-declare the write/preview union — import `MarkdownTab` from `lib/markdown`.",
  },
  {
    // Re-declaring the top-level view union.
    selector:
      "TSUnionType:has(TSLiteralType > Literal[value='history']):has(TSLiteralType > Literal[value='prs']):has(TSLiteralType > Literal[value='settings'])",
    message: "Don't re-declare the view union — import `View` from `types/view`.",
  },
  {
    // The working-tree sentinel is paired with the Rust graph layout; use the
    // named const so a typo can't silently break selection.
    selector: "Literal[value='WORKING_TREE']",
    message:
      "Use `WORKING_TREE_OID` from `stores/graphStore` instead of the bare \"WORKING_TREE\" sentinel.",
  },
];

export default tseslint.config(
  { ignores: ["dist", "src-tauri"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // v7 adds React Compiler migration diagnostics to its recommended preset.
      // Keep the existing hooks policy until those broader refactors are planned.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "no-restricted-syntax": ["error", ...noDriftRules],
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
  {
    // The canonical definitions of the consolidated types/sentinel, plus tests
    // (fixtures legitimately use raw sentinel strings).
    files: [
      "src/types/view.ts",
      "src/lib/markdown.ts",
      "src/stores/graphStore.ts",
      "**/*.test.{ts,tsx}",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    // Story files may export non-component values (args/argTypes objects) and
    // legitimately use sentinel strings in fixtures; keep them off the
    // component-only and no-drift rules so `--max-warnings 0` stays green.
    files: ["**/*.stories.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
      "no-restricted-syntax": "off",
    },
  },
);
