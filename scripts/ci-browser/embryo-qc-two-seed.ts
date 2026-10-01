import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { assertRegisteredQcFigures, type QcFigurePresentation } from "../../e2e/embryo-qc-cross-surface";
import { assertEmbryoDto, type QcDto } from "../../src/lib/embryos/policy";
import type { CiBrowserIdentity, CiBrowserShardReceipt } from "../ci-browser-shards";

export const QC_SEEDS = Object.freeze({
  a: { project: "embryo-ingest", spec: "embryo-ingest-journey.spec.ts", fixture: "e2e/fixtures/embryo-pair-grch38.vcf" },
  b: { project: "chromium", spec: "embryo-qc-second-seed-journey.spec.ts", fixture: "e2e/fixtures/embryo-pair-qc-b-grch38.vcf" },
});
const uuid = z.string().uuid();
const figure = z.object({ kind: z.enum(["coverage", "natural-frequency"]), figureClass: z.literal("quality"),
  basis: z.literal("observed"), provenance: z.literal("computed:embryos/split-analysis"), context: z.null(),
  value: z.string().min(1).max(120), field: z.enum(["coverage", "autosomal_het_rate"]), subjectId: uuid,
  location: z.enum(["table", "block", "footer"]), unit: z.string().max(120).nullable(), caption: z.string().min(1).max(120),
  modelledMarkers: z.array(z.string()).max(0), exactMarkers: z.array(z.string()).max(0),
}).strict();
const receiptSchema = z.object({ schemaVersion: z.literal(1), seed: z.enum(["a", "b"]),
  head: z.string().regex(/^[0-9a-f]{40}$/), runId: z.string().regex(/^[1-9][0-9]*$/), runAttempt: z.string().regex(/^[1-9][0-9]*$/),
  index: z.number().int().min(1).max(6), total: z.literal(6), caseId: z.string().regex(/^[0-9a-f]{20}-[0-9a-f]{20}:[a-z-]+$/),
  project: z.enum(["embryo-ingest", "chromium"]), spec: z.string(), fixture: z.string(), fixtureSha256: z.string().regex(/^[0-9a-f]{64}$/),
  runtimeOwner: uuid, cohortId: uuid, publicationRevision: z.literal(1),
  sources: z.array(z.object({ ordinal: z.number().int().min(0).max(1), subjectId: uuid, qc: z.unknown() }).strict()).length(2),
  surfaces: z.array(z.object({ route: z.enum(["/embryos/compare", "/embryos/[embryoId]"]), ordinal: z.number().int().min(0).max(1).nullable(),
    figures: z.array(figure).min(1).max(8) }).strict()).length(3),
}).strict();
export type EmbryoQcSeedReceipt = z.infer<typeof receiptSchema>;
export function fixtureHash(file: string): string { return createHash("sha256").update(readFileSync(file)).digest("hex"); }

/** Full closed census and saved producer receipt, never a zero-figure waiver. */
export function checkedQcSeed(value: unknown): EmbryoQcSeedReceipt {
  const receipt = receiptSchema.parse(value), registered = QC_SEEDS[receipt.seed];
  assert(receipt.project === registered.project && receipt.spec === registered.spec && receipt.fixture === registered.fixture
    && receipt.caseId.endsWith(`:${registered.project}`) && receipt.fixtureSha256 === fixtureHash(registered.fixture),
  "Exact native QC seed and committed fixture required");
  assert.deepEqual(receipt.sources.map(row => row.ordinal).sort(), [0, 1], "Exact source ordinals required");
  assert.equal(new Set(receipt.sources.map(row => row.subjectId)).size, 2, "Distinct current subjects required");
  assert.deepEqual(receipt.surfaces.map(row => `${row.route}:${row.ordinal}`).sort(),
    ["/embryos/compare:null", "/embryos/[embryoId]:0", "/embryos/[embryoId]:1"].sort(), "Exact populated QC surfaces required");
  for (const surface of receipt.surfaces) {
    const sources = receipt.sources.filter(row => surface.ordinal === null || row.ordinal === surface.ordinal)
      .map(row => ({ subjectId: row.subjectId, qc: assertEmbryoDto("qc", row.qc) as QcDto }));
    assertRegisteredQcFigures(surface.ordinal === null ? "compare" : "detail", surface.figures, sources);
  }
  return receipt;
}

/** Native case receipts have already passed the unchanged full-suite gate.
 * Only their actual same-attempt independent jobs can supply the two seeds. */
export function verifyQcSeedPublications(values: unknown[], coverage: readonly CiBrowserShardReceipt[], source: CiBrowserIdentity) {
  assert.equal(values.length, 2, "Both genuine QC publication receipts are required");
  const receipts = values.map(checkedQcSeed).sort((a, b) => a.seed.localeCompare(b.seed));
  assert.deepEqual(receipts.map(row => row.seed), ["a", "b"], "Exact two QC seeds required");
  for (const receipt of receipts) {
    assert(receipt.head === source.head && receipt.runId === source.runId && receipt.runAttempt === source.runAttempt,
      "QC receipt source/run differs");
    const job = coverage.filter(row => row.index === receipt.index);
    assert(job.length === 1 && job[0].head === source.head && job[0].runId === source.runId
      && job[0].runAttempt === source.runAttempt && job[0].assignedCases.includes(receipt.caseId) && job[0].executedCases.includes(receipt.caseId)
      && job[0].files.some(file => file.project === receipt.project && file.file === receipt.spec && file.cases.includes(receipt.caseId)),
    "QC receipt must belong to its actually passed native case and job");
  }
  for (const field of ["index", "runtimeOwner", "cohortId", "fixtureSha256"] as const)
    assert.notEqual(receipts[0][field], receipts[1][field], "QC seeds require independent jobs, runtimes, cohorts and files");
  assert.equal(new Set(receipts.flatMap(row => row.sources.map(item => item.subjectId))).size, 4, "QC seeds cannot reuse subjects");
  const keyed = (receipt: EmbryoQcSeedReceipt) => {
    const values = new Map<string, QcFigurePresentation>();
    for (const surface of receipt.surfaces) {
      const counts = new Map<string, number>();
      for (const shown of surface.figures) {
        const ordinal = receipt.sources.find(row => row.subjectId === shown.subjectId)!.ordinal;
        const shape = [surface.route, surface.ordinal, ordinal, shown.field, shown.location,
          shown.kind, shown.figureClass, shown.basis, shown.provenance].join("|");
        const occurrence = (counts.get(shape) ?? 0) + 1;counts.set(shape, occurrence);
        values.set(`${shape}|${occurrence}`, shown);
      }
    }
    assert.equal(values.size, 16, "Entire repeated QC census must be present");
    return values;
  };
  const a = keyed(receipts[0]), b = keyed(receipts[1]);
  assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort(), "Two QC seeds must render the same figures");
  for (const [key, first] of a) {
    const second = b.get(key)!;
    assert.equal(first.unit, second.unit, `QC unit changed: ${key}`);
    assert.equal(first.caption, second.caption, `QC caption changed: ${key}`);
    assert.notEqual(first.value, second.value, `Every actual QC figure must move: ${key}`);
  }
  return { schemaVersion: 1, ...source, seeds: receipts.map(row => ({ seed: row.seed, index: row.index, caseId: row.caseId,
    fixture: row.fixture, fixtureSha256: row.fixtureSha256, runtimeOwner: row.runtimeOwner, cohortId: row.cohortId })),
  comparedFigures: a.size, comparedSurfaces: 3, skips: 0, retries: 0 };
}
