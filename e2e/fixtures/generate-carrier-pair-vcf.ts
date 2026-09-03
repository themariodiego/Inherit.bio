// Generates e2e/fixtures/carrier-pair-grch38.vcf: a synthetic single-sample
// GRCh38 VCF that lets `e2e/family-health-picture.spec.ts` reach every branch
// of the carrier rule (src/lib/family/carrier-pair.ts). It describes no real
// person: every position and every genotype below is written here by hand,
// none was read from anyone, and the seven classified positions use reserved
// synthetic rsIDs that exist in no public catalogue.
//
//   pnpm exec tsx e2e/fixtures/generate-carrier-pair-vcf.ts
//
// The file carries three kinds of row and nothing else:
//
//   1. seven rows at the synthetic rsIDs 999999001–999999007
//      (carrier-pair-positions.ts): four with one changed copy and one
//      unchanged (GT 0/1), one with two changed copies (GT 1/1, the
//      `two-copies` reason), and two with a changed copy of a letter other
//      than the classified one (GT 0/2 against ALT G,T), so both accounts
//      that ingest this file cover those two positions without either
//      showing the classified change — the count the empty sentence prints;
//   2. two short pairs of same-reading rows, so the file's runs of
//      homozygosity are measurable at all and sit far below both thresholds
//      the brief states — without them the file would list only differences
//      and the rule would refuse the arithmetic (src/lib/family/roh.ts);
//   3. the four positions of `tiny-grch38.vcf`, so the side-by-side table has
//      the same covered reports the other Family specs use.
//
// After writing, the script parses the output with the real VCF parser and
// runs the real runs measure over the parsed autosomal records, and refuses
// to leave a file behind that the surface would not accept. The rows, the
// text and that check live in `carrier-pair-fixture.ts`, which the browser
// spec imports too: the processing route stores the same measure with the
// file, and the spec asserts the stored columns against `verify`.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CARRIER_FIXTURE_POSITIONS } from "./carrier-pair-positions";
import { FIXTURE_NAME, buildCarrierPairVcf, verify } from "./carrier-pair-fixture";

async function main() {
  const lines = buildCarrierPairVcf();
  const check = await verify(lines);
  if (!check.ok) {
    console.error(`fixture check failed:\n  - ${check.reasons.join("\n  - ")}`);
    process.exitCode = 1;
    return;
  }
  const text = `${lines.join("\n")}\n`;
  const target = path.join(path.dirname(fileURLToPath(import.meta.url)), FIXTURE_NAME);
  fs.writeFileSync(target, text);
  const sha256 = crypto.createHash("sha256").update(text).digest("hex");
  console.log(
    `wrote ${path.relative(process.cwd(), target)} (${text.length} bytes, ${lines.length - 10} rows)`,
  );
  if (check.measure.status === "measured") {
    console.log(
      `runs: ${check.measure.runCount} totalling ${check.measure.totalRunBases} bases over a span of ${check.measure.coveredSpanBases}; F_ROH ${check.measure.fRoh.toExponential(2)}`,
    );
  }
  console.log(
    `classified positions: ${CARRIER_FIXTURE_POSITIONS.map((entry) => `rs${entry.rsid} ${String(check.carrierGenotypes[entry.rsid])}`).join(", ")}`,
  );
  console.log(`sha256: ${sha256}`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  void main();
}
