import { describe, expect, it } from "vitest";
import bindings from "./bindings.json";
import { bindingSkips, seedSkips } from "./conductor-inputs";
import { participantCSeed, participantCPublication, taskSixTrace } from "./participant-c-seed";

const current = bindings.accounts.find(account => account.id === "participant-c")!;
describe("actual participant-c seed and independent unsupported risk hold", () => {
  it("binds only the existing signed-parent VCF journey and preserves the T7 scientific refusal", () => {
    expect(participantCSeed(current).seed.project).toBe("embryo-ingest");
    expect(bindingSkips(bindings)).toEqual([{ taskId: "T7", reason: expect.stringMatching(/^T7 cannot be run: No approved producer/) }]);
    expect(seedSkips()).toEqual([
      { taskId: "T6", reason: expect.stringMatching(/^T6 cannot be run here: the ordinary comprehension runner/) },
      { taskId: "T7", reason: expect.stringMatching(/^T7 cannot be run: No approved producer/) },
    ]);
  });
  it.each(["by", "runtime", "project", "email", "coParentEmail", "purposes", "readiness"])("refuses a changed %s seed binding", field => {
    const changed = structuredClone(current);
    Object.assign(changed.seed!, { [field]: "unproved" });
    expect(() => participantCSeed(changed)).toThrow();
  });
  it("an absent account seed and scientific surface are both retained as refusal reasons", () => {
    const changed = structuredClone(bindings);
    const account = changed.accounts.find(row => row.id === "participant-c")!;
    Object.assign(account, { seed: null, seedBlockedBy: "Genuine publication unavailable" });
    const skips = bindingSkips(changed);
    expect(skips.map(row => row.taskId)).toEqual(["T6", "T7"]);
    expect(skips[1].reason).toContain("Genuine publication unavailable; T7 cannot be run: No approved producer");
  });
  it("refuses a missing seed without a reason instead of silently enabling its tasks", () => {
    const changed = structuredClone(bindings);
    Object.assign(changed.accounts.find(row => row.id === "participant-c")!, { seed: null });
    expect(() => bindingSkips(changed)).toThrow("has no seed or refusal reason");
  });
  it("counts both original events and does not infer a figure from QC", () => {
    expect(taskSixTrace(JSON.stringify([{ event: "click", path: "/overview" },
      { event: "submit", path: "/embryos/compare" }]), 3).actions).toBe(2);
    expect(bindings.tasks.find(row => row.id === "T7")!.fixtureBlockedBy).toContain("QC or call-rate is not a personal risk");
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

const ids = Array.from({ length: 7 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
function currentPublication() {
  return { cohort: { id: ids[0], owner_account_id: ids[1], status: "active", publication_revision: 1 },
    embryos: [0, 1].map(ordinal => ({ id: ids[2 + ordinal], subject_id: ids[4 + ordinal], sample_ordinal: ordinal, status: "qc_pass" })),
    files: [0, 1].map(ordinal => ({ subject_id: ids[4 + ordinal], status: "normalization_complete" })),
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
