/**
 * Proof that the committed browser fixture `e2e/fixtures/neanderthal-grch38.vcf`
 * is still exactly what its generator produces, describes no real person, and
 * still yields a covered estimate with a usable range under the real
 * estimator. The browser test in `e2e/ancestry.spec.ts` depends on it. The
 * expected numbers are written out literally, so a drift in the panel, the
 * generator or the estimator fails here before it reaches a browser.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXTURE_NAME, render, rows, verify } from "../../../e2e/fixtures/generate-neanderthal-vcf";
import { estimateNeanderthal, NEANDERTHAL_SITES } from "./neanderthal";

const text = readFileSync(`e2e/fixtures/${FIXTURE_NAME}`, "utf8");

describe("the synthetic Neanderthal browser fixture", () => {
  it("is byte-identical to the generator's output and pinned by hash", () => {
    expect(text).toBe(render());
    expect(createHash("sha256").update(text).digest("hex"))
      .toBe("df216862b55312a2aa224e4a9d1de26af12d70d4f8ba1cc5938932eac3cbf2ff");
    expect(text).toContain("no real person");
  });

  it("copies every position and both alleles from the shipped panel and invents none", () => {
    const panel = new Map(NEANDERTHAL_SITES.map(site => [`${site.chrom}:${site.pos38}`, site]));
    for (const row of rows()) {
      const site = panel.get(`${row.chrom}:${row.pos}`);
      expect(site).toBeDefined();
      expect([row.ref, row.alt]).toEqual([site!.other, site!.archaic]);
    }
  });

  it("yields the covered estimate and range the browser test reads", () => {
    expect(() => verify(text)).not.toThrow();
    const result = estimateNeanderthal(rows().map(row => ({ chrom: row.chrom, pos: row.pos, ref: row.ref, alt: row.alt,
      genotype: row.gt.split("/").map(copy => (copy === "0" ? row.ref : row.alt)).join("/"), usable: true })), "vcf-literal");
    expect(result).toMatchObject({ coveredSites: 180, archaicSites: 73, interval: { low: 0.333, high: 0.461 } });
    expect(result.estimate).toBeCloseTo(73 / 180, 12);
  });
});
