import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { EMBRYO_INGEST_SESSION_LIMITS as LIMITS, INGEST_CHUNK_MAXIMUM_BYTES } from "../genome/ingest-limits";
import { embryoFileStream, embryoInputLines } from "./ingest-lines";
import { embryoVcfChunks, validateEmbryoVcfChunk } from "./vcf-transport";
import type { BrowserTransportBinding, ServerTransportBinding } from "./ingest-binding";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const binding: BrowserTransportBinding = { challenge: "q".repeat(43), revision: 2, build: "GRCh38", sampleCount: 2,
  handles: ["a".repeat(43), "b".repeat(43)] };
const server: ServerTransportBinding = { ...binding, resolveHandle: (handle) => {
  const index = binding.handles.indexOf(handle);
  return index < 0 ? null : index;
} };
const columns = "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tPRIVATE_LABEL_XX\tPRIVATE_LABEL_XY";
const row = "chr1\t123\trs123;PRIVATE_ID\tA\tG\t80\tPASS\tPRIVATE_NOTE=anything\tGT:DP:GQ:AD:PS\t0/1:12:40:6,6:PRIVATE_PHASE\t1|1:10:30:0,10:PRIVATE_PHASE";
const source = (rows = row, metadata = "") => `##fileformat=VCFv4.3\n##reference=GRCh38\n${metadata}${columns}\n${rows}\n`;
async function chunks(text = source(), state = binding) {
  return Array.fromAsync(embryoVcfChunks(new Blob([text]), state));
}
async function cleanText(text = source()) {
  return decoder.decode((await chunks(text))[0]);
}

