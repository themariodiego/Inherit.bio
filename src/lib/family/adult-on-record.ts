import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Whether an account has an adult date of birth on record (D-102).
 *
 * ONE BOOLEAN, DELIBERATELY. `profiles.date_of_birth` supports three answers —
 * the database computes them as `birthDateState` in
 * `own_upload_account_completion.sql`: `missing`, `adult`, `underage`. This
 * function collapses two of them, because the sentence it chooses must not
 * distinguish "has not recorded one" from "is under 18". The owner's decision
 * of 2026-09-14 accepted that a reader learns the named person is one or the
 * other; it did not accept Inherit telling them which.
 *
 * IT DECIDES A SENTENCE, NEVER AN AUTHORITY. The adult rule is enforced in SQL
 * by `private.family_report_endpoint_v1(..., p_require_adult)`, which is what
 * actually withholds the grant. This read exists only so the locked row can
 * say WHY instead of rendering an empty paragraph. If the two ever disagree,
 * the reader sees the wrong sentence over a row that is correctly locked —
 * which is why the comparison below is written to match the SQL's own
 * (UTC calendar date, 18 years, inclusive) rather than approximated.
 */

type Db = SupabaseClient<Database>;

/** Eighteen years before today in UTC, as a calendar date, matching the SQL. */
export function adultCutoff(now: Date = new Date()): string {
  const year = now.getUTCFullYear() - 18;
  const month = `${now.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${now.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * True for each account whose profile records a date of birth on or before the
 * cutoff. An account with no profile row, no date, or a read failure is false:
 * the honest answer to "is this person an adult on record" when nothing was
 * read is no, and it renders a sentence that names a missing record rather
 * than one that claims a fault.
 */
export async function adultOnRecord(
  admin: Db,
  accountIds: readonly string[],
  now: Date = new Date(),
): Promise<Map<string, boolean>> {
  const answer = new Map<string, boolean>();
  for (const id of accountIds) answer.set(id, false);
  if (accountIds.length === 0) return answer;
  const { data, error } = await admin
    .from("profiles")
    .select("id, date_of_birth")
    .in("id", [...accountIds]);
  if (error) return answer;
  const cutoff = adultCutoff(now);
  for (const row of data ?? []) {
    answer.set(row.id, typeof row.date_of_birth === "string" && row.date_of_birth <= cutoff);
  }
  return answer;
}
