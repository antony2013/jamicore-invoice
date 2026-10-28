import { FlatCompat } from "@eslint/eslintrc";

// Next.js 15 ships legacy eslintrc configs; bridge them into ESLint 9 flat
// config. `next lint` is deprecated in Next 16 — this config is CLI-ready.
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "src/db/migrations/**",
      "scripts/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Existing codebase predates the linter: keep correctness rules on,
      // downgrade style-only ones so the gate is actionable, not noisy.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "react-hooks/exhaustive-deps": "warn",
      "@next/next/no-img-element": "off",
    },
  },
];

export default config;
