import { describe, it, expect } from "vitest";
import { createReadStream } from "node:fs";
import path from "node:path";
import { toLines } from "./parsers/lines";
import { parseVcf } from "./parsers/vcf";
import fs from "node:fs";
import { resolveTemplate } from "./reports";

describe("GIAB VCF end-to-end pipeline", () => {
  it("parses the GIAB chr20-22 subset and resolves templates", async () => {
    const stream = createReadStream(
      path.join(process.cwd(), "data/samples/HG001_GRCh38_chr20-22.vcf.gz"),
    );
    const parsed = await parseVcf(toLines(stream as never));
    expect(parsed.records.length).toBeGreaterThan(100000);
    expect(parsed.build).toBe("GRCh38");

    const byRsid = new Map<number, string>();
    for (const r of parsed.records)
      if (r.rsid != null && !byRsid.has(r.rsid)) byRsid.set(r.rsid, r.genotype);

    const dir = path.join(process.cwd(), "data/templates");
    let total = 0;
    let coveredOrHonest = 0;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      for (const t of JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) {
        total++;
        const r = resolveTemplate(t, (rsid: number) => byRsid.get(rsid));
        // Every template resolves to a defined outcome (covered or honest not-covered).
        expect(r.variants.every((v) => v.outcome.status)).toBe(true);
        if (r.variants.length > 0) coveredOrHonest++;
      }
    }
    expect(total).toBeGreaterThan(0);
    expect(coveredOrHonest).toBe(total);
    console.log(
      `GIAB: ${parsed.records.length} variants, ${byRsid.size} rsids; ${total} templates all resolved cleanly`,
    );
  });
});
