import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { densityCapturePlan, densityStateKey } from "./density-capture-plan";
import { COHORT_PUBLICATION_DENSITY_STATES, COHORT_DENSITY_NATIVE_SOURCES, isPublishedCohortDensityState, publishedCohortBagSchema } from "./density-cohort-publication-states";
import { cohortEntryDensityRecipe } from "./density-cohort-entry-states";
import type { DensityRegister } from "./density-current";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) => readFileSync(path.join(root, name), "utf8");
const source = read("e2e/helpers/density-cohort-publication-state-fixtures.ts");
const register = JSON.parse(read("docs/route-register.json")) as DensityRegister;
describe("native parent-authorized density publication", () => {
  it("prepares exactly the four registered complete surfaces, separate from real empty entry", () => {
    const states = densityCapturePlan(register, []).states.filter(isPublishedCohortDensityState);
    expect(states).toHaveLength(4);
    expect(new Set(states.map(row => densityStateKey(row.route.id, row.state)))).toEqual(new Set(
      Object.entries(COHORT_PUBLICATION_DENSITY_STATES).map(([id, state]) => densityStateKey(id, state))));
    expect(states.every(row => cohortEntryDensityRecipe(row) === null)).toBe(true);
    for (const state of ["processing", "partial-coverage", "not-covered", "consent-required"])
      expect(isPublishedCohortDensityState({ ...states[0], state })).toBe(false);
  });
  it("returns no fixture without composition and retains the original owner/queue admission", () => {
    expect(COHORT_DENSITY_NATIVE_SOURCES).toContain("scripts/ci-embryo-journey.ts");
    expect(source).toContain('if (COHORT_DENSITY_NATIVE_SOURCES.some(name => !fs.existsSync(path.join(input.root, name)))) return []');
    expect(source).toContain("await input.withFreshNativeRuntime(row, viewport,");
    expect(source).toContain("await withEmbryoJourney(environment,");
    expect(source).toContain("}, undefined, process.platform, operator)");
    expect(source).not.toMatch(/\.from\([^)]*\)\.(?:insert|update|upsert|delete)\(|truncate\s|delete from|update public\./iu);
  });
  it("uses the real two-parent mail, signatures, worker and exact current reader", () => {
    for (const text of ['await import("../participant-c-journey")', "await seedParticipantC({",
      "messages: input.actualMessages, jobsSecret: input.jobsSecret, runtime", "participantCPublication(await readPublication(), owner, cohortId)",
      "await auditPublishedEmbryoSurfaces(", "await provePublishedQcCrossSurface(", "await journey.closeCoParent()"])
      expect(source).toContain(text);
    expect(source).not.toMatch(/\.fulfill\(|\.setContent\(|\.addInitScript\(|\.listen\(/u);
  });
  it("refuses a separately bound caller before the original process-wide readers load", () => {
    expect(source.indexOf("environment[name] === process.env[name]")).toBeLessThan(source.indexOf('await import("../participant-c-journey")'));
    expect(source).toContain('localE2eProject(environment).projectId === "sequence"');
    expect(source).toContain("input.jobsSecret === environment.JOBS_SECRET");
    expect(source).toContain("Object.entries(ownedLinuxEnvironment(operator))");
    expect(source).toContain("process.env[name] === value");
    expect(source).toContain("fs.realpathSync(process.cwd()) === fs.realpathSync(input.root)");
  });
  it("binds all full native row bags with counts, stable order, duplicates and empty values", () => {
    for (const name of ["cohort", "embryos", "subjects", "files", "qc", "scores", "variants", "jobs", "sessions", "basis",
      "participants", "parentHistory", "grants", "attestations", "operationHistory", "futurePersonProfiles", "principals", "profiles", "sources", "parts", "memberships"])
      expect(source).toContain(`${name}: \`select to_jsonb(r) row`);
    expect(source).toContain("'count',count(*)");
    expect(source).toContain('jsonb_agg(row order by row::text collate "C")');
    expect(source).toContain("'[]'::jsonb");
    expect(source).toContain("expect(completeNativeBags,");
    expect(source).toContain("expect(await readBags()).toEqual(beforeBags)");
    expect(source).toContain("publishedCohortBagSchema.parse(value)");
  });
  it("keeps ordinary completed QC separate from absent scientific findings", () => {
    expect(source).toContain('[data-figure-kind="absolute"], [data-figure-kind="interval"]');
    expect(source).toContain('[aria-sort], table th button');
    expect(source).toContain('toHaveAttribute("data-verdict", "pass")');
    expect(source).not.toContain("runStatisticalWorker(");
    expect(source).toContain("assertSource()");
  });
  const fullBags = () => Object.fromEntries(Object.keys(publishedCohortBagSchema.shape).map(name => [name,
    { count: ["scores", "futurePersonProfiles"].includes(name) ? 0
      : ["embryos", "subjects", "files", "qc", "sources", "parts", "memberships"].includes(name) ? 2 : 1,
    sha256: "a".repeat(64) }]));
  it("refuses missing, extra and malformed native bags instead of treating a read failure as empty", () => {
    expect(publishedCohortBagSchema.safeParse(fullBags()).success).toBe(true);
    const missing = fullBags(); delete missing.parentHistory;
    expect(publishedCohortBagSchema.safeParse(missing).success).toBe(false);
    expect(publishedCohortBagSchema.safeParse({ ...fullBags(), unrelated: { count: 0, sha256: "a".repeat(64) } }).success).toBe(false);
    for (const count of [null, "1", -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(publishedCohortBagSchema.safeParse({ ...fullBags(), variants: { count, sha256: "a".repeat(64) } }).success).toBe(false);
    for (const sha256 of [null, "A".repeat(64), "a".repeat(63)])
      expect(publishedCohortBagSchema.safeParse({ ...fullBags(), variants: { count: 0, sha256 } }).success).toBe(false);
  });
  it("refuses absent parents, stale worker counts and scientific rows on the ordinary no-model journey", () => {
    for (const [name, count] of [["parentHistory", 0], ["grants", 0], ["attestations", 0], ["principals", 0],
      ["jobs", 2], ["sessions", 0], ["sources", 1], ["qc", 0], ["scores", 1], ["futurePersonProfiles", 1]] as const)
      expect(publishedCohortBagSchema.safeParse({ ...fullBags(), [name]: { count, sha256: "a".repeat(64) } }).success).toBe(false);
  });
});
