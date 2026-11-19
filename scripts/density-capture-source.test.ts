import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { densityCapturePlan } from "./density-capture-plan";
import type { DensityRegister } from "./density-current";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
describe("current density preserves the frozen pixel and real state producers", () => {
  it("copies the complete pixel classifier and computation body byte for byte", () => {
    const original = read("scripts/density-baseline/compute.mjs");
    const current = read("scripts/density-current-pixels.mjs");
    const start = "function sha256(buffer) {";
    expect(current.slice(current.indexOf(start), current.indexOf("export { imageMetrics };")))
      .toBe(original.slice(original.indexOf(start), original.indexOf("function routePattern(capturedPath) {")));
  });
  it("uses the original measure/rest module and rechecks PNG bytes, all native facts and current source", () => {
    const driver = read("e2e/helpers/density-current-capture.ts");
    expect(driver).toContain('await import("../../scripts/density-baseline/measure.mjs")');
    expect(driver).toContain("verifyFrozenDensityPixelBody(root, contract.capture.artifacts.measurementHarness.sha256)");
    expect(driver).toContain("const before = checkedDensityStateProof(await session.observe(), expected)");
    expect(driver).toContain("const after = checkedDensityStateProof(await session.observe(), expected)");
    expect(driver).toContain("JSON.stringify(before) === JSON.stringify(after)");
    expect(driver).toContain("sha256(publicBytes(screenshotPath)) === sha256(screenshot)");
    expect(driver).toContain("if (plan.holds.length)");
    expect(driver.indexOf("if (plan.holds.length)")).toBeLessThan(driver.indexOf("await observeService()"));
    expect(driver).toContain("g2_5Acceptance: false");
    expect(driver).toContain("page.context().browser() === options.browser");
    expect(driver).toContain("navigation.origin === runtime.appOrigin");
    expect(driver).toContain("const serviceOrigin = fixture.serviceOrigin");
    expect(driver).toContain("fixtureSourceSha256: fixture.sourceSha256, observeRuntime: options.observeRuntime, readActualAppEnvironment");
    expect(driver).toContain("assertDensityServiceUnchanged(serviceBinding, await observeService())");
    expect(driver).toContain("await assertCaptureBookend()");
    expect(driver).toContain("HOLD_CURRENT_DENSITY_SERVICE_BINDINGS");
    expect(driver).not.toContain("options.observeRuntime()");
    expect(driver.indexOf("await fixture.withState")).toBeLessThan(driver.indexOf("const serviceBinding = await observeService()"));
    expect(driver.indexOf("const serviceBinding = await observeService()")).toBeLessThan(driver.indexOf("const before = checkedDensityStateProof"));
  });
  it("uses genuine existing auth/session and legal URL helpers without synthetic responses or HTML", () => {
    const fixtures = read("e2e/helpers/density-real-state-fixtures.ts");
    expect(fixtures).toContain('import { createConfirmedUser } from "../helpers"');
    expect(fixtures).toContain('import { DOCUMENTS } from "../accessibility-sweeps"');
    expect(fixtures).toContain("await createConfirmedUser(address, password)");
    // A reset session comes only from the real mailed recovery link (owner decision 2026-10-16).
    expect(fixtures).toContain("const recovery = await latestEmailTo(address)");
    expect(fixtures).toContain('assert(link, "Actual original recovery mail required")');
    expect(fixtures).toContain("await page.waitForURL(/\\/auth\\/reset-password$/u)");
    expect(fixtures).toContain("await request.continue()");
    expect(fixtures).toContain("const response = await request.request().response()");
    expect(fixtures).toContain("await response.finished() === null");
    expect(fixtures).toContain("await continuation");
    expect(fixtures).not.toMatch(/\.fulfill\(|\.abort\(|\.setContent\(|\.addInitScript\(/u);
    expect(fixtures).not.toMatch(/\.from\([^)]*\)\.(?:insert|update)\(/u);
  });
  it("keeps both fixed viewports, complete-source selection and 44px targets independent of ink budgets", () => {
    const plan = read("scripts/density-capture-plan.ts"), driver = read("e2e/helpers/density-current-capture.ts");
    expect(plan).toContain('{ id: "390x844", width: 390, height: 844 }');
    expect(plan).toContain('{ id: "1280x800", width: 1280, height: 800 }');
    expect(plan).toContain('route.kind === "page"');
    expect(driver).toContain("target.width < 44 || target.height < 44");
    expect(driver).toContain("verifyCurrentDensity(packet, register, contract, source)");
    expect(driver).toContain('key !== "resolvedUrl"');
    expect(driver).toContain("navigationSha256: sha256(navigation.href)");
  });
  it("keeps every real auth initial form separate from held processing and original mailed outcomes", () => {
    const register = JSON.parse(read("docs/route-register.json")) as DensityRegister;
    const rows = densityCapturePlan(register, []).states.filter(row => row.route.id.startsWith("auth."));
    expect(rows.filter(row => row.state === "initial-form").map(row => row.route.id))
      .toEqual(["auth.sign-in", "auth.sign-up", "auth.forgot-password", "auth.reset-password"]);
    expect(rows.filter(row => row.state === "complete").map(row => row.route.id))
      .toEqual(["auth.sign-up", "auth.forgot-password"]);
    const provider = read("e2e/helpers/density-real-state-fixtures.ts");
    for (const text of ['route.path === form.path && route.auth === "public"', 'route.stateProfile === "auth-density-flow"',
      '["initial-form", "processing", "complete"].includes(row.state)', 'expect(row.state).toBe("initial-form")',
      'for (const field of await actual.locator("input").all()) await expect(field).toHaveValue("")',
      'authForm && row.state === "complete"', 'reply.request().method() === "POST"',
      '"/api/auth/sign-up" : "/api/auth/forgot-password"', 'expect(reply.ok()).toBe(true)', 'expect(await reply.finished()).toBeNull()',
      'form.endpoint ? `**${form.endpoint}` : "**/auth/v1/**"',
      'const mail = await latestEmailTo(address)', 'Actual original auth mail required', 'Actual auth receipt mail changed',
      'await capture({ page, observe }); await observe()']) expect(provider).toContain(text);
    const outcome = provider.slice(provider.indexOf('} else if (authForm && row.state === "complete")'),
      provider.indexOf('} else {\n            const navigation', provider.indexOf('} else if (authForm && row.state === "complete")')));
    expect(outcome).not.toMatch(/\.fulfill\(|\.abort\(|\.setContent\(|\.addInitScript\(|\.from\([^)]*\)\.(?:insert|update)\(/u);
    const verifier = read("scripts/density-current.ts");
    expect(verifier).toContain('row.state === "initial-form"');
    expect(verifier).not.toContain('row.state === "complete" && baseline?.state === "empty"');
  });
  it("captures only the registered fixed public embryo refusal without inventing a country or account", () => {
    const register = JSON.parse(read("docs/route-register.json")) as DensityRegister;
    const rows = densityCapturePlan(register, []).states.filter(row => row.route.id === "marketing.embryo-analysis");
    expect(rows.map(row => row.state)).toEqual(["jurisdiction-unavailable"]);
    const source = read("e2e/helpers/density-real-state-fixtures.ts");
    for (const text of ['route.id === "marketing.embryo-analysis" && route.path === "/embryo-analysis"',
      'route.auth === "public" && route.stateProfile === "public-embryo-analysis"',
      'row.state === "jurisdiction-unavailable"', '!publicDocument && !authForm && !embryoUnavailable'])
      expect(source).toContain(text);
    const refusal = source.slice(source.indexOf("if (embryoUnavailable) {"), source.indexOf("if (authForm) {", source.indexOf("if (embryoUnavailable) {")));
    expect(refusal).not.toMatch(/createConfirmedUser|signIn\(|\.request\.(?:post|patch)|\.from\(|process\.env|\.route\(/u);
    expect(refusal).toContain('main form, main [data-figure-kind], main [data-personal-preview]');
  });
  it("retains every whole public refusal and Future Person paragraph rather than substituting a short state label", () => {
    const fixture = read("e2e/helpers/density-real-state-fixtures.ts");
    const page = read("src/app/(marketing)/embryo-analysis/page.tsx").replace(/\s+/g, " ");
    for (const text of [
      "Inherit can explain supported findings on non-sex chromosomes. It does not rank embryos, suggest which embryo to transfer, predict sex, or guess when data is missing.",
      "Embryo tools need a review by a legal expert and a list of approved conditions. Neither is ready, so these tools stay off on the hosted service.",
      "Embryo scores that add up many small effects are for research only. Inherit will not offer them as a service.",
      "The record belongs to the future person. They retain rights to know, not know, correct, export, restrict analysis, and delete it.",
    ]) { expect(page).toContain(text); expect(fixture).toContain(text); }
    for (const text of ["Not available in any production jurisdiction yet", "If a child is born from this",
      "Read the Future Person Charter", "Open Inherit"]) {
      expect(page).toContain(text); expect(fixture).toContain(text);
    }
  });
});
