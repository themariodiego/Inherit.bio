import { beforeAll, describe, expect, it, vi } from "vitest";
import { materializeCanonicalMerge } from "./materialize-canonical";
import { fixture, row, sink, values, jobId, attemptId } from "./materialize-canonical.fixtures";
import { streamPreparedExportRecords, type PreparedExportReadOptions } from "./export-reader";
import type { CanonicalRecord } from "./canonical-schema";

async function setup(rows?: string[], build: "GRCh37" | "GRCh38" = "GRCh38") {
  const f = await fixture(rows, build), out = sink();
  const manifest = await materializeCanonicalMerge(values(f.output), { ...f, ...out, jobId, attemptId, firstArtifactSequence: 7 });
  return { ...f, ...out, manifest, expected: { binding: f.binding, jobId, attemptId } };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
let baseline: Fixture, multiple: Fixture, lifted: Fixture;
beforeAll(async () => {
  baseline = await setup(); multiple = await setup(Array.from({ length: 1100 }, (_, i) => row(i + 1)));
  lifted = await setup(undefined, "GRCh37");
});
function options(f: Fixture): PreparedExportReadOptions {
  return { check: vi.fn(async () => {}), readArtifact: vi.fn(artifact => {
    const bytes = f.objects.get(artifact.receipt.objectKey); if (!bytes) throw Error("private provider error");
    return values([bytes.subarray(0, 3), bytes.subarray(3)]);
  }) };
}
async function collect(f: Fixture, supplied = options(f)) {
  const records: CanonicalRecord[] = [];
  for await (const page of streamPreparedExportRecords(f.manifest, f.expected, supplied)) records.push(...page);
  return records;
}

describe("complete prepared export block stream", () => {
  it("preserves every original event and disposition, including duplicate, reference, no-call and unsupported allele evidence", async () => {
    const opts = options(baseline), records = await collect(baseline, opts);
    expect(records).toEqual(baseline.records);
    expect(new Set(records.map(r => r.normalization.status))).toEqual(new Set(baseline.records.map(r => r.normalization.status)));
    expect(opts.readArtifact).toHaveBeenCalledTimes(baseline.objects.size);
    expect(vi.mocked(opts.check).mock.calls.at(-1)?.[1]).toBeNull();
  });
  it("preserves GRCh37 original fields alongside normalized fields without complementing source evidence", async () => {
    expect(await collect(lifted)).toEqual(lifted.records);
  });
  it("yields bounded blocks, reaches real terminal EOF and preserves global ordering across pages", async () => {
    const pages: CanonicalRecord[][] = [];
    for await (const page of streamPreparedExportRecords(multiple.manifest, multiple.expected, options(multiple))) pages.push(page);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every(p => p.length <= 2000)).toBe(true);
    expect(pages.flat()).toEqual(multiple.records);
  });
  it("refuses malformed metadata before external reads", async () => {
    const opts = options(baseline);
    await expect(collect({ ...baseline, manifest: { ...baseline.manifest, blockCount: 0 } }, opts)).rejects.toMatchObject({ code: "invalid_manifest" });
    expect(opts.readArtifact).not.toHaveBeenCalled();
  });
  it("does not release a block after authority changes during its read", async () => {
    const opts = options(baseline); let reading = false;
    const read = opts.readArtifact;
    opts.readArtifact = (a, s) => { reading = true; return read(a, s); };
    opts.check = async () => { if (reading) throw Error("private revoked scope"); };
    await expect(streamPreparedExportRecords(baseline.manifest, baseline.expected, opts).next()).rejects.toMatchObject({ code: "unavailable" });
  });
  it("refuses trailing provider bytes and closes the stream rather than accepting a matching prefix", async () => {
    const opts = options(baseline);
    opts.readArtifact = a => values([baseline.objects.get(a.receipt.objectKey)!, new Uint8Array([0])]);
    await expect(collect(baseline, opts)).rejects.toMatchObject({ code: "unavailable" });
  });
  it("abort between yielded blocks prevents further reads and terminal success", async () => {
    const opts = options(multiple), controller = new AbortController(); opts.signal = controller.signal;
    const stream = streamPreparedExportRecords(multiple.manifest, multiple.expected, opts);
    expect((await stream.next()).done).toBe(false); const count = vi.mocked(opts.readArtifact).mock.calls.length;
    controller.abort(); await expect(stream.next()).rejects.toMatchObject({ code: "aborted" });
    expect(opts.readArtifact).toHaveBeenCalledTimes(count);
  });
  it("consumer cancellation aborts owned read signals and does not pull another container", async () => {
    const opts = options(multiple), stream = streamPreparedExportRecords(multiple.manifest, multiple.expected, opts);
    await stream.next(); const count = vi.mocked(opts.readArtifact).mock.calls.length;
    const signal = vi.mocked(opts.readArtifact).mock.calls[0][1];
    await stream.return(); expect(signal.aborted).toBe(true); expect(opts.readArtifact).toHaveBeenCalledTimes(count);
  });
  it("terminal authority failure rejects completion even after earlier blocks were released", async () => {
    const opts = options(baseline); let checks = 0;
    opts.check = async (_, artifact) => { if (artifact === null && ++checks === baseline.manifest.blockCount + 2) throw Error("revoked"); };
    await expect(collect(baseline, opts)).rejects.toMatchObject({ code: "unavailable" });
  });
});
