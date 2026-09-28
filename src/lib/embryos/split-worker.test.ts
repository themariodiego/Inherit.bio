import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { embryoVcfChunks, validateEmbryoVcfChunk } from "./vcf-transport";
import type { BrowserTransportBinding, ServerTransportBinding } from "./ingest-binding";
import { addMeasures, analyseEmbryoFragment, embryoOrdinalOutcome, emptyMeasure,
  type EmbryoSplitRow } from "./split-analysis";
import { EmbryoSplitFragmentMismatch, runNextEmbryoSplit, type EmbryoFragmentRef, type EmbryoSplitFragment,
  type EmbryoSplitRpc } from "./split-worker";
import { QC_THRESHOLDS } from "./qc-policy";

// Synthetic only: every fragment below is derived in memory from the
// committed synthetic two-embryo fixture (e2e/fixtures/PROVENANCE.md), through
// the same browser rewrite and server split the chunk route uses.
const FIXTURE = readFileSync(path.join(process.cwd(), "e2e/fixtures/embryo-pair-grch38.vcf"), "utf8");
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const binding: BrowserTransportBinding = { challenge: "s".repeat(43), revision: 3, build: "GRCh38", sampleCount: 2,
  handles: ["h".repeat(43), "k".repeat(43)] };
const server: ServerTransportBinding = { ...binding, resolveHandle: (handle) => {
  const index = binding.handles.indexOf(handle);
  return index < 0 ? null : index;
} };
const header = FIXTURE.split("\n").filter((line) => line.startsWith("#"));
const records = FIXTURE.split("\n").filter((line) => line && !line.startsWith("#"));

/** Change embryo `sample` (0 or 1) at every `every`-th record with `edit`. */
function editSample(rows: string[], sample: number, every: number, edit: (gt: string) => string): string[] {
  return rows.map((row, index) => {
    if (index % every !== 0) return row;
    const fields = row.split("\t");
    fields[9 + sample] = edit(fields[9 + sample]);
    return fields.join("\t");
  });
}

/** Two uploaded chunks (first and second half of the records), split per embryo. */
async function fragmentsFrom(rows = records): Promise<{ ordinal: number; sequence: number; bytes: Uint8Array }[]> {
  const halves = [rows.slice(0, rows.length / 2), rows.slice(rows.length / 2)];
  const out: { ordinal: number; sequence: number; bytes: Uint8Array }[] = [];
  for (const [sequence, half] of halves.entries()) {
    const chunks = await Array.fromAsync(embryoVcfChunks(new Blob([`${[...header, ...half].join("\n")}\n`]), binding));
    expect(chunks).toHaveLength(1);
    for (const fragment of validateEmbryoVcfChunk(chunks[0], server)) {
      out.push({ ordinal: fragment.ordinal, sequence, bytes: encoder.encode(fragment.vcf) });
    }
  }
  return out;
}

