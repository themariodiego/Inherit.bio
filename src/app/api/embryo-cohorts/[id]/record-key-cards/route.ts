import { z } from "zod";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { blockedResponse, notFound } from "@/lib/embryos/api";
import { closedResponse, originDenied, readJson, unauthorized } from "@/lib/embryos/guards";
import { verifyEmbryoOperation } from "@/lib/embryos/operation-token";
import { deliveryCard, parseRpcCards, type DeliveryCard } from "@/lib/embryos/record-key-cards";
import { recordKeyCardsBody } from "@/lib/embryos/routes";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * `POST /api/embryo-cohorts/[id]/record-key-cards` (register
 * api.embryo-record-key-cards; contract §6.6). One Record Key recipient
 * collects their own cards once: the RPC requires a recent session (MFA
 * when enrolled), consumes the body nonce, generates one key per covered
 * embryo, stores only the hashes and consumes the print rights. The raw
 * keys exist in this one response and nowhere else. Anything that is not
 * exactly a current recipient with unconsumed rights is the same 404.
 */

const DELIVERY_KEYS = ["cohort_id", "recipient_set_revision", "key_revision", "record_key_cards"] as const;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return notFound();
  const account = await getSensitiveAccountContext();
  if (!account) return unauthorized();
  const forbidden = originDenied(request);
  if (forbidden) return forbidden;

  const parsed = recordKeyCardsBody.safeParse(await readJson(request));
  if (!parsed.success) return notFound();
  const claims = verifyEmbryoOperation(parsed.data.nonce, {
    accountId: account.user.id,
    sessionId: account.sessionId,
    operation: "record_key_print",
    targetKind: "cohort",
    targetId: id,
  });
  if (!claims) return notFound();

  const { data, error } = await createAdminClient().rpc("deliver_embryo_record_key_cards_v1", {
    p_account_id: account.user.id,
    p_session_id: account.sessionId,
    p_cohort_id: id,
    p_token_nonce: claims.nonce,
  });
  const row = data?.[0];
  if (error || !row) return notFound();

  let cards: DeliveryCard[];
  try {
    cards = parseRpcCards(row.cards).map((card) => {
      if (!card.delivery_kind) throw new Error("delivery kind missing");
      return deliveryCard({ ...card, delivery_kind: card.delivery_kind });
    });
  } catch {
    // The keys are already committed for this recipient; a row that does
    // not fit the registered card is a defect and never reaches the body.
    return blockedResponse("api.embryo-record-key-cards");
  }

  return closedResponse(
    "api.embryo-record-key-cards",
    DELIVERY_KEYS,
    {
      cohort_id: row.cohort_id,
      recipient_set_revision: row.recipient_set_revision,
      key_revision: row.key_revision,
      record_key_cards: cards,
    },
    200,
  );
}
