import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The graph's database read (`readFamilyGraphRows`, through `listFamilyPeople`)
 * against an in-memory stand-in for the service-role client: it asks the one
 * D-156 question (owner decision of 22 November 2026) about exactly the
 * records that share with the viewer, and a record the database names reads
 * on every Family page exactly as one that shares nothing.
 */

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const rpc = vi.fn<(name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>();

/** One `col.op.value` term of a PostgREST filter, over a row. */
function matches(row: Row, column: string, op: string, value: string): boolean {
  if (op === "eq") return String(row[column]) === value;
  if (op === "is") return value === "null" ? row[column] === null || row[column] === undefined : false;
  if (op === "gt") return row[column] !== null && String(row[column]) > value;
  throw new Error(`unsupported filter ${op}`);
}
function query(table: string) {
  const filters: ((row: Row) => boolean)[] = [];
  const rows = () => (tables[table] ?? []).filter(row => filters.every(filter => filter(row)));
  const builder = {
    select: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
    eq: (column: string, value: unknown) => { filters.push(row => String(row[column]) === String(value)); return builder; },
    in: (column: string, values: unknown[]) => { filters.push(row => values.map(String).includes(String(row[column]))); return builder; },
    is: (column: string, value: null) => { filters.push(row => (row[column] ?? null) === value); return builder; },
    or: (expression: string) => {
      const terms = expression.split(",").map(term => {
        const [column, op, ...rest] = term.split(".");
        return [column!, op!, rest.join(".")] as const;
      });
      filters.push(row => terms.some(([column, op, value]) => matches(row, column, op, value)));
      return builder;
    },
    then: (resolve: (value: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
  };
  return builder;
}
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => query(table), rpc: (name: string, args: Record<string, unknown>) => rpc(name, args) }),
}));

const { listFamilyPeople } = await import("./graph");
const { evaluatePortraitPreconditions, readPortraitPairRows } = await import("./portrait");

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SELF_A = "11111111-1111-4111-8111-111111111111";
const SELF_B = "22222222-2222-4222-8222-222222222222";
const INVITED_B = "33333333-3333-4333-8333-333333333333";
const PRINCIPAL_A = "44444444-4444-4444-8444-444444444444";
const PRINCIPAL_B = "55555555-5555-4555-8555-555555555555";
const subject = (id: string, account: string, subjectClass = "self", label = "You") => ({
  id, display_label: label, subject_class: subjectClass, lifecycle: "active", lifecycle_revision: 1,
  owner_account_id: null, subject_account_id: account,
});

beforeEach(() => {
  rpc.mockReset();
  // A invited B; B accepted and shares two report layers and raw browsing with A from B's own record.
  Object.assign(tables, {
    subject_principals: [
      { id: PRINCIPAL_A, subject_id: SELF_A, account_id: A, principal_kind: "account_subject", status: "active" },
      { id: PRINCIPAL_B, subject_id: SELF_B, account_id: B, principal_kind: "account_subject", status: "active" },
    ],
    subjects: [subject(SELF_A, A, "self", "Ada"), subject(SELF_B, B, "self", "Bo"), subject(INVITED_B, B, "other_adult", "Invited adult")],
    subject_invitations: [{ target_id: INVITED_B, inviter_principal_id: PRINCIPAL_A, invitation_kind: "adult_subject", status: "accepted" }],
    directional_grants: ["g1", "g2", "g3"].map(grant_id => ({ grant_id, grant_revision: 1, recipient_account_id: A,
      status: "current", direction: "subject_to_recipient" })),
    purpose_grants: [["g1", "reports.polygenic"], ["g2", "copilot.local"], ["g3", "raw.browse"]].map(([grant_id, purpose]) => ({
      grant_id, grant_revision: 1, purpose, target_id: SELF_B, data_subject_principal_id: PRINCIPAL_B, revoked_at: null, expires_at: null })),
    family_sharing_pauses: [],
  });
});

