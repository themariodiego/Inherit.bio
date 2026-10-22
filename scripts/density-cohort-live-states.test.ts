import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { densityCapturePlan, densityStateKey } from "./density-capture-plan";
import { COHORT_LIVE_DENSITY_STATES, cohortLiveDensityRecipe, liveCohortDensitySchema } from "./density-cohort-live-states";
import { isPublishedCohortDensityState, publishedCohortBagSchema } from "./density-cohort-publication-states";
import { cohortEntryDensityRecipe } from "./density-cohort-entry-states";
import type { DensityRegister } from "./density-current";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) => readFileSync(path.join(root, name), "utf8");
const register = JSON.parse(read("docs/route-register.json")) as DensityRegister;
const source = read("e2e/helpers/density-cohort-live-state-fixtures.ts");
const id = (n: number) => `0a000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const bag = (count: number) => ({ count, sha256: "a".repeat(64) });
function complete(phase: "processing" | "analysis-pending") {
  const pending = phase === "processing";
  const zero = new Set(pending ? ["files", "qc", "scores", "variants", "grants", "futurePersonProfiles", "sources", "parts", "memberships"]
    : ["scores", "grants", "futurePersonProfiles"]);
  const two = new Set(["embryos", "subjects", "files", "qc", "sources", "parts", "memberships"]);
  const bags = Object.fromEntries(Object.keys(publishedCohortBagSchema.shape).map(name => [name,
    bag(zero.has(name) ? 0 : two.has(name) ? 2 : 1)]));
  return { phase, ownerMatches: true, cohortId: id(1), ownerId: id(2),
    cohortStatus: pending ? "ingesting" : "active", publicationRevision: pending ? null : 1,
    embryos: [0, 1].map(n => ({ id: id(3 + n), subjectId: id(5 + n), sampleOrdinal: n, status: pending ? "pending" : "qc_pass" })),
    jobId: id(7), sessionId: id(8), sessionWorkerJobId: id(7), jobSourceBindingId: id(8),
    jobStatus: pending ? "queued" : "done", jobAttempts: pending ? 0 : 1, sessionStatus: pending ? "sanitization_pending" : "published",
    analysisGrants: 0, allSplitJobs: 1, pendingOrdinals: bag(0), pendingVariants: bag(0), writeIntents: bag(2),
    inputFragments: bag(2), directions: bag(0), drafts: bag(1), splitConfig: bag(1), objectConfig: bag(1), bags };
}

describe("real cohort lifecycle density boundaries", () => {
  it("provides six declared phases and derives every currently applicable pair without borrowing a completed or empty fixture", () => {
    const declared = Object.entries(COHORT_LIVE_DENSITY_STATES).flatMap(([route, states]) => Object.keys(states)
      .map(state => densityStateKey(route, state)));
    expect(new Set(declared).size).toBe(6);
    const states = densityCapturePlan(register, []).states;
    const required = new Set(states.map(row => densityStateKey(row.route.id, row.state)));
    const actual = states.filter(row => cohortLiveDensityRecipe(row));
    expect(new Set(actual.map(row => densityStateKey(row.route.id, row.state)))).toEqual(new Set(declared.filter(key => required.has(key))));
    expect(actual.every(row => !isPublishedCohortDensityState(row) && cohortEntryDensityRecipe(row) === null)).toBe(true);
    for (const state of ["complete", "empty", "partial-coverage", "not-covered", "malformed-state"])
      expect(cohortLiveDensityRecipe({ route: { id: "embryos.detail", path: "/embryos/[embryoId]", kind: "page", surface: "standard" }, state })).toBeNull();
  });
  it("accepts only the exact native pre-worker or published-before-analysis contexts", () => {
    for (const phase of ["processing", "analysis-pending"] as const)
      expect(liveCohortDensitySchema.safeParse(complete(phase)).success).toBe(true);
    for (const value of [null, {}, [], { ...complete("processing"), extra: true }])
      expect(liveCohortDensitySchema.safeParse(value).success).toBe(false);
  });
  it("rejects a foreign owner, repeated source identity, stale revision or uncertain worker instead of calling it processing", () => {
    const original = complete("processing");
    for (const delta of [{ ownerMatches: false }, { publicationRevision: 0 }, { publicationRevision: 1 },
      { jobStatus: "running" }, { jobAttempts: 1 }, { jobSourceBindingId: id(11) }, { sessionWorkerJobId: id(12) },
      { cohortStatus: "upload_pending" }, { sessionStatus: "processing" }, { allSplitJobs: 2 },
      { embryos: [original.embryos[0], original.embryos[0]] },
      { embryos: original.embryos.map(row => ({ ...row, subjectId: id(5) })) }])
      expect(liveCohortDensitySchema.safeParse({ ...original, ...delta }).success).toBe(false);
  });
  it("rejects any result, permission or advanced source on the queued boundary", () => {
    const original = complete("processing");
    for (const name of ["scores", "qc", "files", "sources", "parts", "memberships", "grants", "futurePersonProfiles"])
      expect(liveCohortDensitySchema.safeParse({ ...original, bags: { ...original.bags, [name]: bag(1) } }).success).toBe(false);
    for (const delta of [{ analysisGrants: 1 }, { directions: bag(1) }, { pendingOrdinals: bag(1) }, { pendingVariants: bag(1) }])
      expect(liveCohortDensitySchema.safeParse({ ...original, ...delta }).success).toBe(false);
  });
  it("requires genuine complete publication while both analysis grants are still absent", () => {
    const original = complete("analysis-pending");
    for (const delta of [{ analysisGrants: 1 }, { directions: bag(1) }, { jobAttempts: 0 }, { jobStatus: "queued" },
      { sessionStatus: "sanitization_pending" }, { embryos: original.embryos.map(row => ({ ...row, status: "pending" })) }])
      expect(liveCohortDensitySchema.safeParse({ ...original, ...delta }).success).toBe(false);
    for (const [name, count] of [["files", 0], ["sources", 1], ["qc", 0], ["scores", 1], ["grants", 1], ["parentHistory", 0]] as const)
      expect(liveCohortDensitySchema.safeParse({ ...original, bags: { ...original.bags, [name]: bag(count) } }).success).toBe(false);
  });
  it("refuses truncated, extra, fractional and malformed full native row bags", () => {
    const original = complete("processing");
    const missing = { ...original.bags }; delete missing.basis;
    for (const bags of [missing, { ...original.bags, invented: bag(0) }, { ...original.bags, variants: bag(-1) },
      { ...original.bags, operationHistory: bag(0.5) }, { ...original.bags, operationHistory: { count: 1, sha256: "A".repeat(64) } }])
      expect(liveCohortDensitySchema.safeParse({ ...original, bags }).success).toBe(false);
  });
  it("holds composition and source/runtime admission, captures the actual callback, then finishes the unchanged one-shot worker", () => {
    for (const text of ["COHORT_DENSITY_NATIVE_SOURCES.some", "await input.withFreshNativeRuntime(row, viewport",
      "environment[name] === process.env[name]", "input.jobsSecret === environment.JOBS_SECRET", "fs.realpathSync(process.cwd())",
      'await import("../participant-c-journey")', "await withEmbryoJourney(environment", "await seedParticipantC({",
      'if (phase === "processing") await atBoundary(cohortId)', "await runtime.runWorker(cohortId); completed = true",
      'if (phase === "analysis-pending") await atBoundary(cohortId)', "attempted && completed && captured",
      "participantCPublication(await journey.readPublication()", "await journey.closeCoParent()", "assertSource()"])
      expect(source).toContain(text);
    expect(source).not.toMatch(/\.fulfill\(|\.abort\(|\.setContent\(|\.addInitScript\(|\.listen\(|\.from\([^)]*\)\.(?:insert|update|upsert|delete)\(/u);
    expect(source).not.toMatch(/update public\.|delete from|truncate /iu);
  });
  it("binds every complete full-row bag and the actual source/job linkage while preserving full processing and consent copy", () => {
    for (const text of ["cohortBagSql(cohortId)", 'jsonb_agg(row order by row::text collate "C")', "'[]'::jsonb",
      "w.source_binding_id", "s.worker_job_id=w.id", "s.cohort_id=c.id", "u.deleted_at is null", "allSplitJobs",
      "complete native pending source, parent and job rows remain exact", "expect(await read()).toEqual(before)",
      "select(EMBRYO_PUBLISHED_FILE_SELECT)", "proof: await runtime.proof(cohortId)",
      "publication = participantCPublication({ cohort: cohort.data, embryos: embryos.data",
      "PROCESSING_SENTENCE", "STILL_CHECKING_STATUS", "waitingForResultsBody(ROLE_YOU)", 'toHaveAttribute("data-state", row.state)',
      "No retry or duplicate worker attempt permitted"])
      expect(source).toContain(text);
  });
});
