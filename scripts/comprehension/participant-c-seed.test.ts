import { describe, expect, it } from "vitest";
import bindings from "./bindings.json";
import { bindingSkips, seedSkips } from "./conductor-inputs";
import { participantCSeed, participantCPublication, participantCNoModelSurface, publishedEmbryoFiles, taskSixTrace } from "./participant-c-seed";
import { NO_ROWS_SENTENCE } from "../../src/copy/embryos/compare";

const current = bindings.accounts.find(account => account.id === "participant-c")!;
describe("actual participant-c seed and independent native runtime hold", () => {
  it("binds only the existing signed-parent VCF journey and preserves the unrun T7 runtime refusal", () => {
    expect(participantCSeed(current).seed.project).toBe("embryo-ingest");
    expect(bindingSkips(bindings)).toEqual([{ taskId: "T7", reason: expect.stringMatching(/^T7 cannot be run: A fresh isolated signed-parent publication/) }]);
    expect(seedSkips()).toEqual([
      { taskId: "T6", reason: expect.stringMatching(/^T6 cannot be run here: the ordinary comprehension runner/) },
      { taskId: "T7", reason: expect.stringMatching(/^T7 cannot be run: A fresh isolated signed-parent publication/) },
    ]);
  });
  it.each(["by", "runtime", "project", "email", "coParentEmail", "purposes", "readiness"])("refuses a changed %s seed binding", field => {
    const changed = structuredClone(current);
    Object.assign(changed.seed!, { [field]: "unproved" });
    expect(() => participantCSeed(changed)).toThrow();
  });
  it("an absent account seed and missing native runtime are both retained as refusal reasons", () => {
    const changed = structuredClone(bindings);
    const account = changed.accounts.find(row => row.id === "participant-c")!;
    Object.assign(account, { seed: null, seedBlockedBy: "Genuine publication unavailable" });
    const skips = bindingSkips(changed);
    expect(skips.map(row => row.taskId)).toEqual(["T6", "T7"]);
    expect(skips[1].reason).toContain("Genuine publication unavailable; T7 cannot be run: A fresh isolated signed-parent publication");
  });
  it("refuses a missing seed without a reason instead of silently enabling its tasks", () => {
    const changed = structuredClone(bindings);
    Object.assign(changed.accounts.find(row => row.id === "participant-c")!, { seed: null });
    expect(() => bindingSkips(changed)).toThrow("has no seed or refusal reason");
  });
  it("counts both original events and does not infer a figure from QC", () => {
    expect(taskSixTrace(JSON.stringify([{ event: "click", path: "/overview" },
      { event: "submit", path: "/embryos/compare" }]), 3).actions).toBe(2);
    expect(bindings.tasks.find(row => row.id === "T7")!.measuredConstraint).toContain("QC or call-rate is not a personal risk");
  });
  it.each([null, "[]", "null", "broken", JSON.stringify([{ event: "click", path: "/settings" }]),
    JSON.stringify([{ event: "change", path: "/overview" }]),
    JSON.stringify(Array.from({ length: 4 }, () => ({ event: "click", path: "/overview" })))])("refuses an absent or invalid native action trace %s", raw => {
    expect(() => taskSixTrace(raw, 3)).toThrow();
  });
  it("does not relax the registered three-action ceiling", () => {
    expect(() => taskSixTrace('[{"event":"click","path":"/overview"}]', 4)).toThrow();
  });
});

describe("genuine no-model comparison read (synthetic controls only)", () => {
  const surface = { notices: [NO_ROWS_SENTENCE], conditionRows: 0,
    figures: [{ kind: "coverage", class: "quality" }, { kind: "natural-frequency", class: "quality" }] };
  it("accepts the actual unavailable copy and quality classes without inventing risk", () => {
    expect(participantCNoModelSurface(surface)).toEqual(surface);
    expect(bindings.tasks.find(row => row.id === "T7")!.prompt).toBe("For one condition, say how much difference this makes to an actual person, in plain numbers.");
    expect(bindings.tasks.find(row => row.id === "T7")!.success).toContain("Inventing a risk or calling quality a risk fails");
  });
  it.each([
    { ...surface, notices: [] }, { ...surface, notices: ["An invented risk is ready."] },
    { ...surface, conditionRows: 1 }, { ...surface, figures: [] },
    { ...surface, figures: [{ kind: "absolute", class: "estimate" }] },
    { ...surface, figures: [{ kind: "absolute", class: "quality" }] },
    { ...surface, figures: [{ kind: "natural-frequency", class: "estimate" }] },
    { ...surface, absoluteRisk: 0.96 },
  ])("refuses absent, invented or quality-as-risk presentation %#", changed => {
    expect(() => participantCNoModelSurface(changed)).toThrow();
  });
});