describe("the Family graph's read (D-156)", () => {
  it("asks once, about exactly the records that share with the viewer, and reads a named one as sharing nothing", async () => {
    rpc.mockResolvedValue({ data: [SELF_B], error: null });
    const [person, ...rest] = await listFamilyPeople(A);
    expect(rest).toEqual([]);
    expect(rpc.mock.calls).toEqual([["adult_acceptance_inviter_held_subjects_v1", { p_account_id: A, p_subject_ids: [SELF_B] }]]);
    expect(person!.dataSubjectId).toBe(SELF_B);
    expect(person!.handle.id).toBe(INVITED_B);
    expect([...person!.grantsToViewer]).toEqual([]);
  });

  it("reads the same rows normally once the database no longer names the record", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const [person] = await listFamilyPeople(A);
    expect([...person!.grantsToViewer]).toEqual(["reports.polygenic", "copilot.local", "raw.browse"]);
  });

  it("reads every shared record as not shared when the question cannot be answered", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    const [person] = await listFamilyPeople(A);
    expect([...person!.grantsToViewer]).toEqual([]);
  });

  it("does not ask when nothing is shared with the viewer", async () => {
    tables.purpose_grants = [];
    tables.directional_grants = [];
    await listFamilyPeople(A);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("the Portrait pair's read (D-156)", () => {
  const PAIR = "66666666-6666-4666-8666-666666666666";
  beforeEach(() => {
    const at = "2026-11-01T00:00:00.000Z";
    Object.assign(tables, {
      family_pairs: [{ id: PAIR, subject_a_id: SELF_A, subject_b_id: SELF_B, status: "current", pair_revision: 1 }],
      subjects: [SELF_A, SELF_B].map((id, index) => ({ ...subject(id, index === 0 ? A : B), portrait_acknowledged_at: at,
        independent_login_at: at })),
      // Each person's family.portrait grant to the other.
      purpose_grants: [["p1", SELF_B, PRINCIPAL_B], ["p2", SELF_A, PRINCIPAL_A]].map(([grant_id, target_id, principal]) => ({
        grant_id, grant_revision: 1, purpose: "family.portrait", target_kind: "subject", target_id,
        data_subject_principal_id: principal, revoked_at: null, expires_at: null })),
      directional_grants: [["p1", A], ["p2", B]].map(([grant_id, recipient]) => ({ grant_id, grant_revision: 1,
        recipient_account_id: recipient, status: "current", direction: "subject_to_recipient" })),
      family_sharing_pauses: [],
    });
  });

  it("reads the other person's Portrait grant to the inviter as not given while the database names their record", async () => {
    rpc.mockResolvedValue({ data: [SELF_B], error: null });
    const rows = (await readPortraitPairRows(A, PAIR))!;
    expect(rpc.mock.calls).toEqual([["adult_acceptance_inviter_held_subjects_v1", { p_account_id: A, p_subject_ids: [SELF_B] }]]);
    expect(rows.grants.map(grant => grant.grantId)).toEqual(["p2"]);
    expect(evaluatePortraitPreconditions(rows).kind).toBe("missing");
    // Exactly the state of a pair the other person has not turned on yet.
    tables.purpose_grants = tables.purpose_grants!.filter(row => row.grant_id !== "p1");
    rpc.mockResolvedValue({ data: [], error: null });
    expect(evaluatePortraitPreconditions(rows)).toEqual(evaluatePortraitPreconditions((await readPortraitPairRows(A, PAIR))!));
  });

  it("keeps both grants when the database names nothing, and for the invited person's own view", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(evaluatePortraitPreconditions((await readPortraitPairRows(A, PAIR))!).kind).toBe("ok");
    rpc.mockClear();
    expect(evaluatePortraitPreconditions((await readPortraitPairRows(B, PAIR))!).kind).toBe("ok");
    expect(rpc.mock.calls).toEqual([["adult_acceptance_inviter_held_subjects_v1", { p_account_id: B, p_subject_ids: [SELF_A] }]]);
  });

  it("reads the grant as not given when the question cannot be answered", async () => {
    rpc.mockRejectedValue(new Error("network"));
    expect((await readPortraitPairRows(A, PAIR))!.grants.map(grant => grant.grantId)).toEqual(["p2"]);
  });
});
