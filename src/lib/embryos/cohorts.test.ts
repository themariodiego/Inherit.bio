import { describe, expect, it } from "vitest";
import {
  buildCohortViews,
  isCanonicalId,
  selectCohort,
  selectEmbryo,
  type CohortGraphRows,
  type CohortRow,
} from "./cohorts";

/**
 * The cohort graph over row fixtures (design §1.3, §6.1): the co-parent is
 * listed through the participant set, a donor-only principal is excluded, a
 * restricted cohort resolves to null for every account, embryos follow the
 * ordinal, and the absent-query rule picks the newest cohort.
 */

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PA = "11111111-1111-4111-8111-111111111111";
const PB = "22222222-2222-4222-8222-222222222222";
const PD = "33333333-3333-4333-8333-333333333333";
const PN = "44444444-4444-4444-8444-444444444444";
const C1 = "0c000000-0000-4000-8000-000000000001";
const C2 = "0c000000-0000-4000-8000-000000000002";
const C3 = "0c000000-0000-4000-8000-000000000003";
const E = (n: number) => `0e000000-0000-4000-8000-00000000000${n}`;
const S = (n: number) => `05000000-0000-4000-8000-00000000000${n}`;

function cohort(overrides: Partial<CohortRow> & { id: string }): CohortRow {
  return {
    owner_account_id: A,
    upload_class: "embryo_own",
    status: "active",
    embryo_count: 3,
    created_at: "2026-09-01T00:00:00.000Z",
    retention_expires_at: "2028-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function rows(viewer: string, overrides: Partial<CohortGraphRows> = {}): CohortGraphRows {
  return {
    viewerAccountId: viewer,
    viewerPrincipalIds: viewer === A ? [PA] : viewer === B ? [PB] : viewer === D ? [PD] : [],
    cohorts: [cohort({ id: C1 })],
    requiredUploadPrincipals: [
      { cohort_id: C1, principal_id: PA },
      { cohort_id: C1, principal_id: PB },
    ],
    principals: [
      { id: PA, account_id: A },
      { id: PB, account_id: B },
      { id: PD, account_id: D },
      { id: PN, account_id: null },
    ],
    embryos: [
      { id: E(2), cohort_id: C1, subject_id: S(2), sample_ordinal: 1, display_label: "Embryo 2", status: "qc_fail" },
      { id: E(3), cohort_id: C1, subject_id: S(3), sample_ordinal: 2, display_label: "Embryo 3", status: "qc_pass" },
      { id: E(1), cohort_id: C1, subject_id: S(1), sample_ordinal: 0, display_label: null, status: "qc_marginal" },
    ],
    analysisGrants: [],
    ...overrides,
  };
}

describe("cohort graph", () => {
  it("lists the cohort for the uploader and for the co-parent through the participant set", () => {
    for (const viewer of [A, B]) {
      const [view, ...rest] = buildCohortViews(rows(viewer));
      expect(rest).toEqual([]);
      expect(view.id).toBe(C1);
      expect(view.viewerRole).toBe("required_upload_principal");
      expect(view.requiredUploadPrincipalAccountIds.sort()).toEqual([A, B].sort());
      expect(view.requiredUploadPrincipalsWithoutAccount).toBe(0);
      expect(view.analysisGranted).toBe(false);
      expect(view.viewerAnalysisGranted).toBe(false);
      expect(view.embryoCount).toBe(3);
    }
  });

  it("orders embryos by ordinal alone and derives a missing label from the ordinal", () => {
    const [view] = buildCohortViews(rows(A));
    expect(view.embryos.map((embryo) => embryo.sampleOrdinal)).toEqual([0, 1, 2]);
    expect(view.embryos.map((embryo) => embryo.displayLabel)).toEqual(["Embryo 1", "Embryo 2", "Embryo 3"]);
    expect(view.embryos.map((embryo) => embryo.status)).toEqual(["qc_marginal", "qc_fail", "qc_pass"]);
    expect(view.embryos[0].subjectId).toBe(S(1));
  });

  it("excludes a donor-only principal, an unrelated account and a non-parent owner of an own-embryo cohort", () => {
    expect(buildCohortViews(rows(D))).toEqual([]);
    expect(buildCohortViews(rows("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"))).toEqual([]);
    // The owner of an `embryo_own` cohort who is not a required upload principal is not listed either.
    const ownerOnly = rows(A, { requiredUploadPrincipals: [{ cohort_id: C1, principal_id: PB }] });
    expect(buildCohortViews(ownerOnly)).toEqual([]);
  });

  it("lists an embryo_third_party cohort for its non-parent uploader owner, without parent authority", () => {
    const view = buildCohortViews(
      rows(D, {
        cohorts: [cohort({ id: C2, owner_account_id: D, upload_class: "embryo_third_party" })],
        requiredUploadPrincipals: [{ cohort_id: C2, principal_id: PA }, { cohort_id: C2, principal_id: PB }],
        embryos: [],
      }),
    );
    expect(view).toHaveLength(1);
    expect(view[0].viewerRole).toBe("nonparent_uploader_owner");
    expect(view[0].viewerAnalysisGranted).toBeNull();
    expect(view[0].requiredUploadPrincipalAccountIds.sort()).toEqual([A, B].sort());
  });

  it("resolves a restricted, purge-queued or purged cohort to nothing for every account", () => {
    for (const status of ["restricted", "purge_queued", "purged", "claimed_bound"]) {
      for (const viewer of [A, B]) {
        expect(buildCohortViews(rows(viewer, { cohorts: [cohort({ id: C1, status })] })), `${status} ${viewer}`).toEqual([]);
      }
    }
  });

  it("grants analysis only when every required upload principal holds a live grant", () => {
    const one = buildCohortViews(rows(A, { analysisGrants: [{ cohort_id: C1, signer_principal_id: PA }] }))[0];
    expect(one.analysisGranted).toBe(false);
    expect(one.viewerAnalysisGranted).toBe(true);
    const both = buildCohortViews(
      rows(B, { analysisGrants: [{ cohort_id: C1, signer_principal_id: PA }, { cohort_id: C1, signer_principal_id: PB }] }),
    )[0];
    expect(both.analysisGranted).toBe(true);
    expect(both.viewerAnalysisGranted).toBe(true);
  });

  it("counts a required principal without an account, so the jurisdiction reads as unreviewed", () => {
    const view = buildCohortViews(
      rows(A, { requiredUploadPrincipals: [{ cohort_id: C1, principal_id: PA }, { cohort_id: C1, principal_id: PN }] }),
    )[0];
    expect(view.requiredUploadPrincipalAccountIds).toEqual([A]);
    expect(view.requiredUploadPrincipalsWithoutAccount).toBe(1);
  });

  it("applies the absent-query rule: created_at descending, then id ascending", () => {
    const views = buildCohortViews(
      rows(A, {
        cohorts: [
          cohort({ id: C3, created_at: "2026-09-02T00:00:00.000Z" }),
          cohort({ id: C1, created_at: "2026-09-01T00:00:00.000Z" }),
          cohort({ id: C2, created_at: "2026-09-02T00:00:00.000Z" }),
        ],
        requiredUploadPrincipals: [C1, C2, C3].map((cohort_id) => ({ cohort_id, principal_id: PA })),
        embryos: [],
      }),
    );
    expect(views.map((view) => view.id)).toEqual([C2, C3, C1]);
    expect(selectCohort(views, null)?.id).toBe(C2);
    expect(selectCohort(views, C1)?.id).toBe(C1);
    expect(selectCohort(views, "not-a-uuid")).toBeNull();
    expect(selectCohort(views, C1.toUpperCase())).toBeNull();
    expect(selectCohort(views, "0c000000-0000-4000-8000-000000000009")).toBeNull();
    expect(selectCohort([], null)).toBeNull();
  });

  it("resolves an embryo only inside a listed cohort", () => {
    const views = buildCohortViews(rows(A));
    expect(selectEmbryo(views, E(3))?.embryo.displayLabel).toBe("Embryo 3");
    expect(selectEmbryo(views, E(3))?.cohort.id).toBe(C1);
    expect(selectEmbryo(views, "0e000000-0000-4000-8000-000000000009")).toBeNull();
    expect(selectEmbryo(views, "me")).toBeNull();
    expect(selectEmbryo(buildCohortViews(rows(D)), E(3))).toBeNull();
  });

  it("accepts only a canonical lowercase UUID", () => {
    expect(isCanonicalId(C1)).toBe(true);
    expect(isCanonicalId(C1.toUpperCase())).toBe(false);
    expect(isCanonicalId("")).toBe(false);
    expect(isCanonicalId(null)).toBe(false);
    expect(isCanonicalId("s-" + C1)).toBe(false);
  });
});
