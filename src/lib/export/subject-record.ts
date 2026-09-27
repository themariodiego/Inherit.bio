import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The part of the free export that answers "who does this service say I am,
 * and what did I agree to".
 *
 * G5.6 recorded this as a rights decision rather than a bug: `subjects`,
 * `subject_consents`, `subject_account_bindings`, `subject_principals` and
 * `provider_recipient_grants` describe a person's own consent history, which
 * is arguably theirs to have, and they also name other people. The operator
 * settled it on 2026-09-11: include them, scoped to the requester.
 *
 * SCOPING IS THE WHOLE SAFETY ARGUMENT, so it is stated once here rather than
 * spread across five call sites. Every query below is keyed to the requesting
 * account by a column that cannot match another person's row:
 *
 *   - `subjects.subject_account_id` is the account a subject IS, which is not
 *     the same as `owner_account_id`, the account that HOLDS it. Measured on a
 *     real database: it is set on every `self` subject, on the `other_adult`
 *     subjects who have their own account, and never on an `embryo`. Keying on
 *     it means an account that holds other people's subjects exports its own
 *     rows and none of theirs - which is exactly the disclosure the narrower
 *     column exists to prevent.
 *   - The other four key on `account_id`, which is this account by definition.
 *   - `subject_demographics` is keyed to the subject ids the first query
 *     returned, which are exactly the subjects this account IS. That is the
 *     same scoping argument as `subjects` itself, one hop later, and it is
 *     also the whole reachable set: `declare_chromosomal_sex_v1` accepts only
 *     a subject whose `subject_account_id` is the acting account, so no row
 *     this account created can fall outside it (D-031).
 *
 * A consent row keyed to this account can still carry another person's
 * `subject_id` as a uuid, and that is deliberate rather than overlooked: it is
 * the record of something this account DID, so withholding it would hide a
 * person's own action from them, and a uuid they already transacted with
 * discloses nothing they did not already have.
 *
 * What is NOT here: any row where this account is merely the owner, the
 * recipient or the counterparty. Those are someone else's record, and the
 * person they belong to can export them from their own account.
 *
 * The permission records and profile facts (F4, 26 Sep 2026). A real account
 * that had signed an insurance disclosure, affirmed its DNA was its own, chosen
 * three report types and declared a country exported one consent row and none
 * of the rest, because they live in four other tables. Signatures and
 * attestations are read with the scoping and listed columns of the
 * asynchronous history reader (`20260925210000_export_archive_history_reader.sql`,
 * kinds `signatures` and `attestations`), so both exports describe those rows
 * alike; the grants and the profile follow the same discipline of named
 * columns keyed to this account:
 *
 *   - `consent_signatures` keys on `signer_account_id`: what this account
 *     signed. Never `signing_name_encrypted`: a signature leaves as what was
 *     signed, about what, and when.
 *   - `attestations` are the ones this account's principals made or its own
 *     signatures carry, each side joined on the account column rather than
 *     on a list of ids, so the filter cannot outgrow a URL.
 *   - `purpose_grants` are the grants on the subjects this account IS, and
 *     only those resting on a signature this account made. A grant another
 *     person signed about this subject is theirs, exactly as their signature
 *     is.
 *   - `profiles` is this account's own row, reduced to what the person gave:
 *     the birth date and the declared country, with the revision and the
 *     attestation version it was declared under.
 *
 * These four are read in pages that advance by the rows actually returned and
 * stop only on an empty page, because the API caps every response at 1,000
 * rows whatever range is asked for.
 *
 * Legal audit records are not here and cannot be yet: every legal audit event
 * is written with a null principal, so nothing selects one account's rows
 * (docs/export-member-selection-design.md, the missing "requester resolver").
 */

export interface SubjectRecord {
  subjects: unknown[];
  subject_demographics: unknown[];
  subject_principals: unknown[];
  subject_account_bindings: unknown[];
  subject_consents: unknown[];
  provider_recipient_grants: unknown[];
  profiles: unknown[];
  consent_signatures: unknown[];
  purpose_grants: unknown[];
  attestations: unknown[];
}

const PROFILE_COLUMNS = "id,date_of_birth,jurisdiction_code,jurisdiction_revision,jurisdiction_declared_at,"
  + "jurisdiction_attestation_version,jurisdiction_attestation_sha256";
const SIGNATURE_COLUMNS = "id,artifact_key,artifact_version,artifact_body_sha256,signer_principal_id,target_kind,"
  + "target_id,purpose,statement_keys,jurisdiction_code,jurisdiction_revision,subject_binding_revision,signed_at";
const ATTESTATION_COLUMNS = "id,signature_id,principal_id,target_kind,target_id,kind,statement_keys,affirmed,"
  + "attestation_revision,affirmed_at";
