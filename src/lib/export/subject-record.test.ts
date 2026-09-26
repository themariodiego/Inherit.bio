import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ownSubjectIds, subjectRecordOf, subjectRecordRowCount, type SubjectRecord } from "./subject-record";

/**
 * The scoping is the safety argument, so it is what these tests hold. A change
 * that widened any of these queries to a column naming somebody else -
 * `owner_account_id` on `subjects` is the one that looks right and is not -
 * fails here rather than in someone's archive.
 */

type Filter = readonly [op: "eq" | "in", column: string, value: string];
type Call = { table: string; select: string; filters: Filter[] };

const SUBJECT = "99999999-9999-4999-8999-999999999999";
const ACCOUNT = "11111111-1111-4111-8111-111111111111";
/** The API's own cap: a page never holds more, whatever range is asked for. */
const MAX_ROWS = 1000;
/** Tables read with listed columns and pages rather than `select("*")`. */
const LISTED = new Set(["profiles", "consent_signatures", "attestations", "purpose_grants"]);

/**
 * A listed-column table answers with exactly the columns selected, so a
 * column the reader did not name cannot reach the record through the mock.
 * An embedded `table!inner(column)` join comes back as the nested row the API
 * returns, keyed to this account, so the test can see it is stripped.
 */
function listedRow(table: string, select: string, index: number): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const token of select.split(",")) {
    const join = /^(\w+)!inner\((\w+)\)$/.exec(token);
    if (join) row[join[1]] = { [join[2]]: ACCOUNT };
    else row[token] = token === "id" || token === "grant_id" ? `${table}-${String(index).padStart(5, "0")}` : `${table}.${token}`;
  }
  return row;
}