describe("embryo VCF transport", () => {
  it("removes every free-text label before transport and partitions the exact sample calls", async () => {
    const transport = await chunks(source(row, '##SAMPLE=<ID=PRIVATE_SAMPLE,Sex=PRIVATE_VALUE>\n##source=PRIVATE_SOURCE\n'));
    const sent = decoder.decode(transport[0]);
    expect(sent).not.toContain("PRIVATE");
    expect(sent).toContain(binding.handles[0]);
    const fragments = validateEmbryoVcfChunk(transport[0], server);
    expect(fragments.map((fragment) => fragment.ordinal)).toEqual([0, 1]);
    expect(fragments[0].vcf).toContain("0/1:12:40:6,6");
    expect(fragments[0].vcf).not.toContain("1/1:10:30:0,10");
    expect(fragments[1].vcf).toContain("1/1:10:30:0,10");
    for (const { vcf } of fragments) {
      expect(vcf).not.toContain(binding.challenge);
      expect(vcf).not.toContain(binding.handles[0]);
      expect(vcf).not.toContain("PRIVATE");
      expect(vcf.split("\n").find((line) => line.startsWith("#CHROM"))?.split("\t")).toHaveLength(10);
    }
  });

  it("makes output identical when only forbidden contigs or metadata change", async () => {
    const discarded = ["X", "Y", "M", "MT", "23", "24", "25", "PAR1", "chrUn", "1_random", "__proto__"]
      .map((chrom) => `${chrom}\t1\t.\tA\tG\t.\t.\t.\tGT\t0/1\t0/0`).join("\n");
    expect(await cleanText(source(`${row}\n${discarded}`))).toBe(await cleanText());
  });

  it("retains partial no-calls, ploidy, allele indexes and reference-block boundaries", async () => {
    const block = "1\t200\t.\tA\t<NON_REF>\t.\t.\tEND=250\tGT:DP\t0/.:10\t.:.";
    const sent = await chunks(source(block));
    const fragments = validateEmbryoVcfChunk(sent[0], server);
    expect(fragments[0].vcf).toContain("END=250\tGT:DP:GQ:AD:FT:LEN\t0/.:10:.:.:.:.");
    expect(fragments[1].vcf).toContain(".:.:.:.");
  });

  it("preserves filter failure without carrying its source label", async () => {
    const text = await cleanText(source(row.replace("\tPASS\t", "\tPRIVATE_FILTER\t")));
    expect(text).toContain("\tFAIL\t");
    expect(text).not.toContain("PRIVATE_FILTER");
  });

  it("preserves per-sample filter failure even when the locus passed", async () => {
    const text = await cleanText(source(row.replace("AD:PS", "AD:FT")));
    expect(text).toContain("\tPASS\t");
    expect(text).toContain("0/1:12:40:6,6:FAIL");
    expect(text).not.toContain("PRIVATE_PHASE");
    expect(validateEmbryoVcfChunk(encoder.encode(text), server)[0].vcf).toContain(":FAIL");
  });

  it("does not merge distinct phase sets when dropping their source metadata", async () => {
    const first = "1\t100\t.\tA\tG\t.\tPASS\t.\tGT:PS\t0|1:100\t1|0:100";
    const second = "1\t200\t.\tC\tT\t.\tPASS\t.\tGT:PS\t0|1:200\t1|0:200";
    const text = await cleanText(source(`${first}\n${second}`));
    expect(text).not.toContain("|");
    const fragments = validateEmbryoVcfChunk(encoder.encode(text), server);
    expect(fragments[0].vcf).toContain("0/1:.:.:.:.");
    expect(() => validateEmbryoVcfChunk(encoder.encode(text.replace("0/1:", "0|1:")), server)).toThrow();
  });

  it("keeps each sample's reference span when LEN differs within one locus", async () => {
    const block = "1\t100\t.\tA\t<*>\t.\tPASS\tEND=199\tGT:LEN\t0/0:100\t0/0:10";
    const bytes = (await chunks(source(block).replace("VCFv4.3", "VCFv4.5")))[0];
    const fragments = validateEmbryoVcfChunk(bytes, server);
    expect(fragments[0].vcf).toContain("END=199");
    expect(fragments[1].vcf).toContain("END=109");
    expect(fragments[1].vcf).not.toContain("END=199");
    expect(fragments[0].vcf).toContain("0/0:.:.:.:.:100");
    expect(fragments[1].vcf).toContain("0/0:.:.:.:.:10");
  });

  it("accepts lowercase alleles and initial phase separators without adding phase claims", async () => {
    expect(await cleanText(source(row.replace("\tA\tG\t", "\ta\tg\t")))).toBe(await cleanText());
    expect(await cleanText(source(row.replace("0/1:12", "|0/1:12")))).toBe(await cleanText());
  });

  it("reads gzip and concatenated gzip members with identical results", async () => {
    const text = source();
    for (const compressed of [gzipSync(text), Buffer.concat([gzipSync(text.slice(0, 33)), gzipSync(text.slice(33))])]) {
      const output = await Array.fromAsync(embryoVcfChunks(new Blob([compressed]), binding));
      expect(output).toEqual(await chunks(text));
    }
  });

  it("rejects truncated gzip instead of accepting its valid prefix", async () => {
    const compressed = gzipSync(source());
    await expect(Array.fromAsync(embryoVcfChunks(new Blob([compressed.subarray(0, -5)]), binding))).rejects.toMatchObject({ code: "unrecognised_format" });
  });

  it.each(["%PDF-1.7\nPRIVATE_DATA", "##fileformat=VCFv4.3\n"])("refuses unsupported or incomplete input without echoing it", async (text) => {
    await expect(chunks(text)).rejects.not.toHaveProperty("message", expect.stringContaining("PRIVATE"));
  });

  it("refuses a PDF inside gzip as well as an uncompressed PDF", async () => {
    await expect(chunks("%PDF-1.7\nPRIVATE_DATA")).rejects.toMatchObject({ code: "pdf_not_data" });
    await expect(Array.fromAsync(embryoVcfChunks(new Blob([gzipSync("%PDF-1.7\n")]), binding))).rejects.toMatchObject({ code: "pdf_not_data" });
  });

  it.each([
    row.replace("0/1:12", "0/2:12"),
    row.replace("0/1:12", "-1/0:12"),
    row.replace("0/1:12", "0e0/1:12"),
    row.replace(":12:40:", ":NaN:40:"),
    row.replace("6,6", "6"),
    row.replace("\t123\t", "\t0\t"),
    row.replace("\tA\tG\t", "\tA\tA]chrY:99]\t"),
    row.replace("PRIVATE_NOTE=anything", "END=100"),
    row.replace("PRIVATE_NOTE=anything", "END=200;END=300"),
    row.replace("GT:DP:GQ:AD:PS", "GT:DP:DP:AD:PS"),
    `${row}\textra`,
    `${row}\n${columns}`,
  ])("rejects malformed retained records and concatenated headers", async (bad) => {
    await expect(chunks(source(bad))).rejects.toMatchObject({ code: "unrecognised_format" });
  });

  it("requires the reserved sample count, unique source columns and unique issued handles", async () => {
    await expect(chunks(source().replace("PRIVATE_LABEL_XY", "PRIVATE_LABEL_XX"))).rejects.toThrow();
    await expect(chunks(source(), { ...binding, sampleCount: 1 })).rejects.toMatchObject({ code: "invalid_session" });
    await expect(chunks(source(), { ...binding, handles: [binding.handles[0], binding.handles[0]] })).rejects.toMatchObject({ code: "invalid_session" });
    await expect(chunks(source(), { ...binding, handles: ["PRIVATE_LABEL", binding.handles[1]] })).rejects.toMatchObject({ code: "invalid_session" });
  });

  it("does not silently change the source build to match the session", async () => {
    await expect(chunks(source().replace("GRCh38", "GRCh37"))).rejects.toMatchObject({ code: "build_unknown" });
    await expect(chunks(source(row, "##reference=hg19\n"))).rejects.toMatchObject({ code: "build_unknown" });
  });

  it("refuses a source with no retained records", async () => {
    await expect(chunks(source(row.replace("chr1", "chrX")))).rejects.toMatchObject({ code: "empty_after_parse" });
  });

  it("splits at logical lines, repeats the exact header and validates every output chunk", async () => {
    const rows = Array.from({ length: 70_000 }, (_, i) => row.replace("\t123\t", `\t${i + 1}\t`)).join("\n");
    const output = await chunks(source(rows));
    expect(output.length).toBeGreaterThan(1);
    let seen = 0;
    for (const bytes of output) {
      expect(bytes.length).toBeLessThanOrEqual(INGEST_CHUNK_MAXIMUM_BYTES);
      expect(bytes[bytes.length - 1]).toBe(10);
      const fragments = validateEmbryoVcfChunk(bytes, server);
      seen += fragments[0].vcf.split("\n").filter((line) => line && !line.startsWith("#")).length;
    }
    expect(seen).toBe(70_000);
  });

  it("rejects a stale challenge, changed build, wrong session or swapped ordinal map", async () => {
    const bytes = (await chunks())[0];
    for (const state of [{ ...server, revision: 3 }, { ...server, challenge: "z".repeat(43) },
      { ...server, build: "GRCh37" as const }, { ...server, resolveHandle: () => null },
      { ...server, resolveHandle: (handle: string) => 1 - binding.handles.indexOf(handle) }]) {
      expect(() => validateEmbryoVcfChunk(bytes, state)).toThrow();
    }
  });

  it("keeps all 64 reserved ordinals separate with a shared long reference allele", async () => {
    const handles = Array.from({ length: LIMITS.maximumSampleColumns }, (_, index) => String(index).padStart(43, "h"));
    const state = { ...binding, handles, sampleCount: handles.length };
    const labels = handles.map((_, index) => `PRIVATE_${index}`);
    const reference = "A".repeat(50_000);
    const text = `##fileformat=VCFv4.3\n##reference=GRCh38\n${columns.split("\t").slice(0, 9).join("\t")}\t${labels.join("\t")}\n1\t10\t.\t${reference}\tG\t.\tPASS\t.\tGT\t${handles.map((_, index) => index % 2 ? "1/1" : "0/1").join("\t")}\n`;
    const fragments = validateEmbryoVcfChunk((await chunks(text, state))[0], { ...state, resolveHandle: (handle) => handles.indexOf(handle) });
    expect(fragments).toHaveLength(64);
    fragments.forEach(({ ordinal, vcf }, index) => {
      expect(ordinal).toBe(index);
      expect(vcf).toContain(`\tEmbryo_${index + 1}\n`);
      expect(vcf).toContain(`\t${index % 2 ? "1/1" : "0/1"}:.:.:.:.:.\n`);
      expect(vcf).not.toContain("PRIVATE");
    });
  });

  it("server rejects injected metadata, headers, IDs and bad later records before returning any fragment", async () => {
    const text = await cleanText();
    for (const bad of [text.replace("##reference=GRCh38", "##reference=GRCh38\n##PRIVATE=secret"),
      text.replace("rs123", "PRIVATE_ID"), text.replace("GT:DP:GQ:AD:FT:LEN\t", "GT:DP:GQ:AD:FT:LEN:PRIVATE\t"),
      text + "PRIVATE_BAD_ROW\n", text.slice(0, -1)]) {
      expect(() => validateEmbryoVcfChunk(encoder.encode(bad), server)).toThrow();
    }
  });

  it("server independently discards sex-linked rows and emits no side channel", async () => {
    const text = await cleanText();
    const cleanRow = text.trimEnd().split("\n").at(-1)!;
    expect(validateEmbryoVcfChunk(encoder.encode(text + cleanRow.replace(/^1\t/, "chrY\t") + "\n"), server))
      .toEqual(validateEmbryoVcfChunk(encoder.encode(text), server));
  });
});

