import { z } from "zod";
import { familyCapability } from "@/lib/family/access";
import { invalidRequest, notFound, unavailable } from "@/lib/embryos/api";
import { closedResponse, originDenied, readJson, unauthorized } from "@/lib/embryos/guards";
import { isTestJurisdictionEnabled } from "@/lib/legal/jurisdictions";
import { readReaffirmPresentation, type ReaffirmOffer } from "@/lib/consents/reaffirm-presentation";
import { isJsonRequest } from "@/lib/subject-endpoints/request";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";
import { currentOwnUploadAccount } from "@/lib/uploads/own-upload-context";

/**
 * `POST /api/consents/reaffirm` (register api.consent-reaffirm; owner
 * decision 2026-10-22, "Reaffirmation"). A signed-in person signs the current
 * version of a consent text they signed before, for the same purpose grant.
 *
 * It is offered only when the prior row's text has been superseded by a
 * current version of the same key, and only for an own-subject self grant or
 * an adult directional grant under consent.share-with-adult whose signer is
 * this account's own data subject. The body names the prior row and carries
 * the presentation token minted from the database's offer; nothing in it can
 * name a signer, subject, recipient, artifact or purpose (the closed body
 * refuses the register's forbiddenFields like any other unknown key).
 * `reaffirm_purpose_grant_v1` recomputes the offer, requires it unchanged,
 * supersedes the prior pair and re-runs the grant function that wrote it in
 * the same transaction, so access has no gap and the successor pair carries
 * one identical new grant revision.
 *
 * A family purpose is checked here exactly as api.consents checks it before
 * a grant. A Path B grant answers only under TEST-LOCAL. A donor-attribution
 * or any other artifact signature, an embryo grant, an own Copilot grant and
 * any stale, foreign or mismatched prior row answer resource-not-found-v1.
 * No covered signature is Tier 2, so a typed name is refused.
 */

const body = z.object({
  priorConsentId: z.uuid().regex(/^[0-9a-f-]+$/),
  artifactVersion: z.number().int().positive().safe(),
  artifactPresentationToken: z.string().min(16).max(8192),
  affirmed: z.literal(true),
  statementKeys: z.array(z.string().min(1).max(64)).min(1).max(16),
  typedName: z.string().min(1).max(200).optional(),
}).strict();

const RECEIPT = z.object({
  recordKind: z.literal("purpose_grant"), recordId: z.uuid(), artifactKey: z.string(),
  artifactVersion: z.number().int().positive().safe(), purposeKey: z.string(), signedAt: z.string(),
}).strict();
const RECEIPT_KEYS = ["recordKind", "recordId", "artifactKey", "artifactVersion", "purposeKey", "signedAt"] as const;

/** The checks api.consents makes before the same family grant, by purpose. */
async function familyPermitted(accountId: string, offer: ReaffirmOffer): Promise<boolean> {
  const recipient = offer.recipientAccountId;
  if (!recipient) return false;
  const needs: Parameters<typeof familyCapability>[2][] = [];
  if (["ancestry", "reports.monogenic", "reports.polygenic", "family.portrait", "family.heritability"].includes(offer.purpose)) {
    needs.push("third_party_adult_analysis");
  }
  if (offer.purpose === "family.portrait") needs.push("family_portrait");
  if (offer.purpose === "family.heritability") needs.push("family_heritability");
  if (offer.purpose === "copilot.local") needs.push("third_party_adult_analysis", "family_heritability");
  for (const capability of needs) {
    if ((await familyCapability(accountId, [recipient], capability)).status !== "permitted") return false;
  }
  return true;
}

export async function POST(request: Request) {
  const actor = await currentOwnUploadAccount();
  if (!actor) return unauthorized();
  const forbidden = originDenied(request);
  if (forbidden) return forbidden;
  if (!isJsonRequest(request)) return invalidRequest(["content-type"]);
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) {
    const fields = new Set(["priorConsentId", "artifactVersion", "artifactPresentationToken", "affirmed", "statementKeys", "typedName"]);
    const issues = [...new Set(parsed.error.issues.map(issue =>
      typeof issue.path[0] === "string" && fields.has(issue.path[0]) ? issue.path[0] : "body"))];
    return invalidRequest(issues.length > 0 ? issues : ["body"]);
  }
  const value = parsed.data;
  if (value.typedName !== undefined) return invalidRequest(["typedName"]);

  const claims = readReaffirmPresentation(value.artifactPresentationToken);
  if (!claims || claims.accountId !== actor.accountId || claims.sessionId !== actor.sessionId
    || claims.offer.priorGrantId !== value.priorConsentId || claims.offer.artifactVersion !== value.artifactVersion) {
    return notFound();
  }
  const published = claims.offer.statementKeys;
  if (value.statementKeys.length !== published.length || value.statementKeys.some((key, index) => key !== published[index])) {
    return invalidRequest(["statementKeys"]);
  }
  const testJurisdiction = isTestJurisdictionEnabled();
  if (claims.offer.kind === "path-b" && !testJurisdiction) return notFound();
  if (claims.offer.kind === "family" && !(await familyPermitted(actor.accountId, claims.offer))) return notFound();

  const { data, error } = await createAdminClient().rpc("reaffirm_purpose_grant_v1", {
    p_account_id: actor.accountId,
    p_session_id: actor.sessionId,
    p_prior_grant_id: value.priorConsentId,
    p_offer: claims.offer as unknown as Json,
    p_nonce: claims.nonce,
    p_expires_at: new Date(claims.expiresAt).toISOString(),
    p_test_jurisdiction: testJurisdiction,
  });
  if (error) {
    if (error.code === "22023") return invalidRequest(["body"]);
    if (error.code === "42501" || error.code === "23505" || error.code === "55000") return notFound();
    return unavailable();
  }
  const receipt = RECEIPT.safeParse(data);
  if (!receipt.success || receipt.data.purposeKey !== claims.offer.purpose
    || receipt.data.artifactKey !== claims.offer.artifactKey
    || receipt.data.artifactVersion !== claims.offer.artifactVersion) return unavailable();
  const signedAt = new Date(receipt.data.signedAt);
  if (Number.isNaN(signedAt.getTime())) return unavailable();
  return closedResponse("api.consent-reaffirm", RECEIPT_KEYS, { ...receipt.data, signedAt: signedAt.toISOString() }, 201);
}
