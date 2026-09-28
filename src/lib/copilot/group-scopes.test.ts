import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { COPY_IDS } from "@/copy/copilot/group-scopes";
import { COPILOT_LOCAL_ONLY } from "@/copy/family/person";
import { cohortScopeSegment, copilotGroupScopes, parseCopilotRouteScope } from "./group-scopes";

const register = JSON.parse(fs.readFileSync(path.join(process.cwd(), "docs/route-register.json"), "utf8"));
const uuid = "0b7c3f5e-1d2a-4c3b-8a9d-0e1f2a3b4c5d";

describe("copilot-route-scope-v1", () => {
  it("parses exactly the register's single-segment grammar", () => {
    const grammar = register.policyResolvers["copilot-route-scope-v1"].singleSegmentGrammar;
    expect(parseCopilotRouteScope(grammar.self.const)).toEqual({ kind: "self" });
    expect(parseCopilotRouteScope(grammar.family.const)).toEqual({ kind: "family" });
    expect(parseCopilotRouteScope(`s-${uuid}`)).toEqual({ kind: "subject", id: uuid });
    expect(parseCopilotRouteScope(`c-${uuid}`)).toEqual({ kind: "cohort", id: uuid });
    expect(parseCopilotRouteScope(`r-${uuid}`)).toEqual({ kind: "report", id: uuid });
    expect(register.policyResolvers["copilot-route-scope-v1"].scopeKinds.sort())
      .toEqual(["cohort", "family", "report", "self", "subject"]);
  });

  it.each([
    "Family", "families", "family/", "me ", "", `c-${uuid.toUpperCase()}`, `c-{${uuid}}`, `x-${uuid}`, `c-${uuid}x`,
    "c-0b7c3f5e1d2a4c3b8a9d0e1f2a3b4c5d", "c-0b7c3f5e-1d2a-6c3b-8a9d-0e1f2a3b4c5d", `s-${uuid}%2F`, "..", "c-..", `s-c-${uuid}`,
  ])("refuses %j", (segment) => {
    expect(parseCopilotRouteScope(segment)).toBeNull();
  });

  it("names a cohort in the register's prefix form, never as a bare id", () => {
    expect(cohortScopeSegment(uuid)).toBe(`c-${uuid}`);
    expect(parseCopilotRouteScope(cohortScopeSegment(uuid))).toEqual({ kind: "cohort", id: uuid });
  });
});

describe("group scope availability", () => {
  // The owner turned the Family scope on everywhere on 2026-09-28 (PR #260).
  // Whether it can RUN is the transport's and the jurisdiction's question,
  // never this flag's, so the answer must not follow the TEST-LOCAL flag or
  // any deployment variable. The cohort scope is built under the TEST-LOCAL
  // acceptance row only (2026-09-28), and exactly the value "1" turns it on.
  it("builds the Family scope on every deployment, and the cohort scope under TEST-LOCAL only", () => {
    for (const [env, cohort] of [
      [{ INHERIT_TEST_JURISDICTION: "1" }, true],
      [{ INHERIT_TEST_JURISDICTION: "" }, false],
      [{ INHERIT_TEST_JURISDICTION: "true" }, false],
      [{ INHERIT_TEST_JURISDICTION: "", VERCEL: "1", VERCEL_ENV: "production" }, false],
    ] as const) {
      vi.unstubAllEnvs();
      for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
      expect(copilotGroupScopes(), JSON.stringify(env)).toEqual({ family: true, cohort });
    }
    vi.unstubAllEnvs();
  });
});

describe("the true non-self unavailable page", () => {
  it("resolves exactly the copy ids the register's closed projection names, and nothing else", () => {
    const projection = register.policyResolvers["copilot-transport-availability-v1"].cases["true-non-self"].unavailablePageProjection;
    const ids = [projection.headingCopyId.const, projection.plainLanguageReasonCopyId.const,
      projection.localDeploymentRequirementCopyId.const, projection.backAction.labelCopyId.const];
    expect(Object.keys(COPY_IDS).sort()).toEqual([...ids].sort());
    expect(projection.backAction.routeId.const).toBe("app.overview");
    for (const id of ids) expect(COPY_IDS[id as keyof typeof COPY_IDS].length).toBeGreaterThan(0);
  });

  it("gives the reason in the brief's own permanent sentence", () => {
    expect(COPY_IDS["copilot.transport.local-unavailable.reason"]).toBe(COPILOT_LOCAL_ONLY);
  });

  it("is also the register's closed copilotCohortUnavailablePage, field for field", () => {
    const projection = register.policyResolvers["copilot-transport-availability-v1"].cases["true-non-self"].unavailablePageProjection;
    const cohort = register.policyContracts["embryo-autosomal-only-v1"].closedShapes.copilotCohortUnavailablePage;
    expect([...cohort.keys].sort()).toEqual([...projection.closedFields].sort());
    expect(cohort.findingRule).toBe("zero-EmbryoFinding-members-and-no-embryo-result-value");
    const back = register.policyContracts["embryo-autosomal-only-v1"].closedShapes.copilotBackAction.scalarConstraints;
    expect(back.labelCopyId.const).toBe(projection.backAction.labelCopyId.const);
    expect(back.routeId.const).toBe(projection.backAction.routeId.const);
  });
});
