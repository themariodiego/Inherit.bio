import { describe, it, expect } from "vitest";
import { createReadStream } from "node:fs";
import path from "node:path";
import { toLines } from "./parsers/lines";
import { parseVcf } from "./parsers/vcf";
import fs from "node:fs";
import { resolveTemplate } from "./reports";
import { buildPipelineVcf, compressSyntheticVcf, PIPELINE_FIXTURE } from "../../../scripts/generate-synthetic-vcf-fixtures";
import receipt from "../../../data/samples/synthetic-pipeline-grch38.receipt.json";

describe("synthetic gzip VCF parser and template pipeline", () => {
  it("parses over 100,000 invented calls and resolves every template with covered and absent positions", async () => {
    expect(fs.readFileSync(path.join(process.cwd(), PIPELINE_FIXTURE))).toEqual(
      compressSyntheticVcf(buildPipelineVcf(process.cwd())),
    );
    const stream = createReadStream(
      path.join(process.cwd(), PIPELINE_FIXTURE),
    );
    const parsed = await parseVcf(toLines(stream as never));
    expect(parsed.records.length).toBeGreaterThan(100000);
    expect(parsed.records).toHaveLength(120073);
    expect(parsed.records).toHaveLength(receipt.fixture.records);
    expect(parsed.build).toBe("GRCh38");
    expect(parsed.skipped).toBe(0);

    const byRsid = new Map<number, string>();
    for (const r of parsed.records)
      if (r.rsid != null && !byRsid.has(r.rsid)) byRsid.set(r.rsid, r.genotype);
    expect([...byRsid.keys()].sort((a, b) => a - b)).toEqual(receipt.catalogue.includedRsids);
    expect(byRsid.size).toBe(73);
    for (const rsid of receipt.catalogue.absentRsids) expect(byRsid.has(rsid)).toBe(false);

    const dir = path.join(process.cwd(), "data/templates");
    let total = 0;
    let coveredOrHonest = 0;
    let genotyped = 0;
    let notCovered = 0;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      for (const t of JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) {
        total++;
        const r = resolveTemplate(t, (rsid: number) => byRsid.get(rsid));
        // Every template resolves to a defined outcome (covered or honest not-covered).
        expect(r.variants.every((v) => v.outcome.status)).toBe(true);
        for (const variant of r.variants) {
          if (byRsid.has(variant.variant.rsid)) {
            expect(variant.outcome.status).toBe("genotyped");
            genotyped++;
          } else {
            expect(variant.outcome).toEqual({ status: "not-covered" });
            notCovered++;
          }
        }
        if (r.variants.length > 0) coveredOrHonest++;
      }
    }
    expect(total).toBeGreaterThan(0);
    expect(coveredOrHonest).toBe(total);
    expect(genotyped).toBeGreaterThan(0);
    expect(notCovered).toBeGreaterThan(0);
  });
});
