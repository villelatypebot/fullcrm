import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    // Repo-specific ignores (generated/auxiliary code)
    "testsprite_tests/**",
    "supabase/functions/**",
    "tmp/**",
    "**/*.bak",
  ]),

  // Project-level rule tuning: keep lint useful, but avoid blocking on high-noise rules.
  {
    rules: {
      // Too noisy for this codebase right now; keep as warning so we can incrementally improve.
      '@typescript-eslint/no-explicit-any': 'warn',

      // Style/ergonomics rules: warnings only (should not block CI/dev loop).
      'prefer-const': 'warn',
      'react/no-unescaped-entities': 'warn',

      // React Compiler-specific rules (currently too disruptive for the project).
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',

      // Valid pattern in React; this rule creates lots of false positives in real apps.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);

export default eslintConfig;
