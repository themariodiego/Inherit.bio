import { describe, expect, it, vi } from "vitest";
import { IncrementalVcfError, prepareIncrementalVcf, type PositionEntry, type PositionReceipt } from "./incremental-vcf-normalization";
import type { Liftover } from "../genome/liftover";

type Options = Parameters<typeof prepareIncrementalVcf>[1];
const header = (build = "GRCh38") => ["##fileformat=VCFv4.2", `##reference=${build}`,
  "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSYNTHETIC"];
const row = (pos: number, gt = "0/1", chrom = "1", alt = "C", id = `rs${pos}`) =>
  `${chrom}\t${pos}\t${id}\tA\t${alt}\t50\tPASS\t.\tGT:GQ:DP\t${gt}:50:30`;
async function* input(rows: string[], build = "GRCh38") { yield* header(build); yield* rows; }

// Test-only model of the registration contract, not database verification:
// positions count once, while the first variant can arrive after an observation.
function registration() {
  const positions = new Map<string, { variant: string | null; mapped: boolean | null }>();
  let attempted = 0, unmapped = 0, nextSequence = 0;
  return vi.fn(async (sequence: number, entries: PositionEntry[]): Promise<PositionReceipt> => {
    expect(sequence).toBe(nextSequence++);
    expect(entries.length).toBeGreaterThan(0); expect(entries.length).toBeLessThanOrEqual(1000);
    const acceptedVariantOrdinals: number[] = [];
    entries.forEach((entry, ordinal) => {
      const key = `${entry.source_chrom}:${entry.source_pos}`;
      const prior = positions.get(key);
      const variant = entry.variant ? JSON.stringify(entry.variant) : null;
      if (!prior) {
        positions.set(key, { variant, mapped: entry.mapped });
        if (entry.mapped !== null) { attempted++; if (!entry.mapped) unmapped++; }
        if (variant) acceptedVariantOrdinals.push(ordinal);
      } else {
        if (prior.mapped !== entry.mapped || (variant && prior.variant && prior.variant !== variant)) {
          throw new IncrementalVcfError("unrecognised_format");
        }
        if (variant && !prior.variant) { prior.variant = variant; acceptedVariantOrdinals.push(ordinal); }
      }
    });
    return { acceptedVariantOrdinals, attempted, unmapped };
  });
}
function setup(overrides: Partial<Options> = {}) {
  const register = registration();
  const stage = vi.fn<Options["stage"]>(async () => {});
  return { register, stage, options: { build: "GRCh38", maximumUnmappedFraction: 0.1, register, stage, ...overrides } satisfies Options };
}
function staged(stage: ReturnType<typeof setup>["stage"], kind: "variants" | "observed") {
  return stage.mock.calls.filter(call => call[0] === kind).flatMap(call => call[2]) as Record<string, unknown>[];
}
const lift: Liftover = (chrom, pos) => ({ chrom, pos: pos + 100, strand: -1 });

