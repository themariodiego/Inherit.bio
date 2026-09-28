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
 * Every table is read in pages that advance by the rows actually returned and
 * stop only on an empty page, because the API caps every response at 1,000
 * rows whatever range is asked for. (The first six were single reads until
 * 28 Sep 2026, so an account with more than 1,000 subject consents exported
 * the first 1,000.)
 *
 * Legal audit records are not here: the events a person caused themselves are
 * in `legal-audit.json` (src/lib/export/legal-audit.ts;
 * docs/export-legal-audit-resolver.md).
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

// Every table is read with listed columns, so a column added later is not
// exported by default: it must first be classified in the export member plan
// (docs/export-member-plan.json), whose unit and pgTAP checks fail until it
// is. `subjects` leaves without `owner_account_id` and `cohort_id`: for an
// adult held by another uploader the first names that other person's account,
// and the asynchronous history reader already withholds both.
const SUBJECT_COLUMNS = "id,subject_account_id,subject_class,upload_class,display_label,lifecycle,"
  + "subject_binding_revision,lifecycle_revision,created_at,updated_at,portrait_acknowledged_at,independent_login_at";
const DEMOGRAPHIC_COLUMNS = "subject_id,date_of_birth,chromosomal_sex,demographics_revision,updated_at";
const PRINCIPAL_COLUMNS = "id,subject_id,account_id,principal_kind,principal_revision,status,created_at";
const BINDING_COLUMNS = "id,subject_id,subject_principal_id,account_id,account_principal_id,binding_kind,binding_revision,"
  + "status,bound_at,ended_at";
const SUBJECT_CONSENT_COLUMNS = "id,signature_id,subject_id,cohort_id,account_id,consent_type,scope,provider_key,"
  + "grant_revision,granted_at,expires_at,revoked_at,revocation_reason,copilot_recipient";
const RECIPIENT_GRANT_COLUMNS = "id,account_id,recipient_principal_id,provider_id,purpose,artifact_key,artifact_version,"
  + "grant_revision,model_recipient_revision,status,created_at,ended_at";
const PROFILE_COLUMNS = "id,date_of_birth,jurisdiction_code,jurisdiction_subdivision,jurisdiction_revision,"
  + "jurisdiction_declared_at,jurisdiction_attestation_version,jurisdiction_attestation_sha256";
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
    readAll((from, to) => admin.from("subjects").select(SUBJECT_COLUMNS)
      .eq("subject_account_id", accountId).order("id").range(from, to)),
    readAll((from, to) => admin.from("subject_principals").select(PRINCIPAL_COLUMNS)
      .eq("account_id", accountId).order("id").range(from, to)),
    readAll((from, to) => admin.from("subject_account_bindings").select(BINDING_COLUMNS)
      .eq("account_id", accountId).order("id").range(from, to)),
    readAll((from, to) => admin.from("subject_consents").select(SUBJECT_CONSENT_COLUMNS)
      .eq("account_id", accountId).order("id").range(from, to)),
    readAll((from, to) => admin.from("provider_recipient_grants").select(RECIPIENT_GRANT_COLUMNS)
      .eq("account_id", accountId).order("id").range(from, to)),
  ]);
  if (!subjects || !principals || !bindings || !consents || !grants) return null;
  // A second hop, because the declaration is keyed by subject rather than by
  // account. It runs on the ids the first query already scoped, so it cannot
  // reach a subject the export would not have carried anyway.
  const subjectIds = subjects.map((subject) => subject.id);
  const demographics = subjectIds.length
    ? await readAll((from, to) => admin.from("subject_demographics").select(DEMOGRAPHIC_COLUMNS)
      .in("subject_id", subjectIds).order("subject_id").range(from, to))
    : [];
  if (!demographics) return null;

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
    subjects,
    subject_demographics: demographics,
    subject_principals: principals,
    subject_account_bindings: bindings,
    subject_consents: consents,
    provider_recipient_grants: grants,
    profiles,
    consent_signatures: signatures,
    purpose_grants: withoutJoin(purposeGrants, "consent_signatures"),
    attestations: [...attestations.values()].sort((a, b) => String(a.id).localeCompare(String(b.id))),
  };
}