const PURPOSE_GRANT_COLUMNS = "grant_id,grant_revision,target_kind,target_id,purpose,artifact_key,artifact_version,"
  + "artifact_body_sha256,signature_id,signer_principal_id,data_subject_principal_id,subject_binding_revision,"
  + "jurisdiction_code,jurisdiction_revision,granted_at,expires_at,revoked_at,revocation_reason";

const PAGE = 1000;
type Row = Record<string, unknown>;
type Page = PromiseLike<{ data: unknown[] | null; error: unknown }>;

/** Every row, or null on any failed page. */
async function readAll(page: (from: number, to: number) => Page): Promise<Row[] | null> {
  const rows: Row[] = [];
  for (let from = 0; ; ) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return null;
    if (!data || data.length === 0) return rows;
    rows.push(...(data as Row[]));
    from += data.length;
  }
}

/** Drops the embedded row a join filter needed, so only listed columns leave. */
function withoutJoin(rows: Row[], key: string): Row[] {
  return rows.map((row) => Object.fromEntries(Object.entries(row).filter(([name]) => name !== key)));
}

/** The ids of the subjects this account IS, for readers keyed by subject. */
export function ownSubjectIds(record: SubjectRecord): string[] {
  return record.subjects.flatMap((subject) => {
    const id = (subject as { id?: unknown } | null)?.id;
    return typeof id === "string" ? [id] : [];
  });
}

export function subjectRecordRowCount(record: SubjectRecord): number {
  return Object.values(record).reduce((total, rows) => total + rows.length, 0);
}

/** Null on any read failure, so the caller refuses the export rather than
 * shipping an archive that silently understates what is held. */
export async function subjectRecordOf(
  admin: SupabaseClient,
  accountId: string,
): Promise<SubjectRecord | null> {
  const [subjects, principals, bindings, consents, grants] = await Promise.all([
    admin.from("subjects").select("*").eq("subject_account_id", accountId),
    admin.from("subject_principals").select("*").eq("account_id", accountId),
    admin.from("subject_account_bindings").select("*").eq("account_id", accountId),
    admin.from("subject_consents").select("*").eq("account_id", accountId),
    admin.from("provider_recipient_grants").select("*").eq("account_id", accountId),
  ]);
  for (const result of [subjects, principals, bindings, consents, grants]) {
    if (result.error) return null;
  }
  // A second hop, because the declaration is keyed by subject rather than by
  // account. It runs on the ids the first query already scoped, so it cannot
  // reach a subject the export would not have carried anyway.
  const subjectIds = (subjects.data ?? []).map((subject) => subject.id);
  const demographics = subjectIds.length
    ? await admin.from("subject_demographics").select("*").in("subject_id", subjectIds)
    : { data: [], error: null };
  if (demographics.error) return null;

  const [profiles, signatures, byPrincipal, bySignature, purposeGrants] = await Promise.all([
    readAll((from, to) => admin.from("profiles").select(PROFILE_COLUMNS).eq("id", accountId)
      .order("id").range(from, to)),
    readAll((from, to) => admin.from("consent_signatures").select(SIGNATURE_COLUMNS)
      .eq("signer_account_id", accountId).order("id").range(from, to)),
    readAll((from, to) => admin.from("attestations").select(`${ATTESTATION_COLUMNS},subject_principals!inner(account_id)`)
      .eq("subject_principals.account_id", accountId).order("id").range(from, to)),
    readAll((from, to) => admin.from("attestations").select(`${ATTESTATION_COLUMNS},consent_signatures!inner(signer_account_id)`)
      .eq("consent_signatures.signer_account_id", accountId).order("id").range(from, to)),
    subjectIds.length
      ? readAll((from, to) => admin.from("purpose_grants").select(`${PURPOSE_GRANT_COLUMNS},consent_signatures!inner(signer_account_id)`)
        .eq("consent_signatures.signer_account_id", accountId).eq("target_kind", "subject")
        .in("target_id", subjectIds).order("grant_id").range(from, to))
      : Promise.resolve([] as Row[]),
  ]);
  if (!profiles || !signatures || !byPrincipal || !bySignature || !purposeGrants) return null;
  // One attestation can be both made by this account's principal and carried
  // on its signature; it is one row, listed once.
  const attestations = new Map<unknown, Row>();
  for (const row of [...withoutJoin(byPrincipal, "subject_principals"), ...withoutJoin(bySignature, "consent_signatures")]) {
    attestations.set(row.id, row);
  }
  return {
    subjects: subjects.data ?? [],
    subject_demographics: demographics.data ?? [],
    subject_principals: principals.data ?? [],
    subject_account_bindings: bindings.data ?? [],
    subject_consents: consents.data ?? [],
    provider_recipient_grants: grants.data ?? [],
    profiles,
    consent_signatures: signatures,
    purpose_grants: withoutJoin(purposeGrants, "consent_signatures"),
    attestations: [...attestations.values()].sort((a, b) => String(a.id).localeCompare(String(b.id))),
  };
}
