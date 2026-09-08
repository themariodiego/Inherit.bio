import "server-only";
import { z } from "zod";
import type { Db } from "../genome/load";
import { currentOwnUploadAccount } from "../uploads/own-upload-context";
import { familyCapability } from "./access";
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const side = z.object({ subjectId: z.uuid(), hasPreparedSource: z.boolean(), hasLegacySource: z.boolean(), legacyFileIds: z.array(z.uuid()) }).strict();
const readiness = z.object({ kind: z.enum(["canonical", "legacy-only"]), receipt: hash, a: side, b: side }).strict()
  .refine(r => [r.a, r.b].every(side => new Set(side.legacyFileIds).size === side.legacyFileIds.length
    && side.hasLegacySource === (side.legacyFileIds.length > 0))
    && !r.a.legacyFileIds.some(id => r.b.legacyFileIds.includes(id)) && r.a.subjectId !== r.b.subjectId && (r.kind !== "legacy-only" || (!r.a.hasPreparedSource && !r.b.hasPreparedSource)));
type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
export type PortraitSourceState = Pick<z.infer<typeof readiness>, "kind" | "a" | "b">;
const capabilities = ["third_party_adult_analysis", "family_portrait"] as const;
async function permitted(accountId: string, counterpartId: string) {
  for (const capability of capabilities) if ((await familyCapability(accountId, [counterpartId], capability)).status !== "permitted") return false;
  return true;
}
export async function preparePortraitGrant(db: Db, subjectId: string, recipientAccountId: string): Promise<string | null> {
  try {
    const actor = await currentOwnUploadAccount();
    if (!actor || !await permitted(actor.accountId, recipientAccountId)) return null;
    const response = await (db.rpc.bind(db) as unknown as Rpc)("family_portrait_grant_presentation_v1", {
      p_account_id: actor.accountId, p_session_id: actor.sessionId, p_subject_id: subjectId, p_recipient_account_id: recipientAccountId,
    });
    const parsed = hash.safeParse(response.data);
    return !response.error && parsed.success ? parsed.data : null;
  } catch { return null; }
}
/** Pair membership is checked again in the RPC. IDs below are expectations from
 * the already-authorized page, never replacement principals or source selectors. */
export async function loadPortraitSourceReadiness(db: Db, options: {
  pairId: string; counterpartAccountId: string; subjectAId: string; subjectBId: string;
}): Promise<{ state: PortraitSourceState | null; confirm(): Promise<boolean> }> {
  const denied = { state: null, confirm: async () => false };
  try {
    if (!Object.values(options).every(id => z.uuid().safeParse(id).success)) return denied;
    const actor = await currentOwnUploadAccount();
    if (!actor || actor.accountId === options.counterpartAccountId || !await permitted(actor.accountId, options.counterpartAccountId)) return denied;
    const rpc = db.rpc.bind(db) as unknown as Rpc;
    const args = { p_account_id: actor.accountId, p_session_id: actor.sessionId, p_pair_id: options.pairId, p_counterpart_account_id: options.counterpartAccountId };
    const captured = await rpc("family_portrait_source_readiness_v1", args);
    const parsed = readiness.safeParse(captured.data);
    if (captured.error || !parsed.success || parsed.data.a.subjectId !== options.subjectAId || parsed.data.b.subjectId !== options.subjectBId) return denied;
    const snapshot = parsed.data;
    let closed = false;
    return { state: { kind: snapshot.kind, a: snapshot.a, b: snapshot.b }, confirm: async () => {
      if (closed) return false;
      try {
        const now = await currentOwnUploadAccount();
        if (!now || now.accountId !== actor.accountId || now.sessionId !== actor.sessionId || !await permitted(actor.accountId, options.counterpartAccountId)) {
          closed = true; return false;
        }
        // LAST await: both exact source/authority sets are locked in one RPC.
        const result = await rpc("family_portrait_source_readiness_v1", { ...args, p_expected: snapshot.receipt });
        const checked = readiness.safeParse(result.data);
        const valid = !result.error && checked.success && JSON.stringify(checked.data) === JSON.stringify(snapshot);
        if (!valid) closed = true;
        return valid;
      } catch { closed = true; return false; }
    } };
  } catch { return denied; }
}