function admin(calls: Call[], options: { failing?: string; rows?: Record<string, number> } = {}): SupabaseClient {
  return {
    from(table: string) {
      const call: Call = { table, select: "", filters: [] };
      calls.push(call);
      let range: [number, number] | null = null;
      const answer = () => {
        if (table === options.failing) return { data: null, error: { message: "unavailable" } };
        if (!LISTED.has(table)) {
          const [, column, value] = call.filters[0] ?? [];
          return table === "subjects"
            ? { data: [{ id: SUBJECT, table, column, value }], error: null }
            : { data: [{ table, column, value }], error: null };
        }
        const all = Array.from({ length: options.rows?.[table] ?? 1 }, (_, i) => listedRow(table, call.select, i));
        const [from, to] = range ?? [0, all.length - 1];
        return { data: all.slice(from, Math.min(to + 1, from + MAX_ROWS)), error: null };
      };
      const builder = {
        select(columns: string) { call.select = columns; return builder; },
        eq(column: string, value: string) { call.filters.push(["eq", column, value]); return builder; },
        // The demographics hop filters by the subject ids the first query
        // returned, as do the purpose grants on the subjects this account IS.
        in(column: string, values: string[]) { call.filters.push(["in", column, values.join(",")]); return builder; },
        order() { return builder; },
        range(from: number, to: number) { range = [from, to]; return builder; },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(answer()).then(resolve, reject);
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

/** One entry per distinct query, however many pages it took. */
function queries(calls: Call[]) {
  return [...new Map(calls.map((call) => [JSON.stringify(call), call])).values()];
}

describe("the subject record in the free export", () => {
  it("keys every table to the requesting account, and subjects to the account it IS", async () => {
    const calls: Call[] = [];
    const record = await subjectRecordOf(admin(calls), ACCOUNT);
    expect(record).not.toBeNull();

    // `subject_account_id` is the account a subject IS. `owner_account_id` is
    // the account that HOLDS it, and keying on that would export the subject
    // rows of every other person this account holds.
    expect(calls).toContainEqual({ table: "subjects", select: "*", filters: [["eq", "subject_account_id", ACCOUNT]] });
    expect(calls.some((call) => call.filters.some(([, column]) => column === "owner_account_id"))).toBe(false);

    for (const table of [
      "subject_principals",
      "subject_account_bindings",
      "subject_consents",
      "provider_recipient_grants",
    ]) {
      expect(calls).toContainEqual({ table, select: "*", filters: [["eq", "account_id", ACCOUNT]] });
    }

    // The declaration is keyed by subject, so it is filtered by the subject
    // ids `subjects` returned rather than by the account (D-031).
    expect(calls).toContainEqual({ table: "subject_demographics", select: "*", filters: [["in", "subject_id", SUBJECT]] });

    // F4: the permission records and the profile, each keyed to this account.
    const filtersOf = (table: string) => queries(calls).filter((call) => call.table === table).map((call) => call.filters);
    expect(filtersOf("profiles")).toEqual([[["eq", "id", ACCOUNT]]]);
    expect(filtersOf("consent_signatures")).toEqual([[["eq", "signer_account_id", ACCOUNT]]]);
    // Made by this account's principals, or carried on its own signatures.
    expect(filtersOf("attestations")).toEqual([
      [["eq", "subject_principals.account_id", ACCOUNT]],
      [["eq", "consent_signatures.signer_account_id", ACCOUNT]],
    ]);
    // On the subjects this account IS, and signed by this account.
    expect(filtersOf("purpose_grants")).toEqual([[
      ["eq", "consent_signatures.signer_account_id", ACCOUNT], ["eq", "target_kind", "subject"], ["in", "target_id", SUBJECT],
    ]]);

    // Eleven queries, each filtered: an unfiltered read would appear here with
    // no filter at all, so the count and the values are part of the assertion.
    expect(queries(calls)).toHaveLength(11);
    expect(calls.every((call) => call.filters.length > 0)).toBe(true);
    expect(new Set(calls.flatMap((call) => call.filters.map(([, , value]) => value))))
      .toEqual(new Set([ACCOUNT, SUBJECT, "subject"]));
  });

  it("names its columns for every permission record and never selects the signing name", async () => {
    const calls: Call[] = [];
    const record = (await subjectRecordOf(admin(calls), ACCOUNT))!;
    for (const table of LISTED) {
      for (const call of calls.filter((entry) => entry.table === table)) {
        expect(call.select, table).not.toContain("*");
        expect(call.select, table).not.toMatch(/signing_name/);
      }
    }
    for (const row of record.consent_signatures as Record<string, unknown>[]) {
      expect(Object.keys(row)).not.toContain("signing_name_encrypted");
      expect(Object.keys(row).sort()).toEqual([
        "artifact_body_sha256", "artifact_key", "artifact_version", "id", "jurisdiction_code", "jurisdiction_revision",
        "purpose", "signed_at", "signer_principal_id", "statement_keys", "subject_binding_revision", "target_id", "target_kind",
      ]);
    }
    // The joins that scope attestations and grants are filters, not content.
    for (const row of [...record.attestations, ...record.purpose_grants] as Record<string, unknown>[]) {
      expect(row).not.toHaveProperty("consent_signatures");
      expect(row).not.toHaveProperty("subject_principals");
    }
    expect(Object.keys(record.attestations[0] as object).sort()).toEqual([
      "affirmed", "affirmed_at", "attestation_revision", "id", "kind", "principal_id", "signature_id", "statement_keys",
      "target_id", "target_kind",
    ]);
  });

  it("carries the birth date and the declared country from this account's own profile", async () => {
    const record = (await subjectRecordOf(admin([]), ACCOUNT))!;
    expect(record.profiles).toHaveLength(1);
    expect(Object.keys(record.profiles[0] as object).sort()).toEqual([
      "date_of_birth", "id", "jurisdiction_attestation_sha256", "jurisdiction_attestation_version",
      "jurisdiction_code", "jurisdiction_declared_at", "jurisdiction_revision",
    ]);
  });

  it("lists an attestation once when it is both made by this account and carried on its signature", async () => {
    // Both attestation queries answer the same row id here.
    const record = (await subjectRecordOf(admin([], { rows: { attestations: 2 } }), ACCOUNT))!;
    expect((record.attestations as { id: string }[]).map((row) => row.id))
      .toEqual(["attestations-00000", "attestations-00001"]);
  });

  it("reads a permission class larger than one API page completely", async () => {
    const calls: Call[] = [];
    const record = (await subjectRecordOf(admin(calls, { rows: { consent_signatures: 2503 } }), ACCOUNT))!;
    const ids = (record.consent_signatures as { id: string }[]).map((row) => row.id);
    expect(ids).toHaveLength(2503);
    expect(new Set(ids).size).toBe(2503);
    // Three full pages and the empty one that ends the read.
    expect(calls.filter((call) => call.table === "consent_signatures")).toHaveLength(4);
  });

  it("reads no purpose grant when this account is no subject at all", async () => {
    const calls: Call[] = [];
    const client = admin(calls);
    const empty = {
      from(table: string) {
        const builder = client.from(table);
        if (table !== "subjects") return builder;
        return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
      },
    } as unknown as SupabaseClient;
    const record = (await subjectRecordOf(empty, ACCOUNT))!;
    expect(record.purpose_grants).toEqual([]);
    expect(record.subject_demographics).toEqual([]);
    expect(calls.some((call) => call.table === "purpose_grants")).toBe(false);
  });

  it("refuses the whole record when any one read fails, rather than understating what is held", async () => {
    for (const failing of [
      "subjects",
      "subject_principals",
      "subject_account_bindings",
      "subject_consents",
      "provider_recipient_grants",
      "subject_demographics",
      "profiles",
      "consent_signatures",
      "attestations",
      "purpose_grants",
    ]) {
      expect(await subjectRecordOf(admin([], { failing }), ACCOUNT), failing).toBeNull();
    }
  });

  it("counts every row it carries, so the manifest cannot understate the archive", () => {
    const record: SubjectRecord = {
      subjects: [1],
      subject_demographics: [1],
      subject_principals: [1, 2],
      subject_account_bindings: [],
      subject_consents: [1, 2, 3],
      provider_recipient_grants: [1],
      profiles: [1],
      consent_signatures: [1, 2, 3, 4, 5],
      purpose_grants: [1, 2, 3],
      attestations: [1],
    };
    expect(subjectRecordRowCount(record)).toBe(18);
    expect(subjectRecordRowCount({
      subjects: [], subject_demographics: [], subject_principals: [],
      subject_account_bindings: [], subject_consents: [], provider_recipient_grants: [],
      profiles: [], consent_signatures: [], purpose_grants: [], attestations: [],
    })).toBe(0);
  });

  it("names the subjects this account IS for the readers keyed by subject", () => {
    const record = { subjects: [{ id: SUBJECT }, { id: 7 }, null] } as unknown as SubjectRecord;
    expect(ownSubjectIds(record)).toEqual([SUBJECT]);
  });
});
