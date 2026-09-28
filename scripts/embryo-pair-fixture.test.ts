import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { QC_THRESHOLDS } from "../src/lib/embryos/qc-policy";
import { sniffV2 } from "../src/lib/genome/parsers/sniff";
import { buildFromHeader } from "../src/lib/genome/parsers/vcf";
import {
  buildEmbryoPairVcf,
  CONTIG_LENGTHS,
  EMBRYO_PAIR_FIXTURE,
  SAMPLES,
  SITE_COUNT,
} from "./generate-embryo-pair-fixture";

/**
 * participant-c's embryo file (owner decision, 28 September 2026). The
 * embryo-ingest completion contract refuses a cohort upload that resolves to
 * exactly one sample, so this is one VCF carrying two synthetic embryos. Each
 * property below is one the ingest contract or the embryo quality policy
 * reads, checked on the committed bytes with the product's own code.
 */
const ROOT = process.cwd();
const text = readFileSync(path.join(ROOT, EMBRYO_PAIR_FIXTURE), "utf8");
const lines = text.split("\n").filter((line) => line.length > 0);
const records = lines.filter((line) => !line.startsWith("#")).map((line) => line.split("\t"));

describe("the two-embryo synthetic VCF", () => {
  it("is exactly what its generator writes", () => {
    expect(text).toBe(buildEmbryoPairVcf(ROOT));
  });

  it("is a multi-sample VCF to the product's sniffer, so ingest cannot refuse it as single-sample", () => {
    const sniffed = sniffV2(new TextEncoder().encode(text));
    expect(sniffed.kind).toBe("vcf_multisample");
    expect(sniffed.sampleCount).toBe(2);
    expect(sniffed.sampleNames).toEqual([...SAMPLES]);
  });

  it("declares GRCh38 in its header, where the server reads the build", () => {
    const declared = lines.filter((line) => line.startsWith("##")).map(buildFromHeader).filter((build) => build !== null);
    expect(declared.length).toBeGreaterThan(0);
    expect(new Set(declared)).toEqual(new Set(["GRCh38"]));
  });

  it("carries autosomal records only, every one inside its declared contig", () => {
    expect(records).toHaveLength(SITE_COUNT);
    for (const [chrom, pos] of records) {
      const number = Number(chrom.replace(/^chr/, ""));
      expect(Number.isInteger(number) && number >= 1 && number <= 22, chrom).toBe(true);
      expect(Number(pos)).toBeLessThanOrEqual(CONTIG_LENGTHS[number]);
    }
  });

  it("declares each contig with the length the committed fixtures already give it", () => {
    const committed = new Map<string, string>();
    for (const name of readdirSync(path.join(ROOT, "e2e/fixtures"))) {
      if (!name.endsWith(".vcf") || `e2e/fixtures/${name}` === EMBRYO_PAIR_FIXTURE) continue;
      for (const line of readFileSync(path.join(ROOT, "e2e/fixtures", name), "utf8").split("\n")) {
        const match = /^##contig=<ID=(chr\d+),length=(\d+)>$/.exec(line);
        if (match) committed.set(match[1], match[2]);
      }
    }
    const declared = lines.map((line) => /^##contig=<ID=(chr\d+),length=(\d+)>$/.exec(line)).filter((match) => match !== null);
    expect(declared.length).toBe(Object.keys(CONTIG_LENGTHS).length);
    for (const match of declared) expect(committed.get(match![1]), match![1]).toBe(match![2]);
  });

  it("reads every position from the public coordinate reference", () => {
    const reference = JSON.parse(readFileSync(path.join(ROOT, "data/ref/build-discriminating-sites.json"), "utf8")) as {
      sites: [number, number, number, number][];
    };
    const known = new Set(reference.sites.map(([rsid, chrom, , pos38]) => `rs${rsid} chr${chrom}:${pos38}`));
    for (const [chrom, pos, id] of records) expect(known.has(`${id} ${chrom}:${pos}`), `${id} ${chrom}:${pos}`).toBe(true);
  });

  it("calls both embryos at or above the quality policy's no-figure floor, and they differ", () => {
    for (const [index] of SAMPLES.entries()) {
      const called = records.filter((fields) => fields[9 + index] !== "./.").length;
      expect(called / records.length, SAMPLES[index]).toBeGreaterThanOrEqual(QC_THRESHOLDS.callRateNoFigure);
    }
    const differing = records.filter((fields) => fields[9] !== fields[10]).length;
    expect(differing, "two embryos, not one sample twice").toBeGreaterThan(records.length / 4);
  });
});
