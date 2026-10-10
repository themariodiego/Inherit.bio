import "server-only";

import { z } from "zod";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { futurePersonClaimsOpen } from "@/lib/future-person/claims-open";
import { createAdminClient } from "@/lib/supabase/admin";
import { mintEmbryoOperation } from "./operation-token";
import { claimUrl } from "./record-key-cards";

const item = z.object({ cohortId: z.uuid(), cardCount: z.number().int().min(1).max(64) }).strict();
const inventory = z.object({ items: z.array(item).max(64), nextCursor: z.uuid().nullable() }).strict()
  .refine(value => new Set(value.items.map(row => row.cohortId)).size === value.items.length);

export type RecordKeyCardControl = z.infer<typeof item> & { nonce: string; claimUrl: string };
export type RecordKeyCardControls = { items: RecordKeyCardControl[]; nextCursor: string | null; unavailable: boolean };

/** Read only the acting recipient's current rights. A page load generates no
 * raw key, consumes no print right and never substitutes analysis permission. */
export async function recordKeyCardControls(after: string | null = null, now = Date.now()): Promise<RecordKeyCardControls | null> {
  if (!futurePersonClaimsOpen()) return null;
  const unavailable = { items: [], nextCursor: null, unavailable: true };
  if (after !== null && !z.uuid().safeParse(after).success) return unavailable;
  const account = await getSensitiveAccountContext();
  if (!account) return null;
  try {
    const result = await createAdminClient().rpc("embryo_record_key_card_controls_v1", {
      p_account: account.user.id, p_session: account.sessionId, p_after: after,
    });
    const parsed = inventory.safeParse(result.data);
    if (result.error || !parsed.success) return unavailable;
    const url = claimUrl();
    return {
      items: parsed.data.items.map(row => ({ ...row, claimUrl: url, nonce: mintEmbryoOperation({
        accountId: account.user.id, sessionId: account.sessionId, operation: "record_key_print",
        targetKind: "cohort", targetId: row.cohortId,
      }, now) })),
      nextCursor: parsed.data.nextCursor, unavailable: false,
    };
  } catch { return unavailable; }
}
