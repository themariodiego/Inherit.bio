import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import noRawFigure, { RESULT_SURFACE_GLOBS } from "./no-raw-figure.mjs";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

describe("no-raw-figure globs", () => {
  it("lists every intended result surface", () => {
    if (RESULT_SURFACE_GLOBS.length !== 5) throw new Error("expected five result-surface globs");
  });
});

tester.run("no-raw-figure", noRawFigure, {
  valid: [
    // Figure text inside the contract components.
    "const a = <Figure spec={spec}>12%</Figure>;",
    "const b = <ClaimBlock subject={s} figures={f}><p>about 3 in 1,000</p></ClaimBlock>;",
    // A node carrying data-figure-kind may format its own value.
    'const c = <span data-figure-kind="absolute"><span>{value.toFixed(1)}</span></span>;',
    // UI chrome, exempted with a reason.
    `const d = (
      <p>
        {/* inherit-figure-exempt: file size is UI chrome */}
        {size.toFixed(1)} MB
      </p>
    );`,
    // Prose without a figure, and a template literal outside JSX.
    "const e = <p>Your file is ready.</p>; const f = `${x}%`;",
  ],
  invalid: [
    { code: "const a = <p>Your risk is 12%.</p>;", errors: [{ messageId: "rawText" }] },
    { code: "const b = <span>{`${x}%`}</span>;", errors: [{ messageId: "rawText" }] },
    { code: "const c = <p>Genotype A/C</p>;", errors: [{ messageId: "rawText" }] },
    { code: "const d = <p>about 3 in 1,000</p>;", errors: [{ messageId: "rawText" }] },
    { code: "const e = <td>{value.toFixed(1)}</td>;", errors: [{ messageId: "rawCall" }] },
    { code: "const f = <p>{formatPercent(v)}</p>;", errors: [{ messageId: "rawCall" }] },
    // A comment without a reason does not exempt.
    {
      code: `const g = <p>
        {/* inherit-figure-exempt: */}
        {n.toLocaleString()}
      </p>;`,
      errors: [{ messageId: "rawCall" }],
    },
  ],
});