/** The genotype letters the fixture itself states for one embryo, by locus. */
function statedGenotypes(rows: string[], sample: number): Map<string, string | null> {
  const stated = new Map<string, string | null>();
  for (const row of rows) {
    const f = row.split("\t");
    const alleles = [f[3], ...f[4].split(",")];
    const gt = f[9 + sample].split(":")[0].split(/[/|]/);
    stated.set(`${f[0].replace("chr", "")}:${f[1]}`,
      gt.includes(".") ? null : gt.map((index) => alleles[Number(index)]).sort().join("/"));
  }
  return stated;
}

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** An in-memory stand-in for the six database calls, holding their contract. */
function fakeDatabase(fragments: { ordinal: number; sequence: number; bytes: Uint8Array }[], embryoCount = 2) {
  const jobId = randomUUID(), sessionId = randomUUID(), cohortId = randomUUID();
  // The fragment store double, keyed exactly as the reader interface is.
  const objects = new Map<string, Uint8Array>();
  const key = (sequence: number, ordinal: number) => `${sequence}:${ordinal}`;
  const listed: EmbryoSplitFragment[] = fragments.map((fragment) => {
    objects.set(key(fragment.sequence, fragment.ordinal), fragment.bytes);
    return { ordinal: fragment.ordinal, sequence: fragment.sequence,
      byteCount: fragment.bytes.byteLength, sha256: sha(fragment.bytes),
      lineCount: decoder.decode(fragment.bytes).split("\n").length - 1 };
  }).sort((a, b) => a.ordinal - b.ordinal || a.sequence - b.sequence);
  const claim = { version: "embryo-split-claim-v1", jobId, attempt: 1,
    claimExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    deadline: new Date(Date.now() + 3_600_000).toISOString(), sessionId, cohortId, format: "vcf", build: "GRCh38",
    embryoCount, manifestSha256: "a".repeat(64), fragments: listed };
  const state = {
    claim: claim as Record<string, unknown> | null,
    staged: new Map<number, { batch: number; rows: EmbryoSplitRow[] }[]>(),
    outcomes: new Map<number, Record<string, unknown>>(),
    reported: [] as string[],
    calls: [] as string[],
    failAt: null as null | { call: string; after: number },
    objects,
    reads: [] as EmbryoFragmentRef[],
    landedFor: (fragment: EmbryoSplitFragment): unknown => ({ ...landed, ordinal: fragment.ordinal }),
  };
  const failure = { status: "failure_pending", cohortId, ingestRevision: 1, failureCode: "stale-binding" };
  const lease = { version: "embryo-split-lease-v1", jobId, attempt: 1, claimExpiresAt: claim.claimExpiresAt,
    deadline: claim.deadline, sessionId, manifestSha256: claim.manifestSha256 };
  const landed = { backend: "r2", stored: { opaque: "synthetic landed identity" } };
  const rpc: EmbryoSplitRpc = async (name, args) => {
    state.calls.push(name);
    if (state.failAt && name === state.failAt.call && state.calls.filter((c) => c === name).length > state.failAt.after) {
      return failure;
    }
    switch (name) {
      case "claim_embryo_split_job_v1": return structuredClone(state.claim);
      case "check_embryo_split_claim_v1":
      case "renew_embryo_split_claim_v1": return structuredClone(lease);
      case "read_embryo_split_fragment_v1": {
        const fragment = listed.find((f) => f.ordinal === args.p_ordinal && f.sequence === args.p_sequence)!;
        return { version: "embryo-split-fragment-v1", sessionId, ordinal: fragment.ordinal, sequence: fragment.sequence,
          byteCount: fragment.byteCount, sha256: fragment.sha256, landed: state.landedFor(fragment) };
      }
      case "stage_embryo_split_variants_v1": {
        const ordinal = args.p_ordinal as number, batch = args.p_batch as number, rows = args.p_rows as EmbryoSplitRow[];
        const list = state.staged.get(ordinal) ?? [];
        expect(batch).toBe(list.length);
        expect(state.outcomes.has(ordinal)).toBe(false);
        for (const [chrom, pos, ref, alt, genotype] of rows) {
          // The database's own refusal: only called alleles of this locus.
          expect(chrom).toBeGreaterThanOrEqual(1); expect(chrom).toBeLessThanOrEqual(22); expect(pos).toBeGreaterThan(0);
          expect(genotype).toMatch(/^[ACGTN]+(\/[ACGTN]+)*$/);
          for (const allele of genotype.split("/")) expect([ref, ...(alt ?? "").split(",")]).toContain(allele);
        }
        list.push({ batch, rows }); state.staged.set(ordinal, list);
        return { status: "staged", batch, rows: rows.length };
      }
      case "finish_embryo_split_ordinal_v1": {
        const ordinal = args.p_ordinal as number, result = args.p_result as Record<string, unknown>;
        expect(Object.keys(result).sort()).toEqual(["failureReason", "outcome", "qc", "variantCount"]);
        if (result.outcome === "qc_fail_no_source") state.staged.delete(ordinal);
        else expect((state.staged.get(ordinal) ?? []).flatMap((b) => b.rows)).toHaveLength(result.variantCount as number);
        state.outcomes.set(ordinal, result);
        return { status: "recorded", ordinal, outcome: result.outcome, remaining: embryoCount - state.outcomes.size };
      }
      case "fail_embryo_split_attempt_v1":
        state.reported.push(args.p_reason as string);
        return args.p_reason === "transient" ? { status: "queued" } : { ...failure, failureCode: args.p_reason };
      default: throw new Error(`unexpected RPC ${name}`);
    }
  };
  const readFragment = async (ref: EmbryoFragmentRef) => {
    state.reads.push(ref);
    if (ref.sessionId !== sessionId) throw new Error("synthetic read failure");
    const bytes = state.objects.get(key(ref.sequence, ref.ordinal));
    if (!bytes) throw new Error("synthetic read failure");
    return bytes;
  };
  const rowsFor = (ordinal: number) => (state.staged.get(ordinal) ?? []).flatMap((batch) => batch.rows);
  return { state, rpc, readFragment, rowsFor, listed, key, sessionId };
}

