import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { densityCapturePlan, densityStateKey } from "./density-capture-plan";
import { FILE_TRANSFER_DENSITY_STATES, fileTransferDensityRecipe } from "./density-file-transfer-states";
import { ownedDensityRecipe } from "./density-owned-states";
import { cohortEntryDensityRecipe } from "./density-cohort-entry-states";
import type { DensityRegister } from "./density-current";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) => readFileSync(path.join(root, name), "utf8");
const register = JSON.parse(read("docs/route-register.json")) as DensityRegister;
const states = densityCapturePlan(register, []).states;
describe("real file-transfer density capture", () => {
  it("adds three actual registered pairs without replacing consent or chooser entry", () => {
    const declared = Object.entries(FILE_TRANSFER_DENSITY_STATES).flatMap(([id, rows]) => Object.keys(rows)
      .map(state => densityStateKey(id, state)));
    const actual = states.filter(fileTransferDensityRecipe);
    expect(actual).toHaveLength(3);
    expect(new Set(actual.map(row => densityStateKey(row.route.id, row.state)))).toEqual(new Set(declared));
    expect(actual.every(row => !ownedDensityRecipe(row) && !cohortEntryDensityRecipe(row))).toBe(true);
    const upload = states.find(row => row.route.id === "files.upload")!;
    expect(fileTransferDensityRecipe({ ...upload, state: "consent-required" })).toBeNull();
    expect(fileTransferDensityRecipe({ ...upload, route: { ...upload.route, id: "composition.new-upload" } })).toBeNull();
  });
  it("holds and settles exactly the original preparation request in the same uploader", () => {
    const source = read("e2e/helpers/density-file-transfer-state-fixtures.ts");
    for (const text of ["await createConfirmedUser(email, password)", "await signIn(page, email, password)",
      "await completeOwnUploadConsent(page, row.route.path)", "setInputFiles", 'route.request().method() === "POST" && ++intercepted === 1',
      "await held; await route.continue()", "await response.finished() === null", "if (continuation) await continuation"])
      expect(source).toContain(text);
    expect(source).not.toMatch(/\.fulfill\(|\.abort\(|\.setContent\(|\.addInitScript\(|\.listen\(/u);
    expect(source).not.toMatch(/\.from\([^)]*\)\.(?:insert|update|upsert)\(/u);
  });
  it("requires the native current receipt and exact pending versus prepared outcome", () => {
    const source = read("e2e/helpers/density-file-transfer-state-fixtures.ts");
    for (const text of ['select("*", { count: "exact" })', "expect(result.data!.length).toBe(result.count)",
      "expect(completed).toBe(false)", "expect(completed).toBe(true)", 'expect(file.status).toBe("uploaded")',
      'expect(file.status).toBe("stored")', "expect(file.normalization_source_revision).toBe(file.upload_revision)",
      'expect(facts[table]).toEqual([])', "return input.observeState(row, page, sourceSha256,"])
      expect(source).toContain(text);
  });
  it("retains live-region disability, refresh persistence, privacy and no generated report", () => {
    const source = read("e2e/helpers/density-file-transfer-state-fixtures.ts");
    for (const text of ['[data-slot="upload-progress"][aria-live="polite"]', "toBeDisabled()", "toContainText(PREPARED)",
      'main ul', 'a[href$="/download"]', "Choose your reports", "View your file", 'not.toContain("tiny-grch38.vcf")',
      'page.locator(\'[data-figure-kind]\')).toHaveCount(0)']) expect(source).toContain(text);
  });
});
