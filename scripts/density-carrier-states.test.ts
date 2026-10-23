import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { densityCapturePlan, densityStateKey } from "./density-capture-plan";
import { CARRIER_DENSITY_RECIPES, CARRIER_DENSITY_STATES, carrierDensityRecipe } from "./density-carrier-states";
import { requiredDensityCaptures, type DensityRegister } from "./density-current";
import { reportDensityRecipe } from "./density-report-states";
import { ownedDensityRecipe } from "./density-owned-states";
import { familyDensityRecipe } from "./density-family-states";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) => readFileSync(path.join(root, name), "utf8");
const register = JSON.parse(read("docs/route-register.json")) as DensityRegister;
const states = densityCapturePlan(register, []).states;

describe("the genome.carrier density provider", () => {
  it("covers exactly the six registered carrier pairs, and no pair another provider owns", () => {
    const carrier = states.filter(row => carrierDensityRecipe(row));
    expect(carrier.map(row => row.state).sort()).toEqual(
      ["complete", "consent-required", "empty", "not-covered", "partial-coverage", "processing"]);
    expect(Object.keys(CARRIER_DENSITY_STATES).sort()).toEqual(carrier.map(row => row.state).sort());
    expect(carrier.every(row => reportDensityRecipe(row) === null && ownedDensityRecipe(row) === null
      && familyDensityRecipe(row) === null)).toBe(true);
    expect(requiredDensityCaptures(register).filter(row => row.route.id === "genome.carrier")).toHaveLength(12);
  });
  it("holds other routes and malformed states, and refuses a moved carrier route", () => {
    const row = states.find(entry => entry.route.id === "genome.carrier")!;
    expect(carrierDensityRecipe({ ...row, state: "not-covered-malformed" })).toBeNull();
    expect(carrierDensityRecipe({ ...row, route: { ...row.route, id: "genome.reports" } })).toBeNull();
    expect(() => carrierDensityRecipe({ ...row, route: { ...row.route, path: "/genome/[subject]/carriers" } })).toThrow();
  });
  it("reaches each state by its registered cause, as the carrier browser spec does", () => {
    expect(CARRIER_DENSITY_RECIPES).toEqual({
      "no-file": { active: ["one", "three"], file: "none", monogenicChoice: false, pageState: "empty" },
      "in-flight": { active: ["one", "three"], file: "held", monogenicChoice: false, pageState: "processing" },
      "no-reviewed-condition": { active: [], file: "prepared", monogenicChoice: false, pageState: "unavailable" },
      "choice-off": { active: ["one", "three"], file: "prepared", monogenicChoice: false, pageState: "consent-required" },
      "every-position-read": { active: ["one", "three"], file: "prepared", monogenicChoice: true, pageState: "complete" },
      "position-not-reported": { active: ["one", "two", "three"], file: "prepared", monogenicChoice: true, pageState: "partial-coverage" },
    });
    const spec = read("e2e/own-carrier-status.spec.ts");
    for (const state of ["empty", "processing", "not-covered", "consent-required", "complete", "partial-coverage"])
      expect(spec).toContain(`"/genome/[subject]/carrier ${state}:`);
  });
  it("uses only the real upload, choice and generation paths and the release's own doors", () => {
    const source = read("e2e/helpers/density-carrier-state-fixtures.ts");
    for (const text of ["await createConfirmedUser(email, password)", "await signIn(page, email, password)",
      "await uploadOwnFilePrepared(page, fixture, { fileType: \"vcf\" })", "await uploadOwnFileThroughUi(page, fixture)",
      'await generateOwnFileWithChosenReports(page, fileId, ["reports.monogenic"])',
      "await importSyntheticRelease(releaseId, ALL, sourcePath)", 'await reviewSynthetic(CONDITIONS[name], "activate", sourcePath)',
      "await withdrawSynthetic(ALL, sourcePath)", "await route.continue()", "await response.finished() === null",
      "expect(facts, \"the complete native carrier state stays exact around capture\").toEqual(fixed)",
      "return input.observeState(row, view, sourceSha256, { accountId, nativeSnapshot: facts })",
      'expect(fs.readFileSync(fixture, "utf8")).toBe(`${buildCarrierPairVcf().join("\\n")}\\n`)']) expect(source).toContain(text);
    expect(source).not.toMatch(/\.fulfill\(|\.abort\(|\.setContent\(|\.addInitScript\(/u);
    expect(source).not.toMatch(/\.from\([^)]*\)\.(?:insert|update|upsert|delete)\(/u);
    expect(source).not.toMatch(/\.rpc\(/u);
  });
  it("keeps every safety sentence of the page asserted, and no result where none is read", () => {
    const source = read("e2e/helpers/density-carrier-state-fixtures.ts");
    for (const text of ["This check is unavailable. Inherit cannot yet verify the evidence for each gene change. This is not a negative carrier screen.",
      "This is not a negative result.", "Some reviewed positions were not read in this file.",
      "toHaveText(LAB_CONFIRMATION_LINE)", "toHaveText(PENETRANCE_NOT_ESTABLISHED)", "toHaveText([...OWN_CARRIER_LIMITS])",
      "await expectNoResult(page)", "per pregnancy"]) expect(source).toContain(text);
  });
  it("is wired into the assembly, the owned capture ports and the native observers", () => {
    const assembly = read("e2e/helpers/density-runtime-fixture-assembly.ts");
    expect(assembly).toContain("ownCarrier: Parameters<typeof realOwnCarrierDensityFixtures>[0];");
    expect(assembly).toContain("...bindService(realOwnCarrierDensityFixtures(input.ownCarrier), input.ownCarrier.origin)");
    expect(read("scripts/density-owned-capture.ts")).toContain("ownCarrier: 3100");
    const observers = read("scripts/density-root-native-observers.ts");
    expect(observers).toContain('ownCarrier: "density-carrier-state-fixtures"');
    expect(observers).toContain('ownCarrier: provider("ownCarrier")');
  });
});

describe("the complete source census", () => {
  it("has a reviewed provider for every one of the registered pairs", async () => {
    const { assembleRealDensityFixtures } = await import("../e2e/helpers/density-runtime-fixture-assembly");
    const ports: Record<string, number> = { publicAndAuth: 3100, accountAndOwn: 3100, pairedFamily: 3100, ownReport: 3100,
      ownCarrier: 3100, cohortEntry: 3100, fileTransfer: 3100, publishedCohort: 3105, unansweredCopilot: 3100,
      jurisdiction: 3100, liveCohort: 3105, withdrawal: 3100, claimProcessing: 3100, statisticalCohort: 3105,
      appealReview: 3102, claimReview: 3100, subjectAccessProcessing: 3102, portrait: 3100, healthPicture: 3100,
      overviewJurisdiction: 3100, remainingCopilot: 3100, finalizedEmbryoEmpty: 3105 };
    expect(Object.keys(ports).sort()).toEqual(
      [...read("scripts/density-owned-capture.ts").matchAll(/(\w+): (31\d\d)/gu)].map(match => match[1]).sort());
    // Source-only composition: stub inputs that throw if any provider tried to
    // run a journey, open a browser or read a service at assembly time.
    const refuse: ProxyHandler<Record<string, unknown>> = { get: (target, key) => key in target ? target[key as string]
      : () => { throw new Error(`assembly must not call ${String(key)}`); } };
    const browser = {};
    const input = Object.fromEntries(Object.entries(ports).map(([name, port]) => [name, new Proxy({ root, register,
      browser, origin: `http://localhost:${port}`, localModelOrigin: "http://localhost:3103" }, refuse)]));
    const fixtures = assembleRealDensityFixtures(input as never);
    const plan = densityCapturePlan(register, fixtures.map(fixture => densityStateKey(fixture.routeId, fixture.state)));
    expect(plan.holds).toEqual([]);
    expect(plan.status).toBe("READY_FOR_ACTUAL_CAPTURE");
    expect(new Set(fixtures.map(fixture => densityStateKey(fixture.routeId, fixture.state))).size).toBe(plan.states.length);
    expect(plan.states).toHaveLength(174);
    expect(plan.requiredCaptureCount).toBe(348);
  }, 60_000);
});
