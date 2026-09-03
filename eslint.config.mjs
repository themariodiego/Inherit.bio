import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noRawFigure from "./scripts/eslint/no-raw-figure.mjs";

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
  ]),
  // W1 figure contract. Scope is deliberately narrow until W3 rewrites the
  // result pages; the intended globs are RESULT_SURFACE_GLOBS in the rule file.
  {
    files: ["src/components/figures/**/*.tsx", "src/components/results/**/*.tsx"],
    plugins: { inherit: { rules: { "no-raw-figure": noRawFigure } } },
    rules: { "inherit/no-raw-figure": "error" },
  },
]);

export default eslintConfig;
