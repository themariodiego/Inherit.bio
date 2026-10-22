import "server-only";
import { z } from "zod";

/**
 * `legal-audit.json`: the legal audit events a person caused themselves (L-34;
 * owner decision, 28 Sep 2026, option A of docs/export-legal-audit-resolver.md).
 *
 * The selection is the database's, not this module's.
 * `public.own_legal_audit_events_v1` checks the same account and session gate
 * as the rest of the export, then returns only events whose actor is this
 * account's own audit pseudonym. An event names an actor only when its
 * transaction proved one (a consumed session-bound nonce or the person's own
 * JWT) and only on the closed list of events a person causes, so events
 * written before attribution began, events the service caused and events
 * other people caused never appear. The pseudonym and the chain hashes never
 * leave.
 *
 * Every page is parsed against a closed shape and must continue the ledger in
 * order. Any failure returns null and the export answers 503 rather than
 * shipping a file that understates what the ledger holds.
 */

export const LEGAL_AUDIT_SCHEMA_VERSION = "legal-audit-v1";

export const legalAuditEventSchema = z.object({
  seq: z.number().int().positive().safe(),
  occurred_at: z.string().min(1),
  event_code: z.string().regex(/^[a-z][a-z0-9_.-]{2,79}$/),
  route_id: z.string().regex(/^[a-z][a-z0-9_.-]{2,99}$/).nullable(),
  outcome_code: z.string().regex(/^[a-z][a-z0-9_.-]{1,63}$/),
  coded_context: z.record(z.string(), z.unknown()),
}).strict();

const pageSchema = z.object({
  version: z.literal("legal-audit-slice-v1"),
  attributionStartedAt: z.string().min(1),
  events: z.array(legalAuditEventSchema).max(500),
  nextAfterSeq: z.number().int().positive().safe().nullable(),
}).strict();

export type LegalAuditEvent = z.infer<typeof legalAuditEventSchema>;
export type LegalAuditSlice = { attributionStartedAt: string; events: LegalAuditEvent[] };

type Actor = { accountId: string; sessionId: string };
type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;

/** Every event this account caused itself, in ledger order, or null. */
export async function ownLegalAuditEvents(rpc: Rpc, actor: Actor): Promise<LegalAuditSlice | null> {
  const events: LegalAuditEvent[] = [];
  let startedAt: string | null = null;
  let after: number | null = null;
  // A page holds at most 500 events, so this bound is far past any account.
  for (let pages = 0; pages < 100_000; pages++) {
    const { data, error } = await rpc("own_legal_audit_events_v1",
      { p_account_id: actor.accountId, p_session_id: actor.sessionId, p_after_seq: after });
    if (error) return null;
    const parsed = pageSchema.safeParse(data);
    if (!parsed.success) return null;
    const page = parsed.data;
    if (startedAt !== null && page.attributionStartedAt !== startedAt) return null;
    startedAt = page.attributionStartedAt;
    for (const event of page.events) {
      if (event.seq <= (events.at(-1)?.seq ?? after ?? 0)) return null;
      events.push(event);
    }
    if (page.nextAfterSeq === null) return { attributionStartedAt: startedAt, events };
    if (page.events.length !== 500 || page.nextAfterSeq !== events.at(-1)?.seq) return null;
    after = page.nextAfterSeq;
  }
  return null;
}