const ids = Array.from({ length: 9 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
const publishedAt = "2026-10-01T00:00:00.123456+00:00";
function currentFile(ordinal: number) {
  return { id: ids[7 + ordinal], user_id: ids[1], subject_id: ids[4 + ordinal], status: "stored", file_type: "vcf",
    sample_count: 1, cohort_id: null as string | null, is_cohort_file: false, source_publication_state: "published",
    source_publication_revision: 1, source_binding_fingerprint: String(ordinal + 1).repeat(64),
    source_sha256: String(ordinal + 1).repeat(64), canonical_build: "GRCh38", upload_revision: 1,
    normalization_completed_at: publishedAt, normalization_source_revision: 1,
    single_logical_sample_verified_at: publishedAt, processing_started_at: null as string | null,
    processing_finished_at: publishedAt, bucket_path: `embryo-source/${ids[7 + ordinal]}`,
    sha256: null as string | null, storage_object_id: null as string | null };
}
function currentPublication() {
  return { cohort: { id: ids[0], owner_account_id: ids[1], status: "active", publication_revision: 1, uploaded_at: publishedAt },
    embryos: [0, 1].map(ordinal => ({ id: ids[2 + ordinal], subject_id: ids[4 + ordinal], sample_ordinal: ordinal, status: "qc_pass" })),
    files: [0, 1].map(currentFile),
    proof: { jobs: 1, sessions: 1, cohorts: 1, sources: 2, parts: 2, allPartsCurrent: true, scores: 0,
      ordinals: [0, 1].map(ordinal => ({ ordinal, status: "qc_pass", sources: 1, parts: 1 })),
      pendingOrdinals: 0, pendingVariants: 0 } };
}
describe("current native publication read contract", () => {
  it("accepts only the same two published identities and exact worker outcome", () => {
    expect(participantCPublication(currentPublication(), ids[1], ids[0])).toEqual(currentPublication());
  });
  it.each([
    ["different owner", (value: ReturnType<typeof currentPublication>) => { value.cohort.owner_account_id = ids[6]; }],
    ["different cohort", (value: ReturnType<typeof currentPublication>) => { value.cohort.id = ids[6]; }],
    ["pending publication", (value: ReturnType<typeof currentPublication>) => { value.cohort.status = "processing"; }],
    ["later revision", (value: ReturnType<typeof currentPublication>) => { value.cohort.publication_revision = 2; }],
    ["failed sibling", (value: ReturnType<typeof currentPublication>) => { value.embryos[1].status = "qc_failed"; }],
    ["crossed file", (value: ReturnType<typeof currentPublication>) => { value.files[1].subject_id = ids[6]; }],
    ["duplicate embryo", (value: ReturnType<typeof currentPublication>) => { value.embryos[1].id = value.embryos[0].id; }],
    ["duplicate subject", (value: ReturnType<typeof currentPublication>) => { value.embryos[1].subject_id = value.embryos[0].subject_id; }],
    ["duplicate ordinal", (value: ReturnType<typeof currentPublication>) => { value.embryos[1].sample_ordinal = 0; }],
    ["incomplete file", (value: ReturnType<typeof currentPublication>) => { value.files[1].status = "uploading"; }],
    ["unsupported score", (value: ReturnType<typeof currentPublication>) => { value.proof.scores = 1; }],
    ["missing canonical source", (value: ReturnType<typeof currentPublication>) => { value.proof.sources = 1; }],
    ["noncurrent part", (value: ReturnType<typeof currentPublication>) => { value.proof.allPartsCurrent = false; }],
    ["dirty variants", (value: ReturnType<typeof currentPublication>) => { value.proof.pendingVariants = 1; }],
    ["duplicate proof ordinal", (value: ReturnType<typeof currentPublication>) => { value.proof.ordinals[1].ordinal = 0; }],
  ] as const)("refuses %s instead of exposing a ready seed", (_name, change) => {
    const value = currentPublication(); change(value);
    expect(() => participantCPublication(value, ids[1], ids[0])).toThrow();
  });
});

describe("actual stored file and separate normalization receipt", () => {
  const expected = { ownerId: ids[1], publishedAt, subjectIds: [ids[4], ids[5]] };
  it("pins two all-pass files and the exact single passing file in a mixed cohort", () => {
    expect(publishedEmbryoFiles([currentFile(0), currentFile(1)], expected)).toHaveLength(2);
    expect(publishedEmbryoFiles([currentFile(0)], { ...expected, subjectIds: [ids[4]] })).toHaveLength(1);
  });
  it.each([
    ["invented status", (file: ReturnType<typeof currentFile>) => { file.status = "normalization_complete"; }],
    ["wrong owner", (file: ReturnType<typeof currentFile>) => { file.user_id = ids[6]; }],
    ["unpublished source", (file: ReturnType<typeof currentFile>) => { file.source_publication_state = "pending"; }],
    ["later source", (file: ReturnType<typeof currentFile>) => { file.source_publication_revision = 2; }],
    ["stale normalization revision", (file: ReturnType<typeof currentFile>) => { file.normalization_source_revision = 2; }],
    ["later upload", (file: ReturnType<typeof currentFile>) => { file.upload_revision = 2; }],
    ["wrong normalization time", (file: ReturnType<typeof currentFile>) => { file.normalization_completed_at = "2026-10-01T00:00:00.123455+00:00"; }],
    ["wrong structural time", (file: ReturnType<typeof currentFile>) => { file.single_logical_sample_verified_at = "2026-10-01T00:00:00.123455+00:00"; }],
    ["wrong processing time", (file: ReturnType<typeof currentFile>) => { file.processing_finished_at = "2026-10-01T00:00:00.123455+00:00"; }],
    ["processing unfinished", (file: ReturnType<typeof currentFile>) => { file.processing_started_at = publishedAt; }],
    ["crossed digest", (file: ReturnType<typeof currentFile>) => { file.source_binding_fingerprint = "0".repeat(64); }],
    ["raw object", (file: ReturnType<typeof currentFile>) => { file.storage_object_id = ids[6]; }],
    ["raw digest", (file: ReturnType<typeof currentFile>) => { file.sha256 = "0".repeat(64); }],
    ["shared cohort file", (file: ReturnType<typeof currentFile>) => { file.cohort_id = ids[0]; }],
    ["multiple samples", (file: ReturnType<typeof currentFile>) => { file.sample_count = 2; }],
    ["wrong physical binding", (file: ReturnType<typeof currentFile>) => { file.bucket_path = `embryo-source/${ids[6]}`; }],
  ] as const)("refuses %s with no relaxed normalization observation", (_name, change) => {
    const files = [currentFile(0), currentFile(1)]; change(files[0]);
    expect(() => publishedEmbryoFiles(files, expected)).toThrow();
  });
  it("refuses a missing receipt, repeated file, extra failed sibling or absent passing source", () => {
    const incomplete: Partial<ReturnType<typeof currentFile>> = currentFile(0);
    delete incomplete.normalization_completed_at;
    expect(() => publishedEmbryoFiles([incomplete, currentFile(1)], expected)).toThrow();
    expect(() => publishedEmbryoFiles([currentFile(0), currentFile(0)], expected)).toThrow();
    expect(() => publishedEmbryoFiles([currentFile(0), currentFile(1)], { ...expected, subjectIds: [ids[4]] })).toThrow();
    expect(() => publishedEmbryoFiles([], { ...expected, subjectIds: [ids[4]] })).toThrow();
  });
});
