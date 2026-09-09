import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { streamVcf } from "../genome/parsers/vcf";
import { readOwnPreparationLines, scanOwnPreparationSource, type OwnPreparationSourceOptions } from "./own-preparation-source";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const header = "##fileformat=VCFv4.2\n##reference=GRCh38\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tS\n";
const row = "15\t74749576\trs762551\tC\tA\t.\tPASS\t.\tGT\t0/1\n";
function fixture(text = header + row, gzip = false) {
  const decoded = Buffer.from(text), raw = gzip ? gzipSync(decoded) : decoded;
  const calls: [number, number][] = [];
  const check = vi.fn(async () => {});
  const options: OwnPreparationSourceOptions = {
    source: { fileId: "11111111-1111-4111-8111-111111111111", subjectId: "22222222-2222-4222-8222-222222222222",
      sourceRevision: 1, rawSha256: sha(raw), decodedSha256: sha(decoded), bucket: "genomes",
      objectId: "33333333-3333-4333-8333-333333333333", objectKey: "44444444-4444-4444-8444-444444444444",
      sizeBytes: raw.length, fileType: "vcf", maximumDecodedBytes: decoded.length },
    signal: new AbortController().signal, check,
    readRange: vi.fn(async (_source, start, end) => { calls.push([start, end]);
      return new Response(Uint8Array.from(raw.subarray(start, end + 1)), {
        status: 206, headers: { "content-range": `bytes ${start}-${end}/${raw.length}`, "content-length": String(end - start + 1) },
      }); }),
  };
  return { options, calls, check, raw, decoded };
}
async function collect<T>(source: AsyncIterable<T>) { const out: T[] = []; for await (const x of source) out.push(x); return out; }
describe("own preparation original reader", () => {
  it("early return cancels a prefetched network range even while caller remains live", async () => {
    const f = fixture(header + row.repeat(Math.ceil(4_100_000 / row.length)));
    const scan = await scanOwnPreparationSource(f.options), cancel = vi.fn();
    const normal = f.options.readRange; let prefetched = false;
    f.options.readRange = async (source, start, end, signal) => {
      if (start === 0) return normal(source, start, end, signal);
      prefetched = true;
      return new Response(new ReadableStream({ cancel }), { status: 206,
        headers: { "content-range": `bytes ${start}-${end}/${f.raw.length}` } });
    };
    const lines = readOwnPreparationLines(f.options, scan);
    await lines.next();
    for (let i = 0; i < 100 && !prefetched; i++) await new Promise(r => setTimeout(r, 1));
    expect(prefetched).toBe(true);
    await lines.return(undefined); await new Promise(r => setTimeout(r, 1));
    expect(f.options.signal.aborted).toBe(false); expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("hashes actual raw/decoded bytes then replays exact parser input (gzip=%s)", async gzip => {
    const f = fixture(header + row + "1\t2\trs2\tA\tC\t.\tLowQual\t.\tGT\t./.\n", gzip);
    const scan = await scanOwnPreparationSource(f.options);
    expect(scan).toMatchObject({ rawSha256: sha(f.raw), decodedSha256: sha(f.decoded), compressed: gzip, build: "GRCh38", lineCount: 5 });
    const events = await collect(streamVcf(readOwnPreparationLines(f.options, scan)));
    expect(events.find(e => e.type === "variant")).toMatchObject({ record: { genotype: "A/C", rsid: 762551 } });
    expect(events.at(-1)).toMatchObject({ type: "summary", observedCallsValid: true, variantCount: 1, observedCallCount: 2 });
    expect(f.check).toHaveBeenCalledTimes(6);
  });
  it("accepts exact GRCh37 and a final line without newline", async () => {
    const f = fixture((header + row).replace("GRCh38", "GRCh37").trimEnd());
    expect(await scanOwnPreparationSource(f.options)).toMatchObject({ build: "GRCh37", lineCount: 4 });
  });
  it("handles CRLF and UTF-8 across response chunks", async () => {
    const f = fixture((header.replace("##reference", "##comment=é\n##reference") + row).replaceAll("\n", "\r\n"));
    f.options.readRange = async (_s, a, b) => new Response(new ReadableStream({ start(controller) {
      for (const byte of f.raw.subarray(a, b + 1)) controller.enqueue(Uint8Array.of(byte)); controller.close();
    } }), { status: 206, headers: { "content-range": `bytes ${a}-${b}/${f.raw.length}` } });
    expect((await scanOwnPreparationSource(f.options)).lineCount).toBe(5);
  });
  it.each(["rawSha256", "decodedSha256"] as const)("rejects wrong %s at true EOF", async field => {
    const f = fixture(); f.options.source[field] = "a".repeat(64);
    await expect(scanOwnPreparationSource(f.options)).rejects.toMatchObject({ code: "integrity_mismatch" });
  });
  it.each([200, 404])("rejects provider status %s without interpreting its body", async status => {
    const f = fixture(); f.options.readRange = async () => new Response("opaque provider body", { status });
    await expect(scanOwnPreparationSource(f.options)).rejects.toMatchObject({ code: "invalid_range" });
  });
  it.each(["wrong-range", "short", "long", "encoding"])("rejects %s response", async failure => {
    const f = fixture(); f.options.readRange = async (_s, a, b) => new Response(
      failure === "short" ? f.raw.subarray(1) : failure === "long" ? Buffer.concat([f.raw, Buffer.from("x")]) : f.raw,
      { status: 206, headers: { "content-range": failure === "wrong-range" ? `bytes 1-${b}/${f.raw.length}` : `bytes ${a}-${b}/${f.raw.length}`,
        ...(failure === "encoding" ? { "content-encoding": "gzip" } : {}) } });
    await expect(scanOwnPreparationSource(f.options)).rejects.toMatchObject({ code: "invalid_range" });
  });
  it.each([header.replace("GRCh38", "unknown") + row, header.replace("##reference=GRCh38", "##reference=GRCh38\n##reference=GRCh37") + row])("rejects absent/conflicting build", async text => {
    await expect(scanOwnPreparationSource(fixture(text).options)).rejects.toMatchObject({ code: "unsupported_build" });
  });
  it.each([header + row + header, header.replace("\tS\n", "\tS\tT\n") + row, header + row + "##reference=GRCh38\n"])("refuses late or multisample headers", async text => {
    await expect(scanOwnPreparationSource(fixture(text).options)).rejects.toMatchObject({ code: "invalid_vcf" });
  });
  it("refuses gzip expansion beyond exact source bound", async () => {
    const f = fixture(header + row, true); f.options.source.maximumDecodedBytes--;
    await expect(scanOwnPreparationSource(f.options)).rejects.toMatchObject({ code: "too_large" });
  });
  it("refuses malformed UTF-8", async () => {
    const f = fixture(); const bytes = Buffer.concat([f.raw, Buffer.from([0xff])]);
    f.options.source.sizeBytes = bytes.length; f.options.source.maximumDecodedBytes = bytes.length;
    f.options.readRange = async (_s, a, b) => new Response(bytes, { status: 206, headers: { "content-range": `bytes ${a}-${b}/${bytes.length}` } });
    await expect(scanOwnPreparationSource(f.options)).rejects.toMatchObject({ code: "invalid_vcf" });
  });
  it("refuses changed replay before a parser terminal", async () => {
    const f = fixture(), scan = await scanOwnPreparationSource(f.options);
    const changed = Buffer.from((header + row).replace("0/1", "1/1"));
    f.options.readRange = async (_s, a, b) => new Response(changed, { status: 206, headers: { "content-range": `bytes ${a}-${b}/${changed.length}` } });
    const events: unknown[] = [];
    await expect((async () => { for await (const e of streamVcf(readOwnPreparationLines(f.options, scan))) events.push(e); })())
      .rejects.toMatchObject({ code: "integrity_mismatch" });
    expect(events.some(e => (e as { type: string }).type === "summary")).toBe(false);
  });
  it("refuses a cross-source scan before any I/O", async () => {
    const f = fixture(), scan = await scanOwnPreparationSource(f.options); f.calls.length = 0;
    scan.source.sourceRevision++;
    await expect(collect(readOwnPreparationLines(f.options, scan))).rejects.toMatchObject({ code: "invalid_source" });
    expect(f.calls).toHaveLength(0);
  });
  it("cancels a stalled response and suppresses provider diagnostics", async () => {
    const f = fixture(), abort = new AbortController(), cancel = vi.fn(); f.options.signal = abort.signal;
    f.options.readRange = async (_s, a, b) => new Response(new ReadableStream({ cancel }),
      { status: 206, headers: { "content-range": `bytes ${a}-${b}/${f.raw.length}` } });
    const pending = scanOwnPreparationSource(f.options); await new Promise(r => setTimeout(r, 5)); abort.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" }); expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("cancels a response resolving after abort and never reissues the request", async () => {
    const f = fixture(), abort = new AbortController(), cancel = vi.fn(); f.options.signal = abort.signal;
    let resolve!: (r: Response) => void;
    f.options.readRange = vi.fn(() => new Promise<Response>(r => { resolve = r; }));
    const pending = scanOwnPreparationSource(f.options); await new Promise(r => setTimeout(r, 5)); abort.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    resolve(new Response(new ReadableStream({ cancel }))); await new Promise(r => setTimeout(r, 5));
    expect(cancel).toHaveBeenCalledTimes(1); expect(f.options.readRange).toHaveBeenCalledTimes(1);
  });
  it("checks authority after complete range EOF and again after whole source verification", async () => {
    const f = fixture(); f.check.mockImplementationOnce(async () => {}).mockImplementationOnce(async () => {}).mockRejectedValueOnce(new Error("private diagnostic"));
    await expect(scanOwnPreparationSource(f.options)).rejects.toMatchObject({ code: "invalid_vcf", message: "invalid_vcf" });
  });
});
