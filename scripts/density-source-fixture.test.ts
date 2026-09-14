import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MIN_MARKERS } from "../src/lib/ancestry/panel";
import { estimateFixture } from "../e2e/fixtures/generate-aims-vcf";
import {
  FIXTURE_NAME,
  REQUIRED_LOCUS,
  buildDensityVcf,
  checkLines,
} from "../e2e/fixtures/generate-density-source-vcf";

/**
 * The post-change density capture uploads this file and screenshots what it
 * produces. Two of its properties are the whole reason it exists, and a
 * regenerated fixture that quietly lost either would turn the comparison into
 * one between a populated page and an empty one — which reads as a large
 * density improvement and is nothing of the kind.
 *
 * So the committed bytes are checked against a fresh build rather than
 * trusted: a catalogue or panel change that moves them fails here, and the
 * answer is to regenerate and look at what moved.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HERE = path.join(ROOT, "e2e/fixtures");
const SEED = 1;

describe("the post-change density source", () => {
  const committed = fs.readFileSync(path.join(HERE, FIXTURE_NAME), "utf8");
  const built = `${buildDensityVcf(ROOT, SEED).join("\n")}\n`;

  it("is exactly what the generator produces today", () => {
    expect(built).toBe(committed);
  });

  it("shows the ancestry map rather than the grey state", async () => {
    const lines = committed.trimEnd().split("\n");
    const check = checkLines(lines, (await estimateFixture(lines)).markersUsed);
    expect(check.markersUsed).toBeGreaterThanOrEqual(MIN_MARKERS);
    expect(check.mapShown).toBe(true);
  });

  it("carries an ALT allele at the locus the baseline's measured report reads", () => {
    // Without this the successor of `/reports/type-2-diabetes-tcf7l2-rs7903146`
    // renders an absence, and the one report row in the comparison would
    // compare a result against a sentence saying there is none.
    const lines = committed.trimEnd().split("\n");
    const row = lines.find((line) => line.startsWith(`chr${REQUIRED_LOCUS.chrom}\t${REQUIRED_LOCUS.pos38}\t`));
    expect(row, "the required locus is in the fixture").toBeDefined();
    expect(row!.split("\t").at(-1)).toMatch(/1/);
  });

  it("covers the ancestry panel and the report catalogue, not one of them", () => {
    const rows = committed.trimEnd().split("\n").filter((line) => !line.startsWith("#"));
    // A floor either side: a fixture that lost the catalogue half would still
    // show the map, and one that lost the panel half would still render
    // reports. Neither would be this fixture.
    expect(rows.length).toBeGreaterThan(250);
    const positions = new Set(rows.map((line) => line.split("\t").slice(0, 2).join(":")));
    expect(positions.size).toBe(rows.length);
  });

  it("describes no real person, and says so in the file", () => {
    expect(committed).toContain("deterministic synthetic fixture; no real person");
  });
});
