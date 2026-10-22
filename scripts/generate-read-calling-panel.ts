/**
 * Builds `data/ref/read-calling-loci.json`: the positions Inherit's targeted
 * read caller asks about (G7.4, ADR 0038). It is exactly the product's own
 * GRCh38 single-letter positions whose reference and alternate letters the
 * product data states:
 *
 * - every report-template variant (`data/templates/*.json`);
 * - every ancestry marker (`data/ref/aims.json`, `data/ref/aims-seven-region.json`);
 * - every single-letter carrier assertion in `data/ref/carrier/clinvar-assertions.json`.
 *
 * Polygenic-score positions and lineage markers are not in it: the score
 * files name an effect letter and another letter without saying which one is
 * the GRCh38 reference, and lineage reads one-copy chromosomes this diploid
 * rule does not call. Both are recorded as open work in ADR 0038.
 *
 * One row per position. Alternates are kept in priority order (report, then
 * ancestry, then carrier, then letter order), and the row's rsID is the first
 * one stated in that order.
 *
 * Run: corepack pnpm exec tsx scripts/generate-read-calling-panel.ts [--check]
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PANEL_PATH = "data/ref/read-calling-loci.json";
type Source = "report" | "ancestry" | "carrier";
const PRIORITY: Record<Source, number> = { report: 0, ancestry: 1, carrier: 2 };

interface Entry { chrom: number; pos: number; ref: string; alt: string; rsid: number | null; source: Source; }

export interface ReadCallingPanelFile {
  schemaVersion: 1;
  version: "product-loci-v1";
  build: "GRCh38";
  generator: string;
  sources: Record<Source, number>;
  columns: ["chrom", "pos", "ref", "alts", "rsid", "sources"];
  loci: [number, number, string, string[], number | null, Source[]][];
}

const single = (letter: unknown): letter is string => typeof letter === "string" && /^[ACGT]$/.test(letter);

export function productEntries(root: string): Entry[] {
  const entries: Entry[] = [];
  const templates = path.join(root, "data/templates");
  for (const file of readdirSync(templates).filter((name) => name.endsWith(".json")).sort()) {
    const rows = JSON.parse(readFileSync(path.join(templates, file), "utf8")) as {
      variants?: { rsid: number; chrom: number; pos38: number; ref: string; alt: string }[] | null;
    }[];
    for (const template of rows) for (const variant of template.variants ?? []) {
      if (single(variant.ref) && single(variant.alt) && variant.ref !== variant.alt) {
        entries.push({ chrom: variant.chrom, pos: variant.pos38, ref: variant.ref, alt: variant.alt, rsid: variant.rsid, source: "report" });
      }
    }
  }
  for (const file of ["data/ref/aims.json", "data/ref/aims-seven-region.json"]) {
    const rows = JSON.parse(readFileSync(path.join(root, file), "utf8")) as
      { rsid: string | number; chrom: number; pos38: number; ref: string; alt: string }[];
    for (const marker of rows) {
      const rsid = typeof marker.rsid === "number" ? marker.rsid : Number(String(marker.rsid).replace(/^rs/i, ""));
      if (single(marker.ref) && single(marker.alt) && marker.ref !== marker.alt) {
        entries.push({ chrom: marker.chrom, pos: marker.pos38, ref: marker.ref, alt: marker.alt, rsid, source: "ancestry" });
      }
    }
  }
  const carrier = JSON.parse(readFileSync(path.join(root, "data/ref/carrier/clinvar-assertions.json"), "utf8")) as {
    columns: string[]; assertions: unknown[][];
  };
  const rsidAt = carrier.columns.indexOf("rsid"), grch38At = carrier.columns.indexOf("grch38");
  assert(rsidAt >= 0 && grch38At >= 0, "carrier columns");
  for (const assertion of carrier.assertions) {
    const grch38 = assertion[grch38At] as [number, number, string, string] | null;
    if (!grch38) continue;
    const [chrom, pos, ref, alt] = grch38;
    if (single(ref) && single(alt) && ref !== alt) {
      entries.push({ chrom, pos, ref, alt, rsid: (assertion[rsidAt] as number | null) ?? null, source: "carrier" });
    }
  }
  return entries;
}

export function buildReadCallingPanel(root: string): ReadCallingPanelFile {
  const entries = productEntries(root);
  const byPosition = new Map<string, Entry[]>();
  for (const entry of entries) {
    assert(Number.isInteger(entry.chrom) && entry.chrom >= 1 && entry.chrom <= 23, `chromosome ${entry.chrom}`);
    assert(Number.isSafeInteger(entry.pos) && entry.pos > 0, "position");
    const key = `${entry.chrom}:${entry.pos}`;
    byPosition.set(key, [...(byPosition.get(key) ?? []), entry]);
  }
  const loci: ReadCallingPanelFile["loci"] = [];
  for (const group of byPosition.values()) {
    const refs = new Set(group.map((entry) => entry.ref));
    assert.equal(refs.size, 1, `one reference letter at ${group[0].chrom}:${group[0].pos}`);
    const ordered = [...group].sort((a, b) => PRIORITY[a.source] - PRIORITY[b.source] || a.alt.localeCompare(b.alt));
    const alts = [...new Set(ordered.map((entry) => entry.alt))];
    const rsid = ordered.find((entry) => entry.rsid !== null)?.rsid ?? null;
    const sources = [...new Set(ordered.map((entry) => entry.source))];
    loci.push([group[0].chrom, group[0].pos, group[0].ref, alts, rsid, sources]);
  }
  loci.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const count = (source: Source) => loci.filter((row) => row[5].includes(source)).length;
  return {
    schemaVersion: 1, version: "product-loci-v1", build: "GRCh38",
    generator: "scripts/generate-read-calling-panel.ts",
    sources: { report: count("report"), ancestry: count("ancestry"), carrier: count("carrier") },
    columns: ["chrom", "pos", "ref", "alts", "rsid", "sources"], loci,
  };
}

export function serializePanel(panel: ReadCallingPanelFile): string {
  const head = JSON.stringify({ ...panel, loci: undefined }, null, 2).replace(/\n}$/, "");
  return `${head},\n  "loci": [\n${panel.loci.map((row) => `    ${JSON.stringify(row)}`).join(",\n")}\n  ]\n}\n`;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  assert(process.argv.slice(2).every((argument) => argument === "--check"));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const text = serializePanel(buildReadCallingPanel(root));
  if (process.argv.includes("--check")) {
    assert.equal(readFileSync(path.join(root, PANEL_PATH), "utf8"), text, `${PANEL_PATH} is stale`);
    console.log(`${PANEL_PATH}: verified`);
  } else {
    writeFileSync(path.join(root, PANEL_PATH), text);
    console.log(`${PANEL_PATH}: generated`);
  }
}
