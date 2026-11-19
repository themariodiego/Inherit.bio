import { blockedResponse, notFound } from "@/lib/embryos/api";
import { closedResponse, readJson } from "@/lib/embryos/guards";
import { deliveryCard, parseRpcCards, type DeliveryCard } from "@/lib/embryos/record-key-cards";
import { readRecordKeyCardsRightsRequest } from "@/lib/embryos/record-key-cards-rights";
import { recordKeyCardsBody } from "@/lib/embryos/routes";
import { isTestJurisdictionEnabled } from "@/lib/legal/jurisdictions";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * `POST /api/rights/embryo-record-key-cards` (register
 * api.embryo-record-key-cards-rights). The no-account twin of
 * `POST /api/embryo-cohorts/[id]/record-key-cards`: one exact current
 * no-account Record Key recipient collects their own cards once, through
 * their rights session instead of an account session. The body is the
 * one-time form nonce the rights page served for that session, sent again in
 * `X-Inherit-CSRF`; the cohort, the recipient and every revision come from
 * the session in `deliver_embryo_record_key_cards_rights_v1`, never from the
 * request.
 *
 * The raw keys exist in this one response and nowhere else. Every failure,
 * including a missing, stale, consumed or non-recipient session, is the same
 * resource-not-found-v1. Embryo cohorts are TEST-LOCAL, so outside the test
 * jurisdiction this route is that 404 too. No issuer of the session purpose
 * exists yet, so the database refuses every request until one is built.
 */

const DELIVERY_KEYS = ["cohort_id", "recipient_set_revision", "key_revision", "record_key_cards"] as const;

export async function POST(request: Request) {
  if (!isTestJurisdictionEnabled()) return notFound();
  const parsed = recordKeyCardsBody.safeParse(await readJson(request));
  if (!parsed.success) return notFound();
  const authority = readRecordKeyCardsRightsRequest(request, parsed.data.nonce);
  if (!authority) return notFound();

  const { data, error } = await createAdminClient().rpc("deliver_embryo_record_key_cards_rights_v1", {
    p_session_hash: authority.sessionHash,
    p_nonce: authority.nonce,
  });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) return notFound();

  let cards: DeliveryCard[];
  try {
    cards = parseRpcCards(row.cards).map((card) => {
      if (!card.delivery_kind) throw new Error("delivery kind missing");
      return deliveryCard({ ...card, delivery_kind: card.delivery_kind });
    });
  } catch {
    // The keys are already committed for this recipient; a row that does not
    // fit the registered card is a defect and never reaches the body.
    return blockedResponse("api.embryo-record-key-cards-rights");
  }

  return closedResponse(
    "api.embryo-record-key-cards-rights",
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
