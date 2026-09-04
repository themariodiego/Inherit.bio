import "server-only";

import type { Db } from "@/lib/genome/load";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EmbryoStatus } from "./policy";

/**
 * The cohort graph (design §1.3). `listSubjectsForAccount` cannot answer for
 * Embryos: it lists embryo subjects only for the account that owns them, so
 * a co-parent who is a required upload principal but not the owner would see
 * nothing. The graph is read from the participant sets instead.
 *
 * Two sources, joined here:
 *   (a) `embryo_participant_sets` rows of kind `required_upload_principals`
 *       with no `revoked_at`, joined to `subject_principals.account_id` — a
 *       genetic parent who signed the upload basis, on either account;
 *   (b) account-owned `embryo_third_party` cohorts where the actor is the
 *       current non-parent uploader owner (register
 *       `resourceAuthorizationBindings.routes.embryos.index.targetSource`).
 * A donor-subject-only principal, a provider, a reviewer or an unrelated
 * custody owner is excluded.
 *
 * Nothing restricted, queued for purge or purged is listed: a `restricted`
 * cohort resolves to null for every account, the revoker included (brief
 * line 2156). The analysis grant is `purpose_grants ⋈ directional_grants`
 * for `embryo.analysis` on the cohort, one live pair per required upload
 * principal (analysis-eligibility-v1: every required upload principal must
 * have granted it before any result is read).
 *
 * Nothing here ranks or orders embryos by anything but their ordinal.
 */

export const COHORT_STATUSES = [
  "upload_pending",
  "ingesting",
  "active",
  "restricted",
  "purge_queued",
  "purged",
  "claimed_bound",
] as const;
export type CohortStatus = (typeof COHORT_STATUSES)[number];

/** The statuses a parent or uploader may still see listed. */
const LISTABLE_STATUSES = new Set<CohortStatus>(["upload_pending", "ingesting", "active"]);

export type ViewerRole = "required_upload_principal" | "nonparent_uploader_owner";

export interface EmbryoCohortView {
  id: string;
  status: CohortStatus;
  /** The cohort's only safe label: "Embryos added on {date}". */
  createdAt: string;
  embryoCount: number;
  viewerRole: ViewerRole;
  /** Contributors for G5.1b: the accounts of every required upload principal. */
  requiredUploadPrincipalAccountIds: string[];
  /** Required upload principals with no account declare no jurisdiction; the capability then reads as unreviewed. */
  requiredUploadPrincipalsWithoutAccount: number;
  /** A live embryo.analysis grant from every required upload principal. */
  analysisGranted: boolean;
  /** Whether the viewer, as a required upload principal, has granted analysis; null for a non-parent owner. */
  viewerAnalysisGranted: boolean | null;
  /** How many required upload principals have not granted analysis yet. */
  analysisGrantsMissing: number;
  embryos: EmbryoView[];
  retentionExpiresAt: string;
}

export interface EmbryoView {
  id: string;
  subjectId: string;
  sampleOrdinal: number;
  displayLabel: string;
  status: EmbryoStatus;
}

export interface CohortRow {
  id: string;
  owner_account_id: string;
  upload_class: string;
  status: string;
  embryo_count: number;
  created_at: string;
  retention_expires_at: string;
}

export interface ParticipantRow {
  cohort_id: string;
  principal_id: string;
}

export interface PrincipalRow {
  id: string;
  account_id: string | null;
}

export interface EmbryoRow {
  id: string;
  cohort_id: string;
  subject_id: string;
  sample_ordinal: number;
  display_label: string | null;
  status: string;
}

export interface AnalysisGrantRow {
  cohort_id: string;
  signer_principal_id: string;
}

export interface CohortGraphRows {
  viewerAccountId: string;
  /** Every active principal this account holds. */
  viewerPrincipalIds: readonly string[];
  cohorts: readonly CohortRow[];
  /** Current `required_upload_principals` memberships. */
  requiredUploadPrincipals: readonly ParticipantRow[];
  principals: readonly PrincipalRow[];
  embryos: readonly EmbryoRow[];
  analysisGrants: readonly AnalysisGrantRow[];
}

function isCohortStatus(value: string): value is CohortStatus {
  return (COHORT_STATUSES as readonly string[]).includes(value);
}

function isEmbryoStatus(value: string): value is EmbryoStatus {
  return [
    "pending",
    "qc_pass",
    "qc_marginal",
    "qc_fail",
    "excluded",
    "stored",
    "transferred",
    "donated",
    "discarded",
    "claimed_bound",
  ].includes(value);
}

/**
 * The pure half of the graph: plain rows in, cohort views out, so the unit
 * suite proves every branch of §1.3 without a database.
 */
