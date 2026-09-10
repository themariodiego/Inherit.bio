// Generates e2e/fixtures/carrier-pair-b-grch38.vcf: G8.3's second carrier pair,
// a synthetic single-sample GRCh38 VCF describing a different person from
// carrier-pair-grch38.vcf. It describes no real person: every position and
// every genotype is written by hand in carrier-pair-b-fixture.ts, none was
// read from anyone, and the seven classified positions reuse the reserved
// synthetic rsIDs that exist in no public catalogue.
//
//   pnpm exec tsx e2e/fixtures/generate-carrier-pair-b-vcf.ts
//
// After writing, the script parses the output with the real VCF parser, runs
// the real runs measure over the parsed autosomal records, and checks that the
// four public report positions parsed to the letters the fixture claims — it
// refuses to leave a file behind that the surface would not accept, or one
// whose calls never reached the parser.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyAgainst } from "./carrier-pair-fixture";
import {
  CARRIER_B_POSITIONS,
  CARRIER_B_REPORT_CALLS,
  FIXTURE_NAME_B,
  buildCarrierPairBVcf,
} from "./carrier-pair-b-fixture";
import { parseVcf } from "../../src/lib/genome/parsers/vcf";

async function* asLines(lines: readonly string[]): AsyncIterable<string> {
  for (const line of lines) yield line;
}

async function main() {
  const lines = buildCarrierPairBVcf();
  const check = await verifyAgainst(lines, CARRIER_B_POSITIONS);
  const parsed = await parseVcf(asLines(lines));
  const byRsid = new Map(parsed.records.map((record) => [record.rsid, record.genotype]));
  const reasons = [...check.reasons];
  for (const call of CARRIER_B_REPORT_CALLS) {
    const read = byRsid.get(call.rsid);
    if (read !== call.genotype) {
      reasons.push(`rs${call.rsid} parsed as ${String(read)}, not the stated ${call.genotype}`);
    }
  }
  if (reasons.length > 0) {
    console.error(`fixture check failed:\n  - ${reasons.join("\n  - ")}`);
    process.exitCode = 1;
    return;
  }
  const text = `${lines.join("\n")}\n`;
  const target = path.join(path.dirname(fileURLToPath(import.meta.url)), FIXTURE_NAME_B);
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
    `classified positions: ${CARRIER_B_POSITIONS.map((entry) => `rs${entry.rsid} ${String(check.carrierGenotypes[entry.rsid])}`).join(", ")}`,
  );
  console.log(
    `report positions: ${CARRIER_B_REPORT_CALLS.map((call) => `rs${call.rsid} ${String(byRsid.get(call.rsid))}`).join(", ")}`,
  );
  console.log(`parsed records: ${parsed.records.length}, reference calls: ${parsed.referenceCalls.length}`);
  console.log(`sha256: ${sha256}`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  void main();
}
