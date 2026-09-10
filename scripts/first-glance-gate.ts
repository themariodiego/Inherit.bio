// CI gate: G3.5, the first-glance test. The first heading on a result page is
// a plain-language sentence of at most 12 words, carries no term from
// `data/jargon.json`, and shows no numeric figure without its unit and
// comparison baseline in the same visual block.
//
// This runs over the committed headings rather than a browser, so it covers
// every one of them instead of the handful an E2E can afford to visit.
// `e2e/first-glance.spec.ts` is the other half: it applies the same rules to
// the heading the page actually rendered, so a passing data gate cannot
// describe a string the page never shows.
import { headingFailures, jargonTerms, resultHeadings } from "./first-glance-rules";

function main() {
  const jargon = jargonTerms();
  if (jargon.length < 200) {
    console.error(`FIRST-GLANCE GATE FAILED: jargon register holds ${jargon.length} terms and aliases; `
      + "the brief requires at least 200 and ADR 0012 records 203. Shortening it needs an ADR.");
    process.exit(1);
  }
  const headings = resultHeadings();
  // A broken walker must fail loudly rather than quietly check nothing.
  if (headings.length < 100) {
    console.error(`FIRST-GLANCE GATE FAILED: found only ${headings.length} result headings — `
      + "the walker is broken, not the product.");
    process.exit(1);
  }
  const failures = headings.flatMap(({ source, heading }) => headingFailures(source, heading, jargon));
  console.log(`checked ${headings.length} result headings against ${jargon.length} jargon terms and aliases`);
  if (failures.length) {
    console.error(`\nFIRST-GLANCE GATE FAILED (${failures.length}):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log("first-glance gate passed");
}

main();