export function buildCohortViews(rows: CohortGraphRows): EmbryoCohortView[] {
  const viewerPrincipals = new Set(rows.viewerPrincipalIds);
  const accountByPrincipal = new Map(rows.principals.map((row) => [row.id, row.account_id]));
  const principalsByCohort = new Map<string, string[]>();
  for (const row of rows.requiredUploadPrincipals) {
    principalsByCohort.set(row.cohort_id, [...(principalsByCohort.get(row.cohort_id) ?? []), row.principal_id]);
  }
  const grantsByCohort = new Map<string, Set<string>>();
  for (const row of rows.analysisGrants) {
    const set = grantsByCohort.get(row.cohort_id) ?? new Set<string>();
    set.add(row.signer_principal_id);
    grantsByCohort.set(row.cohort_id, set);
  }
  const embryosByCohort = new Map<string, EmbryoRow[]>();
  for (const row of rows.embryos) {
    embryosByCohort.set(row.cohort_id, [...(embryosByCohort.get(row.cohort_id) ?? []), row]);
  }

  const views: EmbryoCohortView[] = [];
  for (const cohort of rows.cohorts) {
    if (!isCohortStatus(cohort.status) || !LISTABLE_STATUSES.has(cohort.status)) continue;
    const required = principalsByCohort.get(cohort.id) ?? [];
    const viewerRequired = required.filter((principal) => viewerPrincipals.has(principal));
    let viewerRole: ViewerRole;
    if (viewerRequired.length > 0) {
      viewerRole = "required_upload_principal";
    } else if (
      cohort.owner_account_id === rows.viewerAccountId &&
      cohort.upload_class === "embryo_third_party"
    ) {
      viewerRole = "nonparent_uploader_owner";
    } else {
      continue;
    }
    const grants = grantsByCohort.get(cohort.id) ?? new Set<string>();
    const accountIds = new Set<string>();
    let withoutAccount = 0;
    for (const principal of required) {
      const account = accountByPrincipal.get(principal) ?? null;
      if (account) accountIds.add(account);
      else withoutAccount += 1;
    }
    const embryos = (embryosByCohort.get(cohort.id) ?? [])
      .filter((row) => isEmbryoStatus(row.status))
      .sort((left, right) => left.sample_ordinal - right.sample_ordinal)
      .map((row) => ({
        id: row.id,
        subjectId: row.subject_id,
        sampleOrdinal: row.sample_ordinal,
        // The label is generated from the ordinal in the database; the same
        // rule stands in for a row read before the column materialised.
        displayLabel: row.display_label ?? `Embryo ${row.sample_ordinal + 1}`,
        status: row.status as EmbryoStatus,
      }));
    views.push({
      id: cohort.id,
      status: cohort.status,
      createdAt: cohort.created_at,
      embryoCount: cohort.embryo_count,
      viewerRole,
      requiredUploadPrincipalAccountIds: [...accountIds],
      requiredUploadPrincipalsWithoutAccount: withoutAccount,
      analysisGranted: required.length > 0 && required.every((principal) => grants.has(principal)),
      viewerAnalysisGranted:
        viewerRole === "required_upload_principal"
          ? viewerRequired.every((principal) => grants.has(principal))
          : null,
      analysisGrantsMissing:
        required.length === 0 ? 2 : required.filter((principal) => !grants.has(principal)).length,
      embryos,
      retentionExpiresAt: cohort.retention_expires_at,
    });
  }

  // The register's absent-query rule: created_at descending, then id ascending.
  return views.sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id),
  );
}

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A canonical lowercase UUID, as the register's closed query contract requires; anything else is unknown. */
export function isCanonicalId(value: string | null | undefined): value is string {
  return typeof value === "string" && CANONICAL_UUID.test(value);
}

/** Pure: the register's absent-query default, or the exact cohort, or null. */
export function selectCohort(views: readonly EmbryoCohortView[], cohortId: string | null): EmbryoCohortView | null {
  if (cohortId === null) return views[0] ?? null;
  if (!isCanonicalId(cohortId)) return null;
  return views.find((view) => view.id === cohortId) ?? null;
}

/** Pure: one embryo by id across every listed cohort, or null. */
export function selectEmbryo(
  views: readonly EmbryoCohortView[],
  embryoId: string,
): { cohort: EmbryoCohortView; embryo: EmbryoView } | null {
  if (!isCanonicalId(embryoId)) return null;
  for (const cohort of views) {
    const embryo = cohort.embryos.find((item) => item.id === embryoId);
    if (embryo) return { cohort, embryo };
  }
  return null;
}

/**
 * A query the graph needs answered with an error. Every page answers it with
 * the design's `error` state, never with an empty list, a 404 or "Still
 * checking the files" (R11): a read that failed has established nothing.
 */
export class EmbryoReadError extends Error {
  constructor(
    public readonly table: string,
    reason: string,
  ) {
    super(`embryo read failed: ${table}: ${reason}`);
    this.name = "EmbryoReadError";
  }
}

/** The rows of one query, or an EmbryoReadError; a PostgREST error never resolves to an empty list. */
export function rowsOrThrow<T>(
  table: string,
  result: { data: T[] | null; error: { message: string } | null },
): T[] {
  if (result.error) throw new EmbryoReadError(table, result.error.message);
  return result.data ?? [];
}

/** Reads every row the graph needs for one account. Service role: every embryo table revokes the client roles. */
export async function readCohortGraphRows(accountId: string): Promise<CohortGraphRows> {
  return readCohortGraphRowsWith(createAdminClient(), accountId);
}

