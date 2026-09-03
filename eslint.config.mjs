import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noRawFigure, { RESULT_SURFACE_GLOBS } from "./scripts/eslint/no-raw-figure.mjs";

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
  // Figure contract (brief X4): every numeric or genotypic value on a result
  // surface renders through Figure / RelativeFigure / ClaimBlock. Scope is
  // RESULT_SURFACE_GLOBS from the rule file plus the figure components, with
  // no exception: the last one, the genome browser, now renders its
  // genotypes as figures inside one claim block per table.
  {
    files: [...RESULT_SURFACE_GLOBS, "src/components/figures/**/*.tsx"],
    plugins: { inherit: { rules: { "no-raw-figure": noRawFigure } } },
    rules: { "inherit/no-raw-figure": "error" },
  },
]);

export default eslintConfig;
