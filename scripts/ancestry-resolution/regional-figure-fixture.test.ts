import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildRegionalFigureVcf } from "../../e2e/fixtures/generate-regional-figure-vcf";
import { estimateRegionalFixture } from "../../e2e/fixtures/generate-regional-aims-vcf";
import { FIGURE_EXTRA_CALL, REGIONAL_FIGURE_PAIRS } from "../../e2e/fixtures/regional-figure-fixtures";
import { presentRegionalShares, regionalChipShares } from "../../src/lib/ancestry/regional-present";
import { REGIONAL_AIMS } from "../../src/lib/genome/regional-admixture";
import { countInputLines, emptyReadCounts } from "../../src/lib/genome/input-provenance";
import { parseVcf } from "../../src/lib/genome/parsers/vcf";
import registry from "../../data/ref/regions/regions-v3.json";

describe("versioned regional figure fixtures", () => {
  for (const pair of REGIONAL_FIGURE_PAIRS) it(`${pair.id}: exact synthetic bytes, real coverage and every displayed share differs`, async () => {
    const actual = [];
    for (const fixture of [pair.a, pair.b]) {
      const text = readFileSync(`e2e/fixtures/${fixture.name}`, "utf8");
      expect(buildRegionalFigureVcf(fixture)).toBe(text);
      const counts = emptyReadCounts();
      async function* lines() { yield* text.split("\n"); }
      const parsed = await parseVcf(countInputLines(lines(), "vcf", counts));
      expect(parsed.skipped).toBe(0);
      expect(counts).toEqual({ called: fixture.called, noCall: 0, unsupported: 0, failedFilter: 0,
        blocks: 0, singleSample: true, buildClaim: true });
      const result = await estimateRegionalFixture(text);
      expect(result.markersUsed).toBe(fixture.markers);
      expect(result.markersUsed >= registry.panel.minimum_markers).toBe(pair.shown);
      expect(result.fit.converged).toBe(true);
      expect(result.reporting.merged).toBe(pair.merged);
      const { rows, split } = presentRegionalShares(result);
      expect(rows).toHaveLength(pair.merged ? 5 : 7);
      expect(split).toHaveLength(pair.merged ? 3 : 0);
      const shares = Object.fromEntries([...rows, ...split].map(row => [row.code, Math.round(row.share * 1000)]));
      const chips = regionalChipShares(rows, true);
      expect(chips.unassignable).toBe(0);
      if (fixture.extraCall) {
        const withoutExtra = text.split("\n").filter(line => !line.startsWith(`chr${FIGURE_EXTRA_CALL.chrom}\t${FIGURE_EXTRA_CALL.pos}\t`)).join("\n");
        expect(await estimateRegionalFixture(withoutExtra)).toEqual(result);
      }
      actual.push({ shares, hidden: Math.round(chips.hidden * 1000), called: counts.called });
    }
    expect(Object.keys(actual[0].shares).sort()).toEqual(Object.keys(actual[1].shares).sort());
    for (const [code, value] of Object.entries(actual[0].shares)) expect(actual[1].shares[code], code).not.toBe(value);
    if (pair.shown) expect(actual[1].hidden).not.toBe(actual[0].hidden);
    expect(actual[1].called).not.toBe(actual[0].called);
  });

  it("the extra invented autosomal call is outside every shipped analysis panel", () => {
    const { chrom, pos } = FIGURE_EXTRA_CALL;
    expect(chrom).toBeLessThanOrEqual(22);
    expect(REGIONAL_AIMS.some(marker => marker.chrom === chrom && marker.pos38 === pos)).toBe(false);
    let visited = 0;
    function visit(value: unknown) {
      if (!value || typeof value !== "object") return;
      if ("chrom" in value && "pos38" in value) {
        visited++;
        expect(value.chrom === chrom && value.pos38 === pos).toBe(false);
      }
      for (const child of Object.values(value)) visit(child);
    }
    for (const dir of ["data/templates", "data/prs"]) for (const name of readdirSync(dir).filter(name => name.endsWith(".json"))) {
      visit(JSON.parse(readFileSync(`${dir}/${name}`, "utf8")));
    }
    expect(visited).toBeGreaterThan(0);
  });
});