/** The same read over a given client, so a failing query is provable without a database. */
export async function readCohortGraphRowsWith(admin: Db, accountId: string): Promise<CohortGraphRows> {
  const now = new Date().toISOString();

  const [principalsResult, ownedResult] = await Promise.all([
    admin
      .from("subject_principals")
      .select("id")
      .eq("account_id", accountId)
      .eq("status", "active"),
    admin
      .from("embryo_cohorts")
      .select("id, owner_account_id, upload_class, status, embryo_count, created_at, retention_expires_at")
      .eq("owner_account_id", accountId)
      .eq("upload_class", "embryo_third_party"),
  ]);
  const principals = rowsOrThrow("subject_principals", principalsResult);
  const owned = rowsOrThrow("embryo_cohorts", ownedResult);
  const viewerPrincipalIds = principals.map((row) => row.id);

  const memberships = viewerPrincipalIds.length
    ? rowsOrThrow(
        "embryo_participant_sets",
        await admin
          .from("embryo_participant_sets")
          .select("cohort_id")
          .eq("set_kind", "required_upload_principals")
          .is("revoked_at", null)
          .in("principal_id", viewerPrincipalIds),
      )
    : ([] as { cohort_id: string }[]);

  const cohortIds = [...new Set([...memberships.map((row) => row.cohort_id), ...owned.map((row) => row.id)])];
  if (cohortIds.length === 0) {
    return {
      viewerAccountId: accountId,
      viewerPrincipalIds,
      cohorts: [],
      requiredUploadPrincipals: [],
      principals: [],
      embryos: [],
      analysisGrants: [],
    };
  }

  const [cohortsResult, requiredResult, embryosResult, grantsResult] = await Promise.all([
    admin
      .from("embryo_cohorts")
      .select("id, owner_account_id, upload_class, status, embryo_count, created_at, retention_expires_at")
      .in("id", cohortIds),
    admin
      .from("embryo_participant_sets")
      .select("cohort_id, principal_id")
      .eq("set_kind", "required_upload_principals")
      .is("revoked_at", null)
      .in("cohort_id", cohortIds),
    admin
      .from("embryos")
      .select("id, cohort_id, subject_id, sample_ordinal, display_label, status")
      .in("cohort_id", cohortIds),
    admin
      .from("purpose_grants")
      .select("grant_id, grant_revision, target_id, signer_principal_id")
      .eq("target_kind", "cohort")
      .eq("purpose", "embryo.analysis")
      .is("revoked_at", null)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .in("target_id", cohortIds),
  ]);
  const cohorts = rowsOrThrow("embryo_cohorts", cohortsResult);
  const required = rowsOrThrow("embryo_participant_sets", requiredResult);
  const embryos = rowsOrThrow("embryos", embryosResult);
  const grants = rowsOrThrow("purpose_grants", grantsResult);

  const principalIds = [...new Set(required.map((row) => row.principal_id))];
  const principalRows = principalIds.length
    ? rowsOrThrow("subject_principals", await admin.from("subject_principals").select("id, account_id").in("id", principalIds))
    : ([] as { id: string; account_id: string | null }[]);

  // Both grant tables must agree on grant_id and revision (directional-purpose-grant-v1).
  const grantIds = grants.map((row) => row.grant_id);
  const directions = grantIds.length
    ? rowsOrThrow(
        "directional_grants",
        await admin
          .from("directional_grants")
          .select("grant_id, grant_revision")
          .eq("status", "current")
          .in("grant_id", grantIds),
      )
    : ([] as { grant_id: string; grant_revision: number }[]);
  const currentRevision = new Map(directions.map((row) => [row.grant_id, row.grant_revision]));
  const analysisGrants: AnalysisGrantRow[] = grants
    .filter((row) => currentRevision.get(row.grant_id) === row.grant_revision)
    .map((row) => ({ cohort_id: row.target_id, signer_principal_id: row.signer_principal_id }));

  return {
    viewerAccountId: accountId,
    viewerPrincipalIds,
    cohorts,
    requiredUploadPrincipals: required,
    principals: principalRows,
    embryos,
    analysisGrants,
  };
}

/** Every cohort this account may see, newest first. */
export async function listCohortsForAccount(accountId: string): Promise<EmbryoCohortView[]> {
  return buildCohortViews(await readCohortGraphRows(accountId));
}

/**
 * The exact cohort, or the register's absent-query default, or null. An
 * unknown, non-canonical, restricted or foreign id resolves to null, which
 * every caller answers with 404 (resource-not-found-page-v1).
 */
export async function resolveCohortForAccount(
  accountId: string,
  cohortId: string | null,
): Promise<EmbryoCohortView | null> {
  return selectCohort(await listCohortsForAccount(accountId), cohortId);
}

/** One embryo by id, with its cohort, or null with no existence signal. */
export async function resolveEmbryoForAccount(
  accountId: string,
  embryoId: string,
): Promise<{ cohort: EmbryoCohortView; embryo: EmbryoView } | null> {
  return selectEmbryo(await listCohortsForAccount(accountId), embryoId);
}
