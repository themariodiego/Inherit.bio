import { describe, expect, it } from "vitest";
import {
  EMBRYO_ANALYSIS,
  RESULT_LAYER_CAPABILITIES,
  analysisConsent,
  cohortCapability,
  embryoCapability,
  permits,
  resolveResultSurfaceState,
} from "./access";
import type { EmbryoCohortView } from "./cohorts";
import type { CapabilityDecision } from "./access";

/**
 * Access is two independent answers (design §1.4): the jurisdiction across
 * every required upload principal, and the live analysis grants; then the
 * one order of states a result surface renders in.
 */

const VIEWER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PARENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function codes(map: Record<string, string | null>) {
  return async (accountIds: readonly string[]) => new Map(accountIds.map((id) => [id, map[id] ?? null]));
}

function cohort(overrides: Partial<EmbryoCohortView> = {}): EmbryoCohortView {
  return {
    id: "0c000000-0000-4000-8000-000000000001",
    status: "active",
    createdAt: "2026-09-01T00:00:00.000Z",
    embryoCount: 2,
    viewerRole: "required_upload_principal",
    requiredUploadPrincipalAccountIds: [VIEWER, PARENT],
    requiredUploadPrincipalsWithoutAccount: 0,
    analysisGranted: true,
    viewerAnalysisGranted: true,
    embryos: [],
    retentionExpiresAt: "2028-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function decision(status: CapabilityDecision["status"]): CapabilityDecision {
  return { capability: "embryo_analysis", status, userFacingCopy: "copy", jurisdictionCode: null, source: "unset" };
}

describe("embryo access", () => {
  it("guards every route with embryo_analysis and the layers with their own capabilities", () => {
    expect(EMBRYO_ANALYSIS).toBe("embryo_analysis");
    expect(RESULT_LAYER_CAPABILITIES["single-locus"]).toEqual(["embryo_analysis", "embryo_single_locus"]);
    expect(RESULT_LAYER_CAPABILITIES["statistical-estimate"]).toEqual(["embryo_analysis", "embryo_statistical_estimate"]);
    expect(RESULT_LAYER_CAPABILITIES["carrier-match"]).toEqual(["embryo_analysis", "embryo_single_locus", "carrier_match"]);
  });

  it("reads the TEST-LOCAL row only under the acceptance flag", async () => {
    const permitted = await embryoCapability(VIEWER, [PARENT], EMBRYO_ANALYSIS, { testJurisdiction: true, readJurisdictionCodes: codes({}) });
    expect(permitted.status).toBe("permitted");
    expect(permitted.jurisdictionCode).toBe("TEST-LOCAL");
    const production = await embryoCapability(VIEWER, [PARENT], EMBRYO_ANALYSIS, { testJurisdiction: false, readJurisdictionCodes: codes({}) });
    expect(production.status).toBe("unreviewed");
    expect(permits(production)).toBe(false);
    expect(production.userFacingCopy.length).toBeGreaterThan(0);
  });

  it("blocks a permitted actor whose co-parent is unreviewed (G5.1b)", async () => {
    const result = await cohortCapability(VIEWER, cohort(), EMBRYO_ANALYSIS, {
      testJurisdiction: false,
      readJurisdictionCodes: codes({ [VIEWER]: "GB", [PARENT]: null }),
    });
    expect(result.status).not.toBe("permitted");
  });

  it("reads a required upload principal without an account as unreviewed, even under the flag", async () => {
    const result = await cohortCapability(
      VIEWER,
      cohort({ requiredUploadPrincipalAccountIds: [VIEWER], requiredUploadPrincipalsWithoutAccount: 1 }),
      EMBRYO_ANALYSIS,
      { testJurisdiction: true, readJurisdictionCodes: codes({}) },
    );
    expect(result.status).toBe("unreviewed");
    expect(result.source).toBe("unset");
    expect(result.userFacingCopy).toBe("This part of Inherit is not available here because its legal review is not complete.");
    const complete = await cohortCapability(VIEWER, cohort(), EMBRYO_ANALYSIS, { testJurisdiction: true, readJurisdictionCodes: codes({}) });
    expect(complete.status).toBe("permitted");
  });

  it("says whose grant is missing without naming anyone", () => {
    expect(analysisConsent(cohort())).toBe("granted");
    expect(analysisConsent(cohort({ analysisGranted: false, viewerAnalysisGranted: false }))).toBe("waiting-for-you");
    expect(analysisConsent(cohort({ analysisGranted: false, viewerAnalysisGranted: true }))).toBe("waiting-for-other");
    expect(analysisConsent(cohort({ analysisGranted: false, viewerAnalysisGranted: null }))).toBe("waiting-for-other");
  });

  it("renders the states in one order: jurisdiction, empty, processing, consent, gate, complete", () => {
    const permitted = decision("permitted");
    expect(resolveResultSurfaceState({ decision: decision("unreviewed"), cohort: cohort(), acknowledged: true })).toBe("jurisdiction-unavailable");
    expect(resolveResultSurfaceState({ decision: permitted, cohort: null, acknowledged: true })).toBe("empty");
    expect(resolveResultSurfaceState({ decision: permitted, cohort: cohort({ status: "ingesting", analysisGranted: false }), acknowledged: false })).toBe("processing");
    expect(resolveResultSurfaceState({ decision: permitted, cohort: cohort(), embryoStatus: "pending", acknowledged: false })).toBe("processing");
    expect(resolveResultSurfaceState({ decision: permitted, cohort: cohort({ status: "upload_pending", analysisGranted: false }), acknowledged: false })).toBe("empty");
    expect(resolveResultSurfaceState({ decision: permitted, cohort: cohort({ analysisGranted: false }), acknowledged: true })).toBe("consent-required");
    expect(resolveResultSurfaceState({ decision: permitted, cohort: cohort(), acknowledged: false })).toBe("gated");
    expect(resolveResultSurfaceState({ decision: permitted, cohort: cohort(), embryoStatus: "qc_fail", acknowledged: true })).toBe("complete");
  });
});
