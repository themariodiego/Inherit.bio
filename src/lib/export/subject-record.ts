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
 */

export interface SubjectRecord {
  subjects: unknown[];
  subject_demographics: unknown[];
  subject_principals: unknown[];
  subject_account_bindings: unknown[];
  subject_consents: unknown[];
  provider_recipient_grants: unknown[];
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
  return {
    subjects: subjects.data ?? [],
    subject_demographics: demographics.data ?? [],
    subject_principals: principals.data ?? [],
    subject_account_bindings: bindings.data ?? [],
    subject_consents: consents.data ?? [],
    provider_recipient_grants: grants.data ?? [],
  };
}
