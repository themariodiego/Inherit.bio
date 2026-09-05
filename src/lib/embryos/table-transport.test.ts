import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { detectPgtHeader, planMapping, type CompleteMapping } from "../genome/parsers/pgt-table";
import { INGEST_CHUNK_MAXIMUM_BYTES } from "../genome/ingest-limits";
import { embryoTableChunks, validateEmbryoTableChunk, type TableBrowserBinding, type TableServerBinding } from "./table-transport";

const mapping: CompleteMapping = { complete: true, identifier: { field: "sample", column: 0 },
  genotype: 2, locus: { kind: "rsid", column: 1 } };
const binding: TableBrowserBinding = { challenge: "q".repeat(43), revision: 1, build: "GRCh38", sampleCount: 2,
  handles: ["a".repeat(43), "b".repeat(43)], mapping };
const server: TableServerBinding = { ...binding, locusKind: "rsid", resolveHandle: (handle) => {
  const index = binding.handles.indexOf(handle);
  return index < 0 ? null : index;
}, resolveRsid: (id) => id === 999 ? { chrom: 24, pos: 12 } : { chrom: 1, pos: id } };
const source = "Sample,rsID,Genotype,Sex,Private note\nPRIVATE_A,rs123,AG,XX,PRIVATE_TEXT\nPRIVATE_B,rs123,GG,XY,PRIVATE_TEXT\nPRIVATE_A,rs124,AA,XX,PRIVATE_TEXT\n";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
async function chunks(text = source, state = binding) {
  return Array.fromAsync(embryoTableChunks(new Blob([text]), state));
}

