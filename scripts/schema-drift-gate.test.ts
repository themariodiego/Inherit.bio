import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { driftFindings, expectedNames, operatorApplied } from "./schema-drift-gate";

/**
 * D-106's regression test. The outage was a database twelve migrations behind
 * the code deployed against it, and the reason nobody saw it is that every
 * existing check looked at one side only. These fixtures drive the comparison
 * directly, so the logic is proven without a database.
 */

const A = "own_upload_finalization_checkpoints";
const B = "own_upload_finalization_resume";
const C = "adult_subject_session_response";
const OPERATOR = "install_own_report_retention_scheduler";

describe("schema drift between the repository and a deployed database", () => {
  it("passes when both sides hold the same migrations", () => {
    expect(driftFindings([A, B, C], [A, B, C])).toEqual([]);
  });

  it("reports exactly what a deployment is behind by", () => {
    // The real shape of D-106: the code is out, the schema is not.
    const findings = driftFindings([A, B, C], [A]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("BEHIND by 2");
    expect(findings[0]).toContain(B);
    expect(findings[0]).toContain(C);
  });

  it("reports a deployment carrying a migration the repository cannot account for", () => {
    const findings = driftFindings([A], [A, B]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("cannot account for");
    expect(findings[0]).toContain(B);
  });

  it("accepts a recorded operator installation, and only a recorded one", () => {
    expect(driftFindings([A], [A, OPERATOR], [OPERATOR])).toEqual([]);
    expect(driftFindings([A], [A, OPERATOR], [])).toHaveLength(1);
  });

  it("reports an exemption the deployment does not actually have", () => {
    // A stale exemption is how a real extra migration hides later.
    const findings = driftFindings([A], [A], [OPERATOR]);
    expect(findings).toEqual([
      `data/gates/operator-applied-migrations.json exempts a migration the deployment does not have: ${OPERATOR}`,
    ]);
  });

  it("reports both directions at once rather than stopping at the first", () => {
    expect(driftFindings([A, C], [A, B])).toHaveLength(2);
  });

  it("refuses to pass when it read no migrations at all", () => {
    // A reader that silently found nothing must not read as a clean
    // deployment; that is how an empty check looks exactly like a healthy one.
    expect(driftFindings([], [])).toEqual([
      "no migration files were read from supabase/migrations",
    ]);
  });

  it("reads this repository's own migrations by name, unique and ordered", () => {
    const names = expectedNames(path.resolve("."));
    expect(names.length).toBeGreaterThan(90);
    expect(names).toEqual([...names].sort());
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain(A);
  });

  it("reads the operator allowlist, and every entry says why", () => {
    const root = path.resolve(".");
    expect(operatorApplied(root)).toContain(OPERATOR);
    // The allowlist must never grow a bare name: an exemption without a stated
    // reason is indistinguishable from one added to silence the gate.
    const file = JSON.parse(
      readFileSync(path.join(root, "data/gates/operator-applied-migrations.json"), "utf8"),
    ) as { migrations: { name: string; why: string }[] };
    for (const entry of file.migrations) {
      expect(typeof entry.why).toBe("string");
      expect(entry.why.length).toBeGreaterThan(80);
    }
  });
});
