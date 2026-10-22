import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateReadCallingFiles, MATRIX_RECEIPT, PRODUCT_RECEIPT } from "./generate-read-calling-fixtures";
import { buildReadCallingPanel, PANEL_PATH, productEntries, serializePanel } from "./generate-read-calling-panel";

/**
 * The read-calling inputs are generated, never hand-edited (G7.4, ADR 0038).
 * The committed bytes must equal what the in-repository generators write
 * now, and each receipt must pin the SHA-256 of the file it describes.
 */

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("invented read files", () => {
  const generated = generateReadCallingFiles(process.cwd());

  it("are byte-identical to a fresh run of the generator", () => {
    expect(generated.map((file) => file.path)).toEqual([
      "src/lib/genome/reads/fixtures/synthetic-reference.fa",
      "src/lib/genome/reads/fixtures/synthetic-matrix.bam",
      "src/lib/genome/reads/fixtures/synthetic-matrix.cram",
      "src/lib/genome/reads/fixtures/synthetic-matrix.receipt.json",
      "e2e/fixtures/read-calls-product-grch38.bam",
      "e2e/fixtures/read-calls-product-grch38.receipt.json",
    ]);
    for (const file of generated) expect([file.path, sha256(readFileSync(file.path))]).toEqual([file.path, sha256(file.bytes)]);
  });

  it("pin each file's hash in its receipt, and stay well under a megabyte", () => {
    const matrix = JSON.parse(readFileSync(MATRIX_RECEIPT, "utf8")) as { files: Record<string, { sha256: string; bytes: number }> };
    for (const [name, pinned] of Object.entries(matrix.files)) {
      const bytes = readFileSync(`src/lib/genome/reads/fixtures/${name}`);
      expect([name, bytes.length, sha256(bytes)]).toEqual([name, pinned.bytes, pinned.sha256]);
      expect(bytes.length).toBeLessThan(100_000);
    }
    const product = JSON.parse(readFileSync(PRODUCT_RECEIPT, "utf8")) as { file: { name: string; sha256: string; bytes: number } };
    const bytes = readFileSync(`e2e/fixtures/${product.file.name}`);
    expect([bytes.length, sha256(bytes)]).toEqual([product.file.bytes, product.file.sha256]);
    expect(bytes.length).toBeLessThan(100_000);
  });

  it("say what they are: invented, from no person, sample or genome", () => {
    for (const receipt of [MATRIX_RECEIPT, PRODUCT_RECEIPT]) {
      expect(JSON.parse(readFileSync(receipt, "utf8")).classification).toMatch(/^invented reads .*; no person, sample or real genome$/);
    }
  });
});

describe("the read-calling panel", () => {
  it("is exactly what the generator builds from the product's own data files", () => {
    expect(readFileSync(PANEL_PATH, "utf8")).toBe(serializePanel(buildReadCallingPanel(process.cwd())));
  });

  it("holds every single-letter report, ancestry and carrier position, once each", () => {
    const panel = buildReadCallingPanel(process.cwd());
    const positions = new Set(panel.loci.map(([chrom, pos]) => `${chrom}:${pos}`));
    expect(positions.size).toBe(panel.loci.length);
    for (const entry of productEntries(process.cwd())) {
      const row = panel.loci.find(([chrom, pos]) => chrom === entry.chrom && pos === entry.pos);
      expect(row, `${entry.source} ${entry.chrom}:${entry.pos}`).toBeDefined();
      expect(row![2]).toBe(entry.ref);
      expect(row![3]).toContain(entry.alt);
      expect(row![5]).toContain(entry.source);
    }
    expect(panel.sources).toEqual({ report: 145, ancestry: 168, carrier: 1716 });
    expect(panel.loci.length).toBe(2024);
  });

  it("names a report position's own rsID and alternate first, so a reference call still matches the report", () => {
    const panel = buildReadCallingPanel(process.cwd());
    for (const entry of productEntries(process.cwd()).filter((item) => item.source === "report")) {
      const row = panel.loci.find(([chrom, pos]) => chrom === entry.chrom && pos === entry.pos)!;
      expect([row[3][0], row[4]]).toEqual([entry.alt, entry.rsid]);
    }
  });
});
