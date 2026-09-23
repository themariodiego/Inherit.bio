import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { syntheticArray } from "./generate-synthetic-sample";
import { parseArray } from "../src/lib/genome/parsers/array";
import { sniff } from "../src/lib/genome/parsers/sniff";
import { buildLiftover, liftSingleBaseVariant } from "../src/lib/genome/liftover";
import recipe from "../data/samples/synthetic-array-recipe.json";
import bindings from "./comprehension/bindings.json";
import register from "../docs/route-register.json";

const ROOT = process.cwd();
const text = readFileSync(path.join(ROOT, "data/samples/synthetic_23andme.txt"), "utf8");
const lift = buildLiftover(readFileSync(path.join(ROOT, "data/ref/chain/GRCh37_to_GRCh38.chain.gz")));
const templates = readdirSync(path.join(ROOT, "data/templates")).filter(name => name.endsWith(".json"))
  .flatMap(name => JSON.parse(readFileSync(path.join(ROOT, "data/templates", name), "utf8")) as
    { slug: string; variants: { rsid: number; chrom: number; pos38: number }[] }[]);
async function parse() {
  async function* lines() { yield* text.split("\n"); }
  return parseArray(lines(), "array_23andme");
}

describe("the synthetic array can traverse the real preparation coordinate boundary", () => {
  it("reproduces the committed bytes offline without regenerating report calls", () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network permitted"));
    try {
      const generated = syntheticArray(ROOT);
      expect(generated.text).toBe(text);
      expect(generated.repaired).toBe(850);
      expect(fetch).not.toHaveBeenCalled();
      const rows = new Map(text.split("\n").filter(line => line && !line.startsWith("#"))
        .map(line => { const fields = line.split("\t"); return [Number(fields[0].slice(2)), fields.slice(1)] as const; }));
      for (const call of recipe.calls) {
        expect(rows.get(call.rsid)).toEqual([call.chrom, String(call.pos37), call.genotype]);
      }
    } finally { fetch.mockRestore(); }
  });

  it("is detected as the declared array format and loses no call through the shipped chain", async () => {
    expect(sniff(new TextEncoder().encode(text))).toEqual({ kind: "array_23andme", compressed: false });
    const parsed = await parse();
    expect(parsed.build).toBe("GRCh37");
    expect(parsed.skipped).toBe(0);
    expect(parsed.records).toHaveLength(2135);
    const mapped = parsed.records.map(record => liftSingleBaseVariant(record, lift));
    const losses = mapped.filter(record => record === null).length;
    expect(losses).toBe(0);
    expect(losses / parsed.records.length).toBeLessThanOrEqual(
      register.policyContracts["genome-liftover-v1"].maximumUnmappedFraction,
    );
    expect(new Set(parsed.records.map(record => `${record.chrom}:${record.pos}`)).size).toBe(2135);
    expect(new Set(mapped.map(record => `${record!.chrom}:${record!.pos}`)).size).toBe(2135);
  });

  it("preserves T1's three actual loci and keeps every T3 medicine locus absent", async () => {
    const mapped = (await parse()).records.map(record => liftSingleBaseVariant(record, lift)!);
    const byRsid = new Map(mapped.map(record => [record.rsid, record]));
    const positions = new Set(mapped.map(record => `${record.chrom}:${record.pos}`));
    for (const taskId of ["T1", "T3"]) {
      const task = bindings.tasks.find(task => task.id === taskId)!;
      for (const slug of task.templateSlugs) {
        const template = templates.find(template => template.slug === slug)!;
        for (const variant of template.variants) {
          if (taskId === "T1") {
            expect(byRsid.get(variant.rsid)).toMatchObject({ chrom: variant.chrom, pos: variant.pos38 });
          } else {
            expect(byRsid.has(variant.rsid)).toBe(false);
            expect(positions.has(`${variant.chrom}:${variant.pos38}`)).toBe(false);
          }
        }
      }
    }
  });
});
