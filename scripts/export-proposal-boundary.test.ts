import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { verifyExportProposalBoundary } from "./export-proposal-boundary";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const active = "docs/export-member-plan.json";
const proposal = "docs/proposals/requester-statement-export-member-plan.json";
const metadata = "docs/proposals/requester-statement-export-member-plan.provenance.json";
const consumer = "src/lib/export/member-plan.ts";
const owned: string[] = [];

function fixture(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "inherit-proposal-boundary-"));
  owned.push(root);
  for (const file of [active, proposal, metadata, consumer]) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), readFileSync(path.join(repository, file)));
  }
  return root;
}
function plant(root: string, file: string, body: string): void {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), body);
}

afterEach(() => { for (const root of owned.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("inert export proposal and current contract boundary", () => {
  it("checks whole artifact provenance and the actual production source graph", () => {
    const result = verifyExportProposalBoundary(repository);
    expect(result.productionSources).toBeGreaterThan(1);
    expect(result.computedImports).toBe(1);
  });
  it("refuses a changed proposal even while the active file is unchanged", () => {
    const root = fixture();
    writeFileSync(path.join(root, proposal), readFileSync(path.join(root, proposal), "utf8") + "\n");
    expect(() => verifyExportProposalBoundary(root)).toThrow("Export artifact provenance differs");
    expect(readFileSync(path.join(root, active))).toEqual(readFileSync(path.join(repository, active)));
  });
  it("refuses a changed active plan even while the inert proposal is unchanged", () => {
    const root = fixture();
    writeFileSync(path.join(root, active), readFileSync(path.join(root, active), "utf8") + "\n");
    expect(() => verifyExportProposalBoundary(root)).toThrow("Export artifact provenance differs");
    expect(readFileSync(path.join(root, proposal))).toEqual(readFileSync(path.join(repository, proposal)));
  });
  it("refuses a real production re-export of future data", () => {
    const root = fixture();
    plant(root, "src/promotion.ts", "export { default } from '../docs/proposals/requester-statement-export-member-plan.json';\n");
    expect(() => verifyExportProposalBoundary(root)).toThrow("Application reaches the unbound export proposal");
  });
  it("refuses a flag-dependent future import without evaluating the flag", () => {
    const root = fixture();
    plant(root, "src/promotion.ts", "export async function load(flag: boolean) { if (flag) return import('../docs/proposals/requester-statement-export-member-plan.json'); }\n");
    expect(() => verifyExportProposalBoundary(root)).toThrow("Application reaches the unbound export proposal");
  });
  it("refuses an unreviewed computed runtime import", () => {
    const root = fixture();
    plant(root, "src/promotion.ts", "export async function load(moduleUrl: string) { return import(moduleUrl); }\n");
    expect(() => verifyExportProposalBoundary(root)).toThrow("Unreviewed computed application import");
  });
  it("refuses a flag-dependent filesystem read of the future file", () => {
    const root = fixture();
    plant(root, "src/promotion.ts", "import { readFileSync } from 'node:fs'; export function load(flag: boolean) { if (flag) return readFileSync(new URL('../docs/proposals/requester-statement-export-member-plan.json', import.meta.url)); }\n");
    expect(() => verifyExportProposalBoundary(root)).toThrow("Application reaches the unbound export proposal");
  });
  it("refuses a flag selecting unproven data in the real current consumer", () => {
    const root = fixture();
    const original = readFileSync(path.join(root, consumer), "utf8");
    const changed = original.replace("parseExportMemberPlan(plan);", "parseExportMemberPlan(process.env.INHERIT_REQUESTER_STATEMENTS_TEST === '1' ? JSON.parse('{}') : plan);");
    expect(changed).not.toBe(original);
    writeFileSync(path.join(root, consumer), changed);
    expect(() => verifyExportProposalBoundary(root)).toThrow("A flag or alternate source must not select the active export plan");
  });
  it("permits a test-only proposal reader while production retains its fixed source", () => {
    const root = fixture();
    plant(root, "src/proposal.test.ts", "import proposal from '../docs/proposals/requester-statement-export-member-plan.json'; export default proposal;\n");
    expect(verifyExportProposalBoundary(root)).toEqual({ productionSources: 1, computedImports: 0 });
  });
});
