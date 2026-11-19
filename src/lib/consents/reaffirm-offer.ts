import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { mintReaffirmPresentation, reaffirmOfferSchema } from "./reaffirm-presentation";

/**
 * The reaffirmation a page may offer for one prior purpose grant, or null.
 * The database decides whether anything is offered (the signed text has been
 * superseded by a current version of the same key) and returns the exact
 * binding; this only signs it for the live account and auth session. No page
 * renders an offer yet: its wording is not approved (owner decision
 * 2026-10-22), so nothing here invents it.
 */
export async function consentReaffirmOffer(accountId: string, sessionId: string, priorGrantId: string) {
  const { data, error } = await createAdminClient().rpc("consent_reaffirm_offer_v1", {
    p_account_id: accountId, p_session_id: sessionId, p_prior_grant_id: priorGrantId,
  });
  if (error || data === null) return null;
  const offer = reaffirmOfferSchema.safeParse(data);
  if (!offer.success || offer.data.priorGrantId !== priorGrantId) return null;
  const { claims, token } = mintReaffirmPresentation({ accountId, sessionId, offer: offer.data });
  return { token, artifactVersion: claims.offer.artifactVersion, statementKeys: claims.offer.statementKeys,
    artifactKey: claims.offer.artifactKey, purposeKey: claims.offer.purpose };
}