describe("per-embryo analysis of derived fixture fragments", () => {
  it("reads each embryo's own genotypes exactly as the fixture states them", async () => {
    const fragments = await fragmentsFrom();
    expect(fragments).toHaveLength(4);
    for (const sample of [0, 1]) {
      const rows: EmbryoSplitRow[] = [];
      for (const fragment of fragments.filter((f) => f.ordinal === sample)) {
        await analyseEmbryoFragment(fragment.bytes, sample, "GRCh38", (row) => { rows.push(row); });
      }
      const stated = statedGenotypes(records, sample);
      const called = [...stated.values()].filter((genotype) => genotype !== null).length;
      expect(called).toBeGreaterThan(1000);
      expect(rows).toHaveLength(called);
      for (const [chrom, pos, , , genotype] of rows) expect(genotype).toBe(stated.get(`${chrom}:${pos}`));
    }
  });

  it("measures QC through qc-policy and passes a fully called embryo", async () => {
    const fragments = await fragmentsFrom();
    let measure = emptyMeasure();
    for (const fragment of fragments.filter((f) => f.ordinal === 1)) {
      measure = addMeasures(measure, await analyseEmbryoFragment(fragment.bytes, 1, "GRCh38", () => {}));
    }
    const outcome = embryoOrdinalOutcome(measure);
    const called = [...statedGenotypes(records, 1).values()].filter((genotype) => genotype !== null).length;
    expect(outcome).toMatchObject({ outcome: "passed", failureReason: null, variantCount: called });
    expect(outcome.qc).toMatchObject({ sites_expected: records.length, sites_called: called,
      call_rate: called / records.length, qc_verdict: "pass", qc_reasons: [], mean_depth: null });
    expect(outcome.qc.autosomal_het_rate).toBeGreaterThan(0);
    expect(outcome.qc.autosomal_het_rate).toBeLessThan(1);
  });

  it("never fills a no-call or a partial call, from the reference or from the other embryo", async () => {
    // One in five of embryo 2's calls missing, alternating whole and partial.
    let toggle = false;
    const rows = editSample(records, 1, 5, () => (toggle = !toggle) ? "./." : "0/.");
    const fragments = await fragmentsFrom(rows);
    const staged: EmbryoSplitRow[] = [];
    let sites = 0, called = 0;
    for (const fragment of fragments.filter((f) => f.ordinal === 1)) {
      const measure = await analyseEmbryoFragment(fragment.bytes, 1, "GRCh38", (row) => { staged.push(row); });
      sites += measure.sites; called += measure.called;
    }
    const stated = statedGenotypes(rows, 1);
    const missing = [...stated].filter(([, genotype]) => genotype === null).map(([locus]) => locus);
    expect(missing.length).toBeGreaterThanOrEqual(records.length / 5);
    expect(sites).toBe(records.length);
    expect(called).toBe(records.length - missing.length);
    const stagedLoci = new Set(staged.map(([chrom, pos]) => `${chrom}:${pos}`));
    for (const locus of missing) expect(stagedLoci.has(locus)).toBe(false);
    for (const [chrom, pos, , , genotype] of staged) expect(genotype).toBe(stated.get(`${chrom}:${pos}`));
  });

  it("does not count a filtered call as called or store it", async () => {
    const rows = records.map((row, index) => index === 3 ? row.replace("\tPASS\t", "\tLowQual\t") : row);
    const fragments = await fragmentsFrom(rows);
    const staged: EmbryoSplitRow[] = [];
    const first = fragments.find((f) => f.ordinal === 0 && f.sequence === 0)!;
    const measure = await analyseEmbryoFragment(first.bytes, 0, "GRCh38", (row) => { staged.push(row); });
    expect(measure.sites - measure.called).toBe(1);
    const filtered = rows[3].split("\t");
    expect(staged.some(([chrom, pos]) => `${chrom}:${pos}` === `${filtered[0].replace("chr", "")}:${filtered[1]}`)).toBe(false);
  });

  it("stores a hom-ref call but never turns a reference block into a call", async () => {
    const block = "chr2\t500\t.\tA\t<NON_REF>\t.\tPASS\tEND=900\tGT:DP\t0/0:10\t0/0:12";
    const fragments = await fragmentsFrom([...records.slice(0, 10), block, ...records.slice(10, 20)]);
    const staged: EmbryoSplitRow[] = [];
    let measure;
    for (const fragment of fragments.filter((f) => f.ordinal === 0 && f.sequence === 0)) {
      measure = await analyseEmbryoFragment(fragment.bytes, 0, "GRCh38", (row) => { staged.push(row); });
    }
    expect(staged.some(([chrom, pos]) => chrom === 2 && pos === 500)).toBe(false);
    expect(staged.some(([, , ref, alt, genotype]) => alt === null && genotype === `${ref}/${ref}`)).toBe(true);
    expect(measure!.sites).toBe(10);
  });

  it("refuses a fragment presented for another embryo, another build or with a changed record", async () => {
    const fragments = await fragmentsFrom();
    const first = fragments.find((f) => f.ordinal === 0 && f.sequence === 0)!;
    await expect(analyseEmbryoFragment(first.bytes, 1, "GRCh38", () => {})).rejects.toMatchObject({ code: "invalid_chunk" });
    await expect(analyseEmbryoFragment(first.bytes, 0, "GRCh37", () => {})).rejects.toMatchObject({ code: "build_unknown" });
    const text = decoder.decode(first.bytes);
    const extraInfo = text.replace(/\t\.\tGT:DP/, "\tNOTE=private\tGT:DP");
    await expect(analyseEmbryoFragment(encoder.encode(extraInfo), 0, "GRCh38", () => {}))
      .rejects.toMatchObject({ code: "invalid_chunk" });
  });

  it("refuses a fragment carrying a sex chromosome record", async () => {
    const first = (await fragmentsFrom()).find((f) => f.ordinal === 0 && f.sequence === 0)!;
    const lines = decoder.decode(first.bytes).split("\n");
    const record = lines.find((line) => /^\d+\t/.test(line))!;
    const withX = decoder.decode(first.bytes).replace(record, `${record}\n${record.replace(/^\d+/, "X")}`);
    const rows: EmbryoSplitRow[] = [];
    await expect(analyseEmbryoFragment(encoder.encode(withX), 0, "GRCh38", (row) => { rows.push(row); }))
      .rejects.toMatchObject({ code: "invalid_chunk" });
    expect(rows).toHaveLength(0);
  });

  it("fails closed when a passing embryo has nothing storable", () => {
    const outcome = embryoOrdinalOutcome({ sites: 10, called: 10, diploidCalled: 10, heterozygous: 0,
      depthSum: 0, depthCount: 0, rows: 0 });
    expect(outcome).toMatchObject({ outcome: "qc_fail_no_source", failureReason: "qc_review_required", variantCount: 0 });
    expect(outcome.qc.qc_reasons).toContain("qc_review_required");
  });

  it("takes every band from qc-policy, never from a local number", () => {
    const at = (rate: number) => embryoOrdinalOutcome({ sites: 1000, called: Math.round(rate * 1000),
      diploidCalled: 1, heterozygous: 0, depthSum: 0, depthCount: 0, rows: 1 });
    expect(at(QC_THRESHOLDS.callRateNoFigure).qc.qc_verdict).toBe("pass");
    expect(at(QC_THRESHOLDS.callRateNoFigure - 0.001).qc).toMatchObject({ qc_verdict: "marginal", qc_reasons: ["embryo_call_rate"] });
    expect(at(QC_THRESHOLDS.callRateFail).qc.qc_verdict).toBe("marginal");
    expect(at(QC_THRESHOLDS.callRateFail - 0.001)).toMatchObject({ outcome: "qc_fail_no_source", failureReason: "embryo_call_rate" });
    for (const rate of [1, 0.9, 0.5]) {
      const qc = at(rate).qc;
      expect(qc).toMatchObject({ autosomal_het_rate: 0, mean_depth: null });
      expect(Object.keys(qc)).not.toContain("parent_a_concordance");
    }
  });
});

