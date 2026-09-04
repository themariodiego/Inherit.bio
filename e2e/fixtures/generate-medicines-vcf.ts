// Generates e2e/fixtures/medicines-grch38.vcf: a synthetic single-sample
// GRCh38 VCF with one row at each position of data/templates/medicines.json
// and one changed copy (GT 0/1) at every one, so `e2e/report-skeleton.spec.ts`
// has a covered Medicines report to read (ADR 0021). It describes no real
// person: the positions, rsIDs and alleles are the seed's own, and every
// genotype is invented here.
//
//   pnpm exec tsx e2e/fixtures/generate-medicines-vcf.ts
//
// After building, the script parses the output with the real VCF parser and
// refuses to leave a file behind that the surface would not accept. The rows,
// the text and that check live in `medicines-fixture.ts`, which the browser
// spec imports too, so the committed file and the spec's expectations come
// from the same code.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FIXTURE_NAME, buildMedicinesVcf, buildRows, verify } from "./medicines-fixture";

async function main() {
  const lines = buildMedicinesVcf();
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
    `wrote ${path.relative(process.cwd(), target)} (${text.length} bytes, ${buildRows().length} rows)`,
  );
  console.log(
    `genotypes: ${buildRows().map((row) => `rs${row.rsid} ${String(check.genotypes[row.rsid])}`).join(", ")}`,
  );
  console.log(`sha256: ${sha256}`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  void main();
}
