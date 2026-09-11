import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { subjectRecordOf, subjectRecordRowCount, type SubjectRecord } from "./subject-record";

/**
 * The scoping is the safety argument, so it is what these tests hold. A change
 * that widened any of these five queries to a column naming somebody else -
 * `owner_account_id` on `subjects` is the one that looks right and is not -
 * fails here rather than in someone's archive.
 */

type Call = { table: string; column: string; value: string };

function admin(calls: Call[], failing?: string): SupabaseClient {
  return {
    from(table: string) {
      return {
        select() {
          return {
            eq(column: string, value: string) {
              calls.push({ table, column, value });
              return table === failing
                ? { data: null, error: { message: "unavailable" } }
                : { data: [{ table, column, value }], error: null };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

const ACCOUNT = "11111111-1111-4111-8111-111111111111";

describe("the subject record in the free export", () => {
  it("keys every table to the requesting account, and subjects to the account it IS", async () => {
    const calls: Call[] = [];
    const record = await subjectRecordOf(admin(calls), ACCOUNT);
    expect(record).not.toBeNull();

    // `subject_account_id` is the account a subject IS. `owner_account_id` is
    // the account that HOLDS it, and keying on that would export the subject
    // rows of every other person this account holds.
    expect(calls).toContainEqual({ table: "subjects", column: "subject_account_id", value: ACCOUNT });
    expect(calls.some((call) => call.column === "owner_account_id")).toBe(false);

    for (const table of [
      "subject_principals",
      "subject_account_bindings",
      "subject_consents",
      "provider_recipient_grants",
    ]) {
      expect(calls).toContainEqual({ table, column: "account_id", value: ACCOUNT });
    }

    // Five tables, five queries, each filtered exactly once: an unfiltered read
    // would not appear here at all, so the count is part of the assertion.
    expect(calls).toHaveLength(5);
    expect(new Set(calls.map((call) => call.value))).toEqual(new Set([ACCOUNT]));
  });

  it("refuses the whole record when any one read fails, rather than understating what is held", async () => {
    for (const failing of [
      "subjects",
      "subject_principals",
      "subject_account_bindings",
      "subject_consents",
      "provider_recipient_grants",
    ]) {
      expect(await subjectRecordOf(admin([], failing), ACCOUNT), failing).toBeNull();
    }
  });

  it("counts every row it carries, so the manifest cannot understate the archive", () => {
    const record: SubjectRecord = {
      subjects: [1],
      subject_principals: [1, 2],
      subject_account_bindings: [],
      subject_consents: [1, 2, 3],
      provider_recipient_grants: [1],
    };
    expect(subjectRecordRowCount(record)).toBe(7);
    expect(subjectRecordRowCount({
      subjects: [], subject_principals: [], subject_account_bindings: [],
      subject_consents: [], provider_recipient_grants: [],
    })).toBe(0);
  });
});
