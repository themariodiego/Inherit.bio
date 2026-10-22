import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { DensityStateCase } from "./density-capture-plan";
import { checkedFinalizedEmbryoEmptyFacts, finalizedEmbryoEmptyDensityRecipe } from "./density-finalized-embryo-empty-states";
import { untouchedPending } from "../src/lib/embryos/pending-input-fixture.test-support";

// Invented pure parser controls only. Actual density capture still requires
// the genuine native finalize/read/bags and complete original worker journey.
const row = (): DensityStateCase => ({ route: { id: "embryos.detail", path: "/embryos/[embryoId]",
  kind: "page", auth: "authenticated", surface: "standard",
  stateProfile: "product-result" }, state: "empty" });
const facts = () => ({ pendingInput: untouchedPending(), nativeSessionId: untouchedPending().sessions[0].id,
  completeNativeBag: "b".repeat(64) });
const expected = () => { const pending = untouchedPending(); return {
  accountId: pending.accountId, cohortId: pending.cohortId, embryoId: pending.embryoId, subjectId: pending.subjectId,
  nativeSessionId: pending.sessions[0].id, completeNativeBag: "b".repeat(64) }; };
const foreign = "ffffffff-ffff-4fff-8fff-ffffffffffff";

describe("genuine finalized embryo empty density adapter", () => {
  it("selects only the registered detail empty pair without inventing another required state", () => {
    expect(finalizedEmbryoEmptyDensityRecipe(row())).toBe("finalized-no-file");
    for (const state of ["processing", "complete", "not-covered", "read-error"])
      expect(finalizedEmbryoEmptyDensityRecipe({ ...row(), state })).toBeNull();
    expect(finalizedEmbryoEmptyDensityRecipe({ ...row(), route: { ...row().route, id: "embryos.compare" } })).toBeNull();
  });
  it.each(["path", "kind", "auth", "stateProfile"] as const)("refuses changed registered %s instead of adopting a route", key => {
    expect(() => finalizedEmbryoEmptyDensityRecipe({ ...row(), route: { ...row().route, [key]: "changed" } })).toThrow();
  });
  it("retains the complete native row observation while treating its clock as liveness rather than stored data", () => {
    const value = facts();
    expect(checkedFinalizedEmbryoEmptyFacts(value, expected())).toEqual(value);
    value.pendingInput.snapshotAt = "2026-10-11T12:00:01+00:00";
    expect(checkedFinalizedEmbryoEmptyFacts(value, expected())).toEqual(value);
    expect(checkedFinalizedEmbryoEmptyFacts(value, expected()).completeNativeBag).toBe("b".repeat(64));
  });
  it.each(["accountId", "cohortId", "embryoId", "subjectId"] as const)("refuses a genuine-shaped foreign %s", key => {
    const value = facts(); value.pendingInput[key] = foreign;
    expect(() => checkedFinalizedEmbryoEmptyFacts(value, expected())).toThrow();
  });
  it("requires the exact issued session in both the selected native row and the callback", () => {
    const value = facts(); value.pendingInput.sessions[0].id = foreign;
    expect(() => checkedFinalizedEmbryoEmptyFacts(value, expected())).toThrow();
    value.nativeSessionId = foreign;
    expect(() => checkedFinalizedEmbryoEmptyFacts(value, expected())).toThrow();
  });
  it("rejects changed whole stored-row bags even when all public counters remain zero", () => {
    const value = facts(); value.completeNativeBag = "c".repeat(64);
    expect(() => checkedFinalizedEmbryoEmptyFacts(value, expected())).toThrow();
    expect(() => checkedFinalizedEmbryoEmptyFacts({ ...facts(), completeNativeBag: "short" }, expected())).toThrow();
  });
  it.each(["fileCount", "qcCount", "chunkCount", "fragmentCount", "workCount", "activeWorkCount"] as const)(
    "retains processing/refusal when native %s is nonzero", key => {
      const value = facts(); value.pendingInput[key] = 1;
      expect(() => checkedFinalizedEmbryoEmptyFacts(value, expected())).toThrow();
    });
  it("refuses reservations, stale revisions, expired attempts, extra sessions and completed work", () => {
    for (const mutate of [
      (value: ReturnType<typeof facts>) => { value.pendingInput.sessions[0].expectedNextSequence = 1; },
      (value: ReturnType<typeof facts>) => { value.pendingInput.sessions[0].acceptedBytes = 1; },
      (value: ReturnType<typeof facts>) => { value.pendingInput.sessions[0].ingestRevision = 2; },
      (value: ReturnType<typeof facts>) => { value.pendingInput.sessions[0].expiresAt = value.pendingInput.snapshotAt; },
      (value: ReturnType<typeof facts>) => { value.pendingInput.sessions.push({ ...value.pendingInput.sessions[0], id: foreign }); },
      (value: ReturnType<typeof facts>) => { value.pendingInput.sessions[0].workerJobId = foreign; },
    ]) {
      const value = facts(); mutate(value);
      expect(() => checkedFinalizedEmbryoEmptyFacts(value, expected())).toThrow();
    }
  });
  it("does not accept null, absent source metadata, unknown fields or a fake zero-count summary", () => {
    for (const value of [null, {}, { pendingInput: { fileCount: 0 } },
      { ...facts(), nativeCapture: true }, { ...facts(), pendingInput: { ...facts().pendingInput, unknown: 0 } }])
      expect(() => checkedFinalizedEmbryoEmptyFacts(value, expected())).toThrow();
    const unknownExpected = { ...expected(), unknown: true };
    expect(() => checkedFinalizedEmbryoEmptyFacts(facts(), unknownExpected)).toThrow();
  });
  it("preserves real native before-file admission, all stored bags and the original after-capture worker/publication", () => {
    const source = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
    const helper = source("e2e/density-embryo-empty-state-fixtures.ts");
    for (const relation of ["embryo_cohorts", "embryos", "subjects", "embryo_ingest_sessions", "embryo_ingest_chunks",
      "embryo_ingest_fragments", "genome_files", "embryo_qc", "worker_jobs", "embryo_participant_sets", "purpose_grants"])
      expect(helper).toContain(`public.${relation}`);
    expect(helper).toContain("expect(await pendingBag(scope.cohortId)).toBe(before)");
    expect(helper).toContain("expect(actual.sessions.map(attempt => attempt.id)).toEqual([scope.nativeSessionId])");
    expect(helper).toContain("await scope.ownerPage.context().newPage()");
    expect(helper).toContain("finally { await journey.closeCoParent(); }");
    expect(helper).toContain("undefined, process.platform, input.operator");
    const participant = source("e2e/participant-c-journey.ts");
    expect(participant.indexOf("await options.beforeFile")).toBeLessThan(participant.indexOf(".setInputFiles(path.resolve(fixture))"));
    expect(participant).toContain("await runtime.runWorker(cohortId)");
    expect(participant).toContain("allPartsCurrent: true, pendingOrdinals: 0, pendingVariants: 0");
    const provider = source("e2e/helpers/density-finalized-embryo-empty-state-fixtures.ts");
    expect(provider).toContain('input.origin === "http://localhost:3105"');
    expect(provider).toContain("input.jobsSecret === environment.JOBS_SECRET");
    expect(provider).toContain("await scope.read()");
    expect(provider).toContain("input.observeState(row, scope.page, sourceSha256");
    expect(provider).toContain("await capture({ page: scope.page, observe });");
    expect(provider).not.toMatch(/\.(insert|upsert)\(|setContent\(|route\.fulfill/u);
  });
});
