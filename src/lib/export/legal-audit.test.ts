import { describe, expect, it } from "vitest";
import { ownLegalAuditEvents } from "./legal-audit";

/**
 * The synchronous export's reader of the requester's own legal audit slice.
 * The database selects the rows (supabase/tests/legal_audit_attribution.sql);
 * this reader must read every page, in ledger order, keep only the closed
 * shape, and refuse rather than understate.
 */

const ACTOR = { accountId: "11111111-1111-4111-8111-111111111111", sessionId: "22222222-2222-4222-8222-222222222222" };
const STARTED = "2026-09-28T16:00:00.000+00:00";
const event = (seq: number) => ({ seq, occurred_at: "2026-09-28T17:00:00+00:00", event_code: "purpose.granted",
  route_id: "api.consents", outcome_code: "accepted", coded_context: { purpose: "ancestry", revision: 1 } });

/** A database with `total` events for this account, answering 500 per page after a sequence. */
function ledger(total: number, overrides: (page: Record<string, unknown>, call: number) => Record<string, unknown> = page => page) {
  const calls: Record<string, unknown>[] = [];
  const all = Array.from({ length: total }, (_, i) => event(10 + i * 2));
  const rpc = async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, ...args });
    const after = (args.p_after_seq as number | null) ?? 0;
    const events = all.filter(row => row.seq > after).slice(0, 500);
    const page = { version: "legal-audit-slice-v1", attributionStartedAt: STARTED, events,
      nextAfterSeq: events.length === 500 ? events.at(-1)!.seq : null };
    return { data: overrides(page, calls.length), error: null };
  };
  return { rpc, calls };
}

describe("the requester's own legal audit slice", () => {
  it("reads an empty slice as an empty list with the day attribution began", async () => {
    const { rpc, calls } = ledger(0);
    expect(await ownLegalAuditEvents(rpc, ACTOR)).toEqual({ attributionStartedAt: STARTED, events: [] });
    expect(calls).toEqual([{ name: "own_legal_audit_events_v1", p_account_id: ACTOR.accountId,
      p_session_id: ACTOR.sessionId, p_after_seq: null }]);
  });

  it("reads a slice larger than one page completely, in order, once each", async () => {
    const { rpc, calls } = ledger(1003);
    const slice = (await ownLegalAuditEvents(rpc, ACTOR))!;
    expect(slice.events).toHaveLength(1003);
    expect(new Set(slice.events.map(row => row.seq)).size).toBe(1003);
    expect(calls.map(call => call.p_after_seq)).toEqual([null, slice.events[499].seq, slice.events[999].seq]);
  });

  it.each([
    ["a failed read", () => ({ data: null, error: { message: "unavailable" } })],
    ["the pseudonym in a row", (page: Record<string, unknown>) => ({ data: { ...page,
      events: (page.events as object[]).map(row => ({ ...row, audit_principal_id: "33333333-3333-4333-8333-333333333333" })) }, error: null })],
    ["a chain hash in a row", (page: Record<string, unknown>) => ({ data: { ...page,
      events: (page.events as object[]).map(row => ({ ...row, row_hash: "\\x00" })) }, error: null })],
    ["an unknown field on the page", (page: Record<string, unknown>) => ({ data: { ...page, accountId: ACTOR.accountId }, error: null })],
  ])("refuses %s", async (_, answer) => {
    const base = ledger(3);
    const rpc = async (name: string, args: Record<string, unknown>) => {
      const { data } = await base.rpc(name, args);
      return answer(data as Record<string, unknown>);
    };
    expect(await ownLegalAuditEvents(rpc, ACTOR)).toBeNull();
  });

  it("refuses a page that repeats or reorders the ledger", async () => {
    const repeated = ledger(1003, (page, call) => call === 2
      ? { ...page, events: [event(10), ...(page.events as object[]).slice(1)] } : page);
    expect(await ownLegalAuditEvents(repeated.rpc, ACTOR)).toBeNull();
    const short = ledger(1003, (page, call) => call === 1 ? { ...page, events: (page.events as object[]).slice(0, 499) } : page);
    expect(await ownLegalAuditEvents(short.rpc, ACTOR)).toBeNull();
  });

  it("refuses when the day attribution began changes between pages", async () => {
    const moved = ledger(1003, (page, call) => call === 2 ? { ...page, attributionStartedAt: "2026-09-29T00:00:00.000+00:00" } : page);
    expect(await ownLegalAuditEvents(moved.rpc, ACTOR)).toBeNull();
  });
});