describe("split_cohort_vcf worker protocol (database and Storage doubled)", () => {
  it("is idle when nothing is claimable", async () => {
    const db = fakeDatabase([]);
    db.state.claim = null;
    await expect(runNextEmbryoSplit({ rpc: db.rpc, readFragment: db.readFragment })).resolves.toEqual({ status: "idle" });
    expect(db.state.calls).toEqual(["claim_embryo_split_job_v1"]);
  });

  it("stages every embryo in bounded ordered batches and records each outcome once", async () => {
    const db = fakeDatabase(await fragmentsFrom());
    const result = await runNextEmbryoSplit({ rpc: db.rpc, readFragment: db.readFragment, batchSize: 250 });
    expect(result).toEqual({ status: "staged", jobId: db.state.claim!.jobId, passed: 2, failed: 0 });
    for (const ordinal of [0, 1]) {
      const stated = statedGenotypes(records, ordinal);
      const called = [...stated.values()].filter((genotype) => genotype !== null).length;
      expect(db.state.staged.get(ordinal)!.map((batch) => batch.batch)).toEqual([0, 1, 2, 3, 4]);
      expect(db.state.staged.get(ordinal)!.every((batch) => batch.rows.length <= 250)).toBe(true);
      expect(db.rowsFor(ordinal)).toHaveLength(called);
      for (const [chrom, pos, , , genotype] of db.rowsFor(ordinal)) expect(genotype).toBe(stated.get(`${chrom}:${pos}`));
      expect(db.state.outcomes.get(ordinal)).toMatchObject({ outcome: "passed", variantCount: called });
    }
    // Read authority is established under the claim before every fragment read,
    // and the claim is rechecked again before every outcome.
    expect(db.state.calls.filter((call) => call === "read_embryo_split_fragment_v1")).toHaveLength(4);
    expect(db.state.calls.filter((call) => call === "check_embryo_split_claim_v1")).toHaveLength(2);
    expect(db.state.reported).toEqual([]);
  });

  it("asks the fragment store only for (session, sequence, ordinal) and the manifest facts", async () => {
    const db = fakeDatabase(await fragmentsFrom());
    await runNextEmbryoSplit({ rpc: db.rpc, readFragment: db.readFragment });
    expect(db.state.reads.map((ref) => `${ref.ordinal}.${ref.sequence}`)).toEqual(["0.0", "0.1", "1.0", "1.1"]);
    for (const ref of db.state.reads) {
      expect(Object.keys(ref).sort()).toEqual(["byteCount", "landed", "ordinal", "sequence", "sessionId", "sha256"]);
      expect(ref.sessionId).toBe(db.sessionId);
      // The landed identity is exactly what the read door issued for this fragment.
      expect(ref.landed).toEqual({ backend: "r2", stored: { opaque: "synthetic landed identity" }, ordinal: ref.ordinal });
      const listed = db.listed.find((f) => f.ordinal === ref.ordinal && f.sequence === ref.sequence)!;
      expect([ref.byteCount, ref.sha256]).toEqual([listed.byteCount, listed.sha256]);
    }
  });

  it("re-verifies bytes even when the store returns the wrong fragment", async () => {
    const db = fakeDatabase(await fragmentsFrom());
    const swapped = async (ref: EmbryoFragmentRef) => db.readFragment({ ...ref, ordinal: 1 - ref.ordinal });
    await expect(runNextEmbryoSplit({ rpc: db.rpc, readFragment: swapped }))
      .resolves.toMatchObject({ status: "failure_pending", code: "chunk" });
    expect(db.state.staged.size).toBe(0);
  });

  it("continues past an embryo that fails QC and never publishes its rows", async () => {
    const rows = editSample(records, 0, 4, () => "./.");
    const db = fakeDatabase(await fragmentsFrom(rows));
    const result = await runNextEmbryoSplit({ rpc: db.rpc, readFragment: db.readFragment, batchSize: 100 });
    expect(result).toMatchObject({ status: "staged", passed: 1, failed: 1 });
    expect(db.state.outcomes.get(0)).toMatchObject({ outcome: "qc_fail_no_source", failureReason: "embryo_call_rate",
      variantCount: 0, qc: { qc_verdict: "fail" } });
    expect((db.state.outcomes.get(0)!.qc as { call_rate: number }).call_rate).toBeLessThan(QC_THRESHOLDS.callRateFail);
    expect(db.rowsFor(0)).toEqual([]);
    expect(db.state.calls).toContain("stage_embryo_split_variants_v1");
    const called = [...statedGenotypes(rows, 1).values()].filter((genotype) => genotype !== null).length;
    expect(db.state.outcomes.get(1)).toMatchObject({ outcome: "passed", variantCount: called });
  });

  it("keeps a marginal embryo's own calls and fills nothing in", async () => {
    const rows = editSample(records, 1, 10, () => "./.");
    const db = fakeDatabase(await fragmentsFrom(rows));
    await runNextEmbryoSplit({ rpc: db.rpc, readFragment: db.readFragment });
    const sibling = statedGenotypes(rows, 0);
    const own = statedGenotypes(rows, 1);
    const called = [...own.values()].filter((genotype) => genotype !== null).length;
    expect(db.state.outcomes.get(1)).toMatchObject({ outcome: "passed",
      qc: { qc_verdict: "marginal", qc_reasons: ["embryo_call_rate"] }, variantCount: called });
    expect(db.rowsFor(1)).toHaveLength(called);
    const staged = new Map(db.rowsFor(1).map(([chrom, pos, , , genotype]) => [`${chrom}:${pos}`, genotype]));
    for (const [locus, genotype] of own) {
      if (genotype === null) expect(staged.has(locus)).toBe(false);
      else expect(staged.get(locus)).toBe(genotype);
    }
    expect([...own].filter(([locus, genotype]) => genotype === null && sibling.get(locus) !== null).length).toBeGreaterThan(0);
  });

  it("ends the attempt as chunk when a fragment does not match its locked digest", async () => {
    const db = fakeDatabase(await fragmentsFrom());
    const bytes = db.state.objects.get(db.key(1, 1))!.slice();
    bytes[bytes.length - 2] = bytes[bytes.length - 2] === 48 ? 49 : 48;
    db.state.objects.set(db.key(1, 1), bytes);
    const result = await runNextEmbryoSplit({ rpc: db.rpc, readFragment: db.readFragment });
    expect(result).toMatchObject({ status: "failure_pending", code: "chunk" });
    expect(db.state.reported).toEqual(["chunk"]);
    expect(db.state.outcomes.has(1)).toBe(false);
  });

  it("ends the attempt as format when a digest-true fragment no longer validates", async () => {
    const fragments = await fragmentsFrom();
    fragments[0].bytes = encoder.encode(decoder.decode(fragments[0].bytes).replace(/\t\.\tGT:DP/, "\tNOTE=x\tGT:DP"));
    const db = fakeDatabase(fragments);
    await expect(runNextEmbryoSplit({ rpc: db.rpc, readFragment: db.readFragment }))
      .resolves.toMatchObject({ status: "failure_pending", code: "format" });
    expect(db.state.staged.size).toBe(0);
  });

  it("ends the attempt as build when a fragment names another build", async () => {
    const fragments = await fragmentsFrom();
    fragments[2].bytes = encoder.encode(decoder.decode(fragments[2].bytes).replace("##reference=GRCh38", "##reference=GRCh37"));
    const db = fakeDatabase(fragments);
    await expect(runNextEmbryoSplit({ rpc: db.rpc, readFragment: db.readFragment }))
      .resolves.toMatchObject({ status: "failure_pending", code: "build" });
  });

  it("ends the attempt as chunk when the store says the landed version is not there", async () => {
    const db = fakeDatabase(await fragmentsFrom());
    const gone = async (ref: EmbryoFragmentRef) => {
      if (ref.ordinal === 1) throw new EmbryoSplitFragmentMismatch();
      return db.readFragment(ref);
    };
    await expect(runNextEmbryoSplit({ rpc: db.rpc, readFragment: gone }))
      .resolves.toMatchObject({ status: "failure_pending", code: "chunk" });
    expect(db.state.reported).toEqual(["chunk"]);
    expect(db.state.outcomes.has(1)).toBe(false);
  });

  it("refuses read authority that names another fragment than it asked for", async () => {
    const db = fakeDatabase(await fragmentsFrom());
    const rpc: EmbryoSplitRpc = async (name, args, signal) => {
      const data = await db.rpc(name, args, signal);
      return name === "read_embryo_split_fragment_v1" ? { ...(data as object), sha256: "e".repeat(64) } : data;
    };
    await expect(runNextEmbryoSplit({ rpc, readFragment: db.readFragment })).rejects.toMatchObject({ code: "integrity_mismatch" });
    expect(db.state.reads).toHaveLength(0);
  });

  it("requeues after a Storage read failure instead of guessing", async () => {
    const db = fakeDatabase(await fragmentsFrom());
    db.state.objects.delete(db.key(db.listed[1].sequence, db.listed[1].ordinal));
    await expect(runNextEmbryoSplit({ rpc: db.rpc, readFragment: db.readFragment }))
      .resolves.toMatchObject({ status: "requeued" });
    expect(db.state.reported).toEqual(["transient"]);
    expect(db.state.outcomes.size).toBe(0);
  });

  it("stops at once when a recheck finds the binding stale", async () => {
    const db = fakeDatabase(await fragmentsFrom());
    db.state.failAt = { call: "read_embryo_split_fragment_v1", after: 2 };
    await expect(runNextEmbryoSplit({ rpc: db.rpc, readFragment: db.readFragment }))
      .resolves.toMatchObject({ status: "failure_pending", code: "stale-binding" });
    expect(db.state.outcomes.size).toBe(1);
    expect(db.state.reads).toHaveLength(2);
    expect(db.state.calls.at(-1)).toBe("read_embryo_split_fragment_v1");
  });

  it("refuses a claim whose fragment set omits an embryo", async () => {
    const db = fakeDatabase((await fragmentsFrom()).filter((f) => f.ordinal === 0));
    await expect(runNextEmbryoSplit({ rpc: db.rpc, readFragment: db.readFragment }))
      .rejects.toMatchObject({ code: "integrity_mismatch" });
    expect(db.state.calls).toEqual(["claim_embryo_split_job_v1"]);
  });

  it("refuses a claim receipt with any unregistered field", async () => {
    const db = fakeDatabase(await fragmentsFrom());
    db.state.claim = { ...db.state.claim, sampleLabels: ["private"] };
    await expect(runNextEmbryoSplit({ rpc: db.rpc, readFragment: db.readFragment }))
      .rejects.toMatchObject({ code: "unavailable" });
  });

  it("renews its lease while it works", async () => {
    const db = fakeDatabase(await fragmentsFrom());
    const read = db.readFragment;
    const slow = async (fragment: EmbryoFragmentRef) => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return read(fragment);
    };
    await runNextEmbryoSplit({ rpc: db.rpc, readFragment: slow, renewEveryMs: 5 });
    expect(db.state.calls).toContain("renew_embryo_split_claim_v1");
  });
});
