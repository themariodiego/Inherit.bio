import { describe, expect, it } from "vitest";
import { isUntouchedPendingInput, parsePendingEmbryoInput } from "./pending-input";


import { untouchedPending } from "./pending-input-fixture.test-support";

describe("native pending-input facts", () => {
  it("recognizes actual finalized reservations without pretending QC passed", () => {
    expect(isUntouchedPendingInput(untouchedPending())).toBe(true);
  });
  for (const field of ["fileCount", "qcCount", "chunkCount", "fragmentCount", "workCount", "activeWorkCount"] as const) {
    it(`does not hide real ${field}`, () => {
      const row = untouchedPending(); row[field] = 1; if (field === "activeWorkCount") row.workCount = 1;
      expect(isUntouchedPendingInput(row)).toBe(false);
    });
  }
  for (const field of ["acceptedBytes", "acceptedChunks", "acceptedRecords", "expectedNextSequence"] as const) {
    it(`does not hide an actual reservation's ${field}`, () => {
      const row = untouchedPending(); row.sessions[0][field] = 1;
      expect(isUntouchedPendingInput(row)).toBe(false);
    });
  }
  for (const status of ["mapping_required", "sanitization_pending", "processing", "failed", "abandoned", "cancelled", "failure_pending", "complete", "published"] as const) {
    it(`does not call a ${status} attempt untouched`, () => {
      const row = untouchedPending(); row.sessions[0].status = status; expect(isUntouchedPendingInput(row)).toBe(false);
    });
  }
  it("keeps both queued and running work processing even before a source file publishes", () => {
    const row = untouchedPending(); row.workCount = row.activeWorkCount = 1;
    expect(isUntouchedPendingInput(row)).toBe(false);
  });
  it("keeps a real file pending QC processing without requiring a made-up passing QC row", () => {
    const row = untouchedPending(); row.fileCount = 1; row.qcCount = 0;
    expect(isUntouchedPendingInput(row)).toBe(false);
  });
  it("refuses missing, duplicated, stale, expired or already completed attempts", () => {
    const base = untouchedPending();
    for (const sessions of [[], [base.sessions[0], base.sessions[0]],
      [{ ...base.sessions[0], ingestRevision: 2 }], [{ ...base.sessions[0], lifecycleRevision: 2 }],
      [{ ...base.sessions[0], expiresAt: base.snapshotAt }], [{ ...base.sessions[0], completedAt: base.snapshotAt }],
      [{ ...base.sessions[0], workerJobId: base.embryoId }]])
      expect(isUntouchedPendingInput({ ...base, sessions })).toBe(false);
  });
  it("never relabels active/ingesting/published or nonpending subjects", () => {
    const row = untouchedPending();
    expect(isUntouchedPendingInput({ ...row, cohortStatus: "ingesting" })).toBe(false);
    expect(isUntouchedPendingInput({ ...row, cohortStatus: "active" })).toBe(false);
    expect(isUntouchedPendingInput({ ...row, publicationRevision: 1 })).toBe(false);
    expect(isUntouchedPendingInput({ ...row, embryoStatus: "qc_pass" })).toBe(false);
    expect(isUntouchedPendingInput({ ...row, subjectLifecycle: "active" })).toBe(false);
  });
  it("rejects null, extra/private fields, missing/null counts, negatives and unknown native values", () => {
    const row = untouchedPending(), scope = { accountId: row.accountId, cohortId: row.cohortId, embryoId: row.embryoId, subjectId: row.subjectId };
    for (const raw of [null, { ...row, cookie_hash: "private" }, { ...row, fileCount: null },
      { ...row, fileCount: -1 }, { ...row, sessions: [{ ...row.sessions[0], status: "unknown" }] },
      { ...row, sessions: [{ ...row.sessions[0], expiresAt: "invalid" }] }])
      expect(parsePendingEmbryoInput(raw, scope)).toBeNull();
  });
  for (const key of ["accountId", "cohortId", "embryoId", "subjectId"] as const) {
    it(`does not borrow a different ${key}'s empty proof`, () => {
      const row = untouchedPending(), scope = { accountId: row.accountId, cohortId: row.cohortId, embryoId: row.embryoId, subjectId: row.subjectId };
      expect(parsePendingEmbryoInput({ ...row, [key]: "ffffffff-ffff-4fff-8fff-ffffffffffff" }, scope)).toBeNull();
    });
  }
});
