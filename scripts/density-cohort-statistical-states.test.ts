import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { densityCapturePlan, densityStateKey } from "./density-capture-plan";
import { publishedCohortBagSchema } from "./density-cohort-publication-states";
import { STATISTICAL_COHORT_DENSITY_NATIVE_SOURCES, checkedStatisticalCohortBags,
  statisticalCohortBagSchema, statisticalCohortDensityRecipe } from "./density-cohort-statistical-states";
import type { DensityRegister } from "./density-current";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) => readFileSync(path.join(root, name), "utf8");
const source = read("e2e/helpers/density-cohort-statistical-state-fixtures.ts");
const states = densityCapturePlan(JSON.parse(read("docs/route-register.json")) as DensityRegister, []).states;
const initialBags = () => Object.fromEntries(Object.keys(publishedCohortBagSchema.shape).map(name => [name,
  { count: ["scores", "futurePersonProfiles"].includes(name) ? 0
    : ["embryos", "subjects", "files", "qc", "sources", "parts", "memberships"].includes(name) ? 2 : 1,
  sha256: "a".repeat(64) }]));
const currentBags = () => ({ ...initialBags(), scores: { count: 2, sha256: "b".repeat(64) },
  jobs: { count: 2, sha256: "c".repeat(64) } });

describe("actual own-call statistical density providers", () => {
  it("derives exactly six current pairs without taking ordinary completion, empty or refusal states", () => {
    const actual = states.filter(row => statisticalCohortDensityRecipe(row) !== null);
    expect(new Set(actual.map(row => densityStateKey(row.route.id, row.state)))).toEqual(new Set(
      ["embryos.index", "embryos.compare", "embryos.detail"].flatMap(id =>
        ["not-covered", "partial-coverage"].map(state => densityStateKey(id, state)))));
    expect(actual).toHaveLength(6);
    expect(actual.filter(row => statisticalCohortDensityRecipe(row) === "uncovered")).toHaveLength(3);
    expect(actual.filter(row => statisticalCohortDensityRecipe(row) === "fitted-partial")).toHaveLength(3);
    for (const state of ["complete", "empty", "processing", "consent-required", "jurisdiction-unavailable"])
      expect(statisticalCohortDensityRecipe({ ...actual[0], state })).toBeNull();
  });
  it("refuses a foreign route, path, authority or profile even with a familiar state label", () => {
    const template = states.find(row => statisticalCohortDensityRecipe(row) === "fitted-partial")!;
    for (const route of [{ ...template.route, id: "family.health-picture" }, { ...template.route, path: "/embryos/upload" },
      { ...template.route, auth: "public" }, { ...template.route, stateProfile: "public-rights-flow" }])
      expect(statisticalCohortDensityRecipe({ ...template, route })).toBeNull();
  });
  it("refuses missing, extra, projected, malformed and uncertain complete native bags", () => {
    expect(statisticalCohortBagSchema.safeParse(currentBags()).success).toBe(true);
    for (const name of Object.keys(publishedCohortBagSchema.shape)) {
      const missing: Record<string, unknown> = currentBags(); delete missing[name];
      expect(statisticalCohortBagSchema.safeParse(missing).success).toBe(false);
    }
    expect(statisticalCohortBagSchema.safeParse({ ...currentBags(), ignoredRows: [] }).success).toBe(false);
    for (const count of [null, "2", -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(statisticalCohortBagSchema.safeParse({ ...currentBags(), variants: { count, sha256: "a".repeat(64) } }).success).toBe(false);
    for (const sha256 of [null, "A".repeat(64), "a".repeat(63)])
      expect(statisticalCohortBagSchema.safeParse({ ...currentBags(), scores: { count: 2, sha256 } }).success).toBe(false);
    expect(statisticalCohortBagSchema.safeParse({ ...currentBags(), qc: { count: 2, sha256: "a".repeat(64), ids: [] } }).success).toBe(false);
  });
  it("allows only the actual score and job advancement and preserves every other whole bag", () => {
    expect(checkedStatisticalCohortBags(initialBags(), currentBags())).toEqual(currentBags());
    for (const name of Object.keys(publishedCohortBagSchema.shape).filter(name => name !== "scores" && name !== "jobs")) {
      expect(() => checkedStatisticalCohortBags(initialBags(), { ...currentBags(),
        [name]: { ...currentBags()[name as keyof ReturnType<typeof currentBags>], sha256: "f".repeat(64) } })).toThrow();
    }
    for (const count of [0, 1, 3]) for (const name of ["scores", "jobs"])
      expect(() => checkedStatisticalCohortBags(initialBags(), { ...currentBags(),
        [name]: { count, sha256: "a".repeat(64) } })).toThrow();
    expect(() => checkedStatisticalCohortBags(currentBags(), currentBags())).toThrow();
  });
  it("requires current composed source and fresh native caller before any process-wide helper loads", () => {
    expect(STATISTICAL_COHORT_DENSITY_NATIVE_SOURCES).toContain("src/lib/embryos/statistical-fit-contract.ts");
    for (const text of ["STATISTICAL_COHORT_DENSITY_NATIVE_SOURCES.some", "return []", "await input.withFreshNativeRuntime(row, viewport",
      'input.origin === "http://localhost:3105"', "environment[name] === process.env[name]",
      "localE2eProject(environment).projectId", "input.jobsSecret === environment.JOBS_SECRET",
      "ownedLinuxEnvironment(operator)", "fs.realpathSync(process.cwd()) === fs.realpathSync(input.root)", "assertSource()"])
      expect(source).toContain(text);
    expect(source.indexOf("environment[name] === process.env[name]")).toBeLessThan(source.indexOf('await import("../participant-c-journey")'));
  });
  it("runs the real original parent journey and its distinct completed fitted continuation", () => {
    for (const text of ['ownerEmail: "participant-c@e2e.local"', 'parentEmail: "participant-c-parent@e2e.local"',
      "await runtime.runStatisticalWorker(first.cohortId)", "await auditNativeStatisticalCoverage(",
      "await runtime.withFittedJourney(first.cohortId", 'ownerEmail: "fitted-test@e2e.local"',
      'parentEmail: "fitted-test-parent@e2e.local"', 'runtime: fitted, fittedSeed: "partial"',
      "await fitted.runStatisticalWorker(second.cohortId)", "await auditNativeFittedStatisticalCoverage(",
      "await auditPublishedEmbryoSurfaces(", "await provePublishedQcCrossSurface(",
      "messages: input.actualMessages, jobsSecret: input.jobsSecret", "await second.closeCoParent()", "await first.closeCoParent()"])
      expect(source).toContain(text);
    expect(source).not.toMatch(/\.fulfill\(|\.setContent\(|\.addInitScript\(|\.addCookies\(|\b(?:insert into|update public|update private|delete from|truncate)\b/iu);
    expect(source).not.toMatch(/\.from\([^)]*\)\.(?:insert|update|upsert|delete)\(/u);
  });
  it("binds complete producer receipts and both owned histories around the actual pixel capture", () => {
    for (const text of ["cohortBagSql(cohortId)", "participantCPublication(await first.readPublication()",
      "participantCPublication(await second.readPublication()", "checkedStatisticalCohortBags(before,",
      "statisticalCohortBagSchema.parse(await readBag(journey.cohortId))", "await proof()",
      "expect(statisticalProof,", ".toEqual(originalProof)", "expect(completeNativeBags,", ".toEqual(originalBags)",
      "expect(completeFirstHistoryBags,", ".toEqual(firstHistory)", "nativeSnapshot: { publication, statisticalProof, completeNativeBags, completeFirstHistoryBags, recipe }",
      "await observe(); await capture({ page, observe }); await observe()", "expect(statisticalCohortBagSchema.parse(await readBag(first.cohortId))).toEqual(firstAfter)"])
      expect(source).toContain(text);
    expect(source).not.toMatch(/limit\s+\d|\.slice\(0|proof\s*\?\?|result\s*\?\?/iu);
  });
  it("keeps observed missing coverage distinct from the invented model and held clinical finding", () => {
    for (const text of ['toHaveAttribute("data-interpretation", "held")', 'toHaveAttribute("data-coverage-state", "not_covered")',
      'toHaveAttribute("data-subject-id", embryo.subject_id)', "read 0 of the 10 positions this needs", "read 8 of the 10 positions this needs",
      'toHaveAttribute("data-publication", "synthetic-fitted-test-only")', '[data-test-result="fitted"][data-finding-kind="none"]',
      "This invented reference tests file coverage. It gives no medical interpretation.",
      "Every reference observation is invented. This tests the maths and what you see on screen. It gives no medical interpretation.",
      "OBSERVED own-file coverage. Missing positions remain in the full score denominator.",
      "MODELLED invented-control probability and range. This is not a clinical result.", "WITHIN_FAMILY_NOT_TESTED", "NO_RANKING_STATEMENT",
      '[data-figure-kind="absolute"], [data-figure-kind="relative"], [data-figure-kind="percentile"], [aria-sort]'])
      expect(source).toContain(text);
  });
});