describe("embryo laboratory-table transport", () => {
  it("uses the existing header rule, sends only chosen fields and keeps stable ordinals", async () => {
    expect(planMapping(detectPgtHeader(source.split("\n")[0])!)).toEqual(mapping);
    const output = (await chunks())[0];
    expect(decoder.decode(output)).not.toMatch(/PRIVATE|Sex|XX|XY/);
    expect(validateEmbryoTableChunk(output, server)).toEqual([
      { ordinal: 0, chrom: 1, pos: 123, rsid: 123, genotype: "A/G" },
      { ordinal: 1, chrom: 1, pos: 123, rsid: 123, genotype: "G/G" },
      { ordinal: 0, chrom: 1, pos: 124, rsid: 124, genotype: "A/A" },
    ]);
  });

  it("handles quoted labels, delimiters and escaped quotes without sending them", async () => {
    const quoted = source.replaceAll("PRIVATE_A", '"PRIVATE,A"').replaceAll("PRIVATE_B", '"PRIVATE""B"');
    expect(await chunks(quoted)).toEqual(await chunks());
  });

  it("supports tab-delimited and gzip source tables", async () => {
    expect(await chunks(source.replaceAll(",", "\t"))).toEqual(await chunks());
    expect(await Array.fromAsync(embryoTableChunks(new Blob([gzipSync(source)]), binding))).toEqual(await chunks());
  });

  it("keeps missing and partially called genotypes without inventing an allele", async () => {
    const bytes = (await chunks(source.replace(",AG,", ",--,").replace(",GG,", ",G/.,")))[0];
    expect(validateEmbryoTableChunk(bytes, server).map((row) => row.genotype)).toEqual(["./.", "G/.", "A/A"]);
  });

  it("does not claim cross-record phasing without phase-set provenance", async () => {
    const bytes = (await chunks(source.replace(",AG,", ",A|G,")))[0];
    expect(validateEmbryoTableChunk(bytes, server)[0].genotype).toBe("A/G");
    expect(() => validateEmbryoTableChunk(encoder.encode(decoder.decode(bytes).replace("A/G", "A|G")), server)).toThrow();
  });

  it("resolves rsIDs on the server and drops non-autosomal loci without a marker", async () => {
    const bytes = (await chunks(source.replaceAll("rs123", "rs999")))[0];
    expect(validateEmbryoTableChunk(bytes, server)).toEqual([{ ordinal: 0, chrom: 1, pos: 124, rsid: 124, genotype: "A/A" }]);
    const onlyExcluded = (await chunks(source.replaceAll(/rs12[34]/g, "rs999")))[0];
    expect(validateEmbryoTableChunk(onlyExcluded, server)).toEqual([]);
  });

  it.each(["", "."])("resolves an rsID when the unused chromosome column is missing (%s)", async (missing) => {
    const text = `Sample,rsID,Genotype,Chromosome\nPRIVATE_A,rs123,AG,${missing}\nPRIVATE_B,rs124,GG,${missing}\n`;
    const rows = validateEmbryoTableChunk((await chunks(text))[0], server);
    expect(rows.map((row) => row.pos)).toEqual([123, 124]);
  });

  it("rejects an unresolved reference locus before returning any earlier rows", async () => {
    const bytes = (await chunks())[0];
    expect(() => validateEmbryoTableChunk(bytes, { ...server, resolveRsid: (id) => id === 124 ? null : { chrom: 1, pos: id } })).toThrow();
  });

  it("emits only closed fields even if a reference lookup returns extra metadata", async () => {
    const rows = validateEmbryoTableChunk((await chunks())[0], { ...server,
      resolveRsid: () => ({ chrom: 1, pos: 20, privateLabel: "PRIVATE_DATA" }) });
    expect(rows.every((row) => Object.keys(row).sort().join() === "chrom,genotype,ordinal,pos,rsid")).toBe(true);
  });

  it("supports coordinate mappings and strips non-autosomal rows on both sides", async () => {
    const text = "Embryo,Chromosome,Position,Genotype,Sex\nPRIVATE_A,chr1,123,AG,XX\nPRIVATE_B,chr2,456,G/G,XY\nPRIVATE_A,chrY,500,G/G,XX\n";
    const coordinateMapping = planMapping(detectPgtHeader(text.split("\n")[0])!) as CompleteMapping;
    const output = (await chunks(text, { ...binding, mapping: coordinateMapping }))[0];
    const state = { ...server, locusKind: "chrom-pos" as const };
    expect(validateEmbryoTableChunk(output, state)).toEqual([
      { ordinal: 0, chrom: 1, pos: 123, rsid: null, genotype: "A/G" },
      { ordinal: 1, chrom: 2, pos: 456, rsid: null, genotype: "G/G" },
    ]);
    const injected = encoder.encode(decoder.decode(output) + `${binding.handles[0]}\tchrY\t500\tG/G\n`);
    expect(validateEmbryoTableChunk(injected, state)).toEqual(validateEmbryoTableChunk(output, state));
  });

  it.each([
    source.replace(",AG,", ",karyotype,"), source.replace("rs123", "rs123PRIVATE"),
    source.replace("PRIVATE_A,rs123", '"PRIVATE_A,rs123'),
    source.replace("PRIVATE_A,rs123", '"PRIVATE_A"junk,rs123'),
    source.replace("PRIVATE_A,rs124", "PRIVATE_C,rs124"),
    source.replaceAll("PRIVATE_B", "PRIVATE_A"), source.replace("PRIVATE_B,", ","),
    source + "Sample,rsID,Genotype,Sex,Private note\n",
  ])("refuses malformed calls, quoting, counts and repeated headers", async (text) => {
    await expect(chunks(text)).rejects.toThrow();
  });

  it("rejects a mapping into a forbidden, duplicated or out-of-range column", async () => {
    for (const genotype of [0, 1, 3, 999, -1, 1.5]) {
      await expect(chunks(source, { ...binding, mapping: { ...mapping, genotype } })).rejects.toThrow();
    }
  });

  it("rejects a stale or mismatched server decision and unknown handles", async () => {
    const bytes = (await chunks())[0];
    for (const state of [{ ...server, revision: 2 }, { ...server, build: "GRCh37" as const },
      { ...server, locusKind: "chrom-pos" as const }, { ...server, resolveHandle: () => null },
      { ...server, resolveHandle: () => 2 }, { ...server, resolveHandle: () => 0.5 }]) {
      expect(() => validateEmbryoTableChunk(bytes, state)).toThrow();
    }
  });

  it("rejects extra columns, private labels and incomplete logical lines on the server", async () => {
    const text = decoder.decode((await chunks())[0]);
    for (const value of [text.replace("sample\trsid\tgenotype", "sample\trsid\tgenotype\tsex"),
      text.replace(binding.handles[0], "PRIVATE_LABEL"), text.replace("A/G\n", "A/G\tXX\n"), text.slice(0, -1)]) {
      expect(() => validateEmbryoTableChunk(encoder.encode(value), server)).toThrow();
    }
  });

  it("repeats the exact header at chunk boundaries without losing table records", async () => {
    const rows = Array.from({ length: 80_000 }, (_, index) => `PRIVATE_${index % 2},rs${index + 1},AG`).join("\n");
    const output = await chunks(`Sample,rsID,Genotype\n${rows}\n`);
    expect(output.length).toBeGreaterThan(1);
    let count = 0;
    for (const bytes of output) {
      expect(bytes.byteLength).toBeLessThanOrEqual(INGEST_CHUNK_MAXIMUM_BYTES);
      expect(bytes[bytes.byteLength - 1]).toBe(10);
      const validated = validateEmbryoTableChunk(bytes, { ...server, resolveRsid: (id) => ({ chrom: 1, pos: id }) });
      expect(validated[0].pos).toBe(count + 1);
      count += validated.length;
    }
    expect(count).toBe(80_000);
  });
});
