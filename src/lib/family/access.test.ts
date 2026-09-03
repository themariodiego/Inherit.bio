import { describe, expect, it } from "vitest";
import {
  LAYER_PURPOSES,
  familyCapability,
  grantedLayers,
  hasReportGrant,
  liveGrantsToViewer,
  permits,
  personCapability,
  viewerMaySee,
} from "./access";
import type { FamilyPerson, Purpose } from "./graph";

/**
 * Access is two independent answers (design §1.4): the jurisdiction decision
 * across every contributing account, and the live directional grants a pause
 * suspends.
 */

const VIEWER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COUNTERPART = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SELF_B = "22222222-2222-4222-8222-222222222222";
const HANDLE = "33333333-3333-4333-8333-333333333333";

function person(overrides: Partial<FamilyPerson> = {}): FamilyPerson {
  return {
    handle: {
      id: HANDLE,
      displayLabel: "Invited adult",
      subjectClass: "other_adult",
      lifecycle: "active",
      lifecycleRevision: 1,
      routeSegment: `s-${HANDLE}`,
      ownerAccountId: null,
      subjectAccountId: COUNTERPART,
      dataSubjectId: SELF_B,
    },
    dataSubjectId: SELF_B,
    counterpartAccountId: COUNTERPART,
    displayLabel: "Bo",
    origin: "invited-by-me",
    sharing: "active",
    grantsToViewer: new Set<Purpose>(),
    grantsFromViewer: new Set<Purpose>(),
    ...overrides,
  };
}

/** A reader that answers with declared codes and never touches a database. */
function codes(map: Record<string, string | null>) {
  return async (accountIds: readonly string[]) =>
    new Map(accountIds.map((id) => [id, map[id] ?? null]));
}

describe("family access", () => {
  it("reads the TEST-LOCAL row only under the acceptance flag", async () => {
    const permitted = await familyCapability(VIEWER, [COUNTERPART], "third_party_adult_analysis", {
      testJurisdiction: true,
      readJurisdictionCodes: codes({}),
    });
    expect(permitted.status).toBe("permitted");
    expect(permitted.jurisdictionCode).toBe("TEST-LOCAL");
    expect(permits(permitted)).toBe(true);

    const production = await familyCapability(VIEWER, [COUNTERPART], "third_party_adult_analysis", {
      testJurisdiction: false,
      readJurisdictionCodes: codes({}),
    });
    expect(production.status).toBe("unreviewed");
    expect(permits(production)).toBe(false);
  });

  it("reads an unset jurisdiction as unreviewed and never as permitted", async () => {
    const decision = await personCapability(VIEWER, person(), "family_heritability", {
      testJurisdiction: false,
      readJurisdictionCodes: codes({ [VIEWER]: null, [COUNTERPART]: null }),
    });
    expect(decision.status).toBe("unreviewed");
    expect(decision.source).toBe("unset");
    expect(decision.userFacingCopy.length).toBeGreaterThan(0);
  });

  it("blocks a permitted actor whose contributor is unreviewed (G5.1b)", async () => {
    const decision = await familyCapability(VIEWER, [COUNTERPART], "third_party_adult_analysis", {
      testJurisdiction: false,
      readJurisdictionCodes: codes({ [VIEWER]: "GB", [COUNTERPART]: null }),
    });
    expect(decision.status).not.toBe("permitted");
  });

  it("suspends every grant while sharing is paused, without changing the rows", () => {
    const shared = person({ grantsToViewer: new Set<Purpose>(["reports.polygenic"]) });
    expect(viewerMaySee(shared, "reports.polygenic")).toBe(true);
    expect(hasReportGrant(shared)).toBe(true);

    const paused = person({
      sharing: "paused",
      grantsToViewer: new Set<Purpose>(["reports.polygenic"]),
    });
    expect([...liveGrantsToViewer(paused)]).toEqual([]);
    expect(viewerMaySee(paused, "reports.polygenic")).toBe(false);
    expect(hasReportGrant(paused)).toBe(false);
    expect([...paused.grantsToViewer]).toEqual(["reports.polygenic"]);
  });

  it("maps each report layer to exactly one purpose, and shows only granted layers", () => {
    expect(LAYER_PURPOSES).toEqual({
      variant_call: "reports.monogenic",
      estimate: "reports.polygenic",
    });
    expect(grantedLayers(person({ grantsToViewer: new Set<Purpose>(["reports.monogenic"]) }))).toEqual([
      "variant_call",
    ]);
    expect(
      grantedLayers(
        person({
          grantsToViewer: new Set<Purpose>(["reports.monogenic", "reports.polygenic", "ancestry"]),
        }),
      ),
    ).toEqual(["variant_call", "estimate"]);
    expect(grantedLayers(person())).toEqual([]);
  });

  it("never reads the other direction as permission to see", () => {
    const outbound = person({ grantsFromViewer: new Set<Purpose>(["reports.polygenic"]) });
    expect(viewerMaySee(outbound, "reports.polygenic")).toBe(false);
  });
});