describe("incremental VCF normalization", () => {
  it("deduplicates variants across 1000-line batches while preserving every observation", async () => {
    const harness = setup();
    const rows = Array.from({ length: 1000 }, (_, i) => row(i + 1));
    rows.push(row(1), row(1001));
    expect(await prepareIncrementalVcf(input(rows), harness.options)).toEqual({ variantCount: 1001, observedCallCount: 1002, attempted: 0, unmapped: 0 });
    expect(harness.register.mock.calls.map(call => call[1].length)).toEqual([1000, 2]);
    expect(harness.stage.mock.calls.map(([kind, sequence, records]) => [kind, sequence, records.length])).toEqual([
      ["variants", 0, 1000], ["observed", 0, 1000], ["variants", 1, 1], ["observed", 1, 2],
    ]);
    expect(staged(harness.stage, "variants").filter(record => record.pos === 1)).toHaveLength(1);
    expect(staged(harness.stage, "observed").filter(record => record.source_pos === 1).map(record => record.source_line)).toEqual([4, 1004]);
  });

  it("accepts a first variant after a prior batch registered only its reference observation", async () => {
    const harness = setup();
    const rows = [row(1, "0/0"), ...Array.from({ length: 999 }, (_, i) => row(i + 2)), row(1)];
    const result = await prepareIncrementalVcf(input(rows), harness.options);
    expect(result).toMatchObject({ variantCount: 1000, observedCallCount: 1001 });
    expect(harness.register.mock.calls[0][1][0].variant).toBeNull();
    expect(staged(harness.stage, "variants").filter(record => record.pos === 1)).toHaveLength(1);
    expect(staged(harness.stage, "observed").filter(record => record.source_pos === 1).map(record => record.genotype)).toEqual(["A/A", "A/C"]);
  });

  it("refuses a conflicting variant after earlier private batches were staged", async () => {
    const harness = setup();
    const rows = Array.from({ length: 1000 }, (_, i) => row(i + 1));
    rows.push(row(1, "1/1"));
    await expect(prepareIncrementalVcf(input(rows), harness.options)).rejects.toMatchObject({ code: "unrecognised_format" });
    expect(harness.stage).toHaveBeenCalledTimes(2);
    expect(staged(harness.stage, "variants")).toHaveLength(1000);
  });

  it("counts the unique autosomal variant/observation union, separating point loss from allele failure", async () => {
    const mapper: Liftover = (chrom, pos) => pos === 30 ? null : lift(chrom, pos);
    const harness = setup({ build: "GRCh37", lift: mapper, maximumUnmappedFraction: 0.25 });
    const rows = [row(10), row(10), row(20, "0/0"), row(20), row(30, "./."),
      row(40, "0/1", "1", "AC"), row(50, "0/1", "X")];
    expect(await prepareIncrementalVcf(input(rows, "GRCh37"), harness.options)).toEqual({ variantCount: 3, observedCallCount: 5, attempted: 4, unmapped: 1 });
    // The indel at 40 maps as a position but cannot become a single-base call.
    expect(harness.register.mock.calls[0][1].find(entry => entry.source_pos === 40)?.mapped).toBe(true);
    expect(staged(harness.stage, "variants").map(record => record.pos)).toEqual([110, 120, 150]);
    expect(staged(harness.stage, "observed")[0]).toMatchObject({ source_chrom: 1, source_pos: 10, source_ref: "A", source_alt: "C", chrom: 1, pos: 110, ref: "T", alt: "G", genotype: "G/T" });
    expect(harness.register.mock.calls[0][1].find(entry => entry.source_chrom === 23)?.mapped).toBeNull();
  });

  it("retains mapped no-call identity and hom-reference observations without fabricating variants", async () => {
    const harness = setup({ build: "GRCh37", lift });
    expect(await prepareIncrementalVcf(input([row(1, "./."), row(2, "0/0"), row(3, "0/0", "1", "<NON_REF>")], "GRCh37"), harness.options))
      .toEqual({ variantCount: 0, observedCallCount: 2, attempted: 2, unmapped: 0 });
    expect(staged(harness.stage, "variants")).toEqual([]);
    expect(staged(harness.stage, "observed")).toMatchObject([
      { source_gt: "./.", source_pos: 1, pos: 101, genotype: "--", usable: false },
      { source_gt: "0/0", source_pos: 2, pos: 102, genotype: "T/T", usable: true },
    ]);
  });

  it("refuses only-no-call and only-uninterpretable reference input", async () => {
    for (const rows of [[row(1, "./.")], [row(1, "0/0", "1", "C", ".")], [row(1, "0/0", "1", "<NON_REF>")]]) {
      const harness = setup();
      await expect(prepareIncrementalVcf(input(rows), harness.options)).rejects.toMatchObject({ code: "empty_after_parse" });
    }
  });

  it("refuses excess point-mapping loss even when valid mapped rows remain", async () => {
    const harness = setup({ build: "GRCh37", lift: (chrom, pos) => pos === 2 ? null : lift(chrom, pos), maximumUnmappedFraction: 0.49 });
    await expect(prepareIncrementalVcf(input([row(1), row(2)], "GRCh37"), harness.options)).rejects.toMatchObject({ code: "liftover_loss" });
  });

  it.each(["duplicate sample header", "conflicting build"])("cannot return completion after a late %s", async variant => {
    const harness = setup();
    async function* source() {
      yield* header();
      for (let i = 1; i <= 1001; i++) yield row(i);
      yield variant === "conflicting build" ? "##reference=GRCh37" : header()[2];
    }
    await expect(prepareIncrementalVcf(source(), harness.options)).rejects.toMatchObject({ code: variant === "conflicting build" ? "upload_integrity_mismatch" : "unrecognised_format" });
    expect(harness.stage).toHaveBeenCalledTimes(2); // already staged privately, never a completion result
  });

  it("propagates end-of-stream hash verification failure and closes the source", async () => {
    const harness = setup(); let closed = false;
    const mismatch = new IncrementalVcfError("upload_integrity_mismatch");
    async function* verifiedSource() {
      try { yield* header(); for (let i = 1; i <= 1001; i++) yield row(i); throw mismatch; }
      finally { closed = true; }
    }
    await expect(prepareIncrementalVcf(verifiedSource(), harness.options)).rejects.toBe(mismatch);
    expect(closed).toBe(true); expect(harness.stage).toHaveBeenCalledTimes(2);
  });

  it("holds source consumption at the batch boundary until registration and staging settle", async () => {
    const registerGate = Promise.withResolvers<void>(); const stageGate = Promise.withResolvers<void>();
    const enteredRegister = Promise.withResolvers<void>(); const enteredStage = Promise.withResolvers<void>();
    const model = registration(); let read = 0;
    const harness = setup({ register: async (...args) => { enteredRegister.resolve(); await registerGate.promise; return model(...args); },
      stage: async () => { enteredStage.resolve(); await stageGate.promise; } });
    async function* source() { yield* header(); for (let i = 1; i <= 2001; i++) { read++; yield row(i); } }
    const result = prepareIncrementalVcf(source(), harness.options);
    await enteredRegister.promise; expect(read).toBe(1001);
    registerGate.resolve(); await enteredStage.promise; expect(read).toBe(1001);
    stageGate.resolve(); expect(await result).toMatchObject({ variantCount: 2001, observedCallCount: 2001 });
    expect(model.mock.calls.map(call => call[1].length)).toEqual([1000, 1000, 1]);
  });

  it.each([
    { acceptedVariantOrdinals: [-1], attempted: 0, unmapped: 0 },
    { acceptedVariantOrdinals: [1], attempted: 0, unmapped: 0 },
    { acceptedVariantOrdinals: [0, 0], attempted: 0, unmapped: 0 },
    { acceptedVariantOrdinals: [0.5], attempted: 0, unmapped: 0 },
    { acceptedVariantOrdinals: [0], attempted: -1, unmapped: 0 },
    { acceptedVariantOrdinals: [0], attempted: 0, unmapped: 1 },
    { acceptedVariantOrdinals: [0], attempted: 1, unmapped: 0 },
    { acceptedVariantOrdinals: [], attempted: Number.NaN, unmapped: 0 },
  ])("rejects a malformed registration acknowledgement before staging: %j", async receipt => {
    const harness = setup({ register: async () => receipt });
    await expect(prepareIncrementalVcf(input([row(1)]), harness.options)).rejects.toMatchObject({ code: "unavailable" });
    expect(harness.stage).not.toHaveBeenCalled();
  });

  it("rejects an accepted ordinal pointing at an observation-only line", async () => {
    const harness = setup({ register: async () => ({ acceptedVariantOrdinals: [0], attempted: 0, unmapped: 0 }) });
    await expect(prepareIncrementalVcf(input([row(1, "0/0")]), harness.options)).rejects.toMatchObject({ code: "unavailable" });
    expect(harness.stage).not.toHaveBeenCalled();
  });

  it("refuses decreasing cumulative counters in later batches", async () => {
    const model = registration();
    const harness = setup({ build: "GRCh37", lift, register: async (sequence, entries) => {
      const receipt = await model(sequence, entries); return sequence ? { ...receipt, attempted: 999 } : receipt;
    } });
    await expect(prepareIncrementalVcf(input(Array.from({ length: 1001 }, (_, i) => row(i + 1)), "GRCh37"), harness.options)).rejects.toMatchObject({ code: "unavailable" });
    expect(harness.stage).toHaveBeenCalledTimes(2);
  });

  it.each(["registration", "staging"])("closes source and never reads ahead after %s failure", async phase => {
    const failure = new IncrementalVcfError("unavailable"); let closed = false, read = 0;
    const harness = setup(phase === "registration" ? { register: async () => { throw failure; } }
      : { stage: async () => { throw failure; } });
    async function* source() {
      try { yield* header(); for (let i = 1; i <= 2000; i++) { read++; yield row(i); } }
      finally { closed = true; }
    }
    await expect(prepareIncrementalVcf(source(), harness.options)).rejects.toBe(failure);
    expect(closed).toBe(true); expect(read).toBe(1001);
  });

  it("refuses a missing GRCh37 mapper before reading any source", async () => {
    let read = false;
    async function* source() { read = true; yield* header("GRCh37"); yield row(1); }
    const harness = setup({ build: "GRCh37" });
    await expect(prepareIncrementalVcf(source(), harness.options)).rejects.toMatchObject({ code: "unavailable" });
    expect(read).toBe(false); expect(harness.register).not.toHaveBeenCalled();
  });

  it.each([null, undefined, [], "invalid", { acceptedVariantOrdinals: [0], attempted: 0, unmapped: 0, extra: true }])(
    "rejects malformed receipt shapes with the closed unavailable code: %j", async receipt => {
    const harness = setup({ register: async () => receipt as unknown as PositionReceipt });
    await expect(prepareIncrementalVcf(input([row(1)]), harness.options)).rejects.toMatchObject({ code: "unavailable" });
    expect(harness.stage).not.toHaveBeenCalled();
  });
});