describe("bounded embryo input", () => {
  it("frames split UTF-8 and CRLF without changing text", async () => {
    const bytes = encoder.encode("first\r\nΩ\nlast");
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    } });
    expect(await Array.fromAsync(embryoInputLines(stream))).toEqual(["first", "Ω", "last"]);
  });

  it("cancels an oversized line without retaining it or copying source errors", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(LIMITS.maximumLogicalLineBytes + 1).fill(65));
    }, cancel() { cancelled = true; } });
    await expect(Array.fromAsync(embryoInputLines(stream))).rejects.toMatchObject({ code: "too_large" });
    expect(cancelled).toBe(true);
  });

  it("counts the complete decompressed stream against the input ceiling", async () => {
    let cancelled = false;
    const block = new Uint8Array(LIMITS.maximumLogicalLineBytes).fill(65);
    block[block.length - 1] = 10;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(block); }, cancel() { cancelled = true; } });
    // Drain without retaining the lines, including discarded metadata.
    await expect((async () => { for await (const line of embryoInputLines(stream)) void line; })())
      .rejects.toMatchObject({ code: "too_large" });
    expect(cancelled).toBe(true);
  }, 60_000);

  it.each([new Uint8Array([0xc3, 10]), encoder.encode("bad\u0000text\n")])("rejects invalid UTF-8 and control characters", async (bytes) => {
    await expect(Array.fromAsync(embryoInputLines(new Blob([bytes]).stream()))).rejects.toMatchObject({ code: "unrecognised_format" });
  });

  it("cancels upstream input when the consumer stops early", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(encoder.encode("line\n")); }, cancel() { cancelled = true; } });
    for await (const line of embryoInputLines(stream)) { expect(line).toBe("line"); break; }
    expect(cancelled).toBe(true);
  });

  it("preflights a PDF without opening a stream", async () => {
    await expect(embryoFileStream(new Blob(["%PDF-1.7"]))).rejects.toMatchObject({ code: "pdf_not_data" });
  });
});
