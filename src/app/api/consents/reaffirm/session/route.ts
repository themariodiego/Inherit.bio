import { z } from "zod";
import { notFound } from "@/lib/embryos/api";
import { closedResponse, encryptedLiteral, readJson } from "@/lib/embryos/guards";
import { jurisdictionChoices } from "@/lib/legal/jurisdiction-declaration";
import { isTestJurisdictionEnabled } from "@/lib/legal/jurisdictions";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  REAFFIRM_RIGHTS_STATEMENT_KEYS,
  readConsentReaffirmRightsRequest,
  readReaffirmRightsPresentation,
  reaffirmRightsPresentationForDatabase,
} from "@/lib/consents/reaffirm-rights";
import { isExactKeys, otherAdultTypedNameIsValid } from "@/lib/uploads/other-adult-upload";

/**
 * `POST /api/consents/reaffirm/session` (register api.consent-reaffirm-rights;
 * owner decision 2026-10-22, "Reaffirmation"). The no-account twin of
 * api.consent-reaffirm: a person who confirmed a Path B request with no
 * account signs the current version of consent.share-with-adult for the
 * uploader-direction grant they signed before, through a consent-reaffirm
 * rights session bound to that prior grant and its revision.
 *
 * BUILT CLOSED. The credential that would open such a session is a mailed
 * notice whose wording is not approved, so its issuer is not built and no
 * session purpose is registered: `reaffirm_purpose_rights_v1` refuses every
 * request, and so does this route outside TEST-LOCAL. It sends nothing.
 *
 * The body cannot name a prior row, subject, account, principal, recipient or
 * relationship: the session decides them, and every revision comes from the
 * presentation the rights page would mint, which the database rechecks and
 * consumes. The register's jurisdictionAttestationVersion and
 * jurisdictionAttestationHash are not taken: docs/route-divergence.json
 * (unhashableAttestationFields) records this route as serving a plain
 * jurisdictionCode (owner decisions 2026-09-13 and 2026-10-16, D-083), so the
 * closed body refuses them like any other unknown field. Every failure is the
 * same resource-not-found-v1.
 */

const body = z.object({
  artifactVersion: z.number().int().positive().safe(),
  artifactPresentationToken: z.string().min(16).max(4096),
  affirmed: z.literal(true),
  statementKeys: z.array(z.string().min(1).max(64)).min(1).max(8),
  typedName: z.string().min(1).max(200),
  jurisdictionCode: z.string().regex(/^[A-Z]{2}$/),
  jurisdictionAffirmed: z.literal(true),
  nonce: z.string().min(16).max(8192),
}).strict();

const RECEIPT = z.object({
  recordKind: z.literal("purpose_grant"), recordId: z.uuid(), artifactKey: z.string(),
  artifactVersion: z.number().int().positive().safe(), purposeKey: z.string(), signedAt: z.string(),
}).strict();
const RECEIPT_KEYS = ["recordKind", "recordId", "artifactKey", "artifactVersion", "purposeKey", "signedAt"] as const;

export async function POST(request: Request) {
  if (!isTestJurisdictionEnabled()) return notFound();
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) return notFound();
  const authority = readConsentReaffirmRightsRequest(request, parsed.data.nonce);
  if (!authority) return notFound();
  const value = parsed.data;
  const presentation = readReaffirmRightsPresentation(value.artifactPresentationToken);
  if (!presentation || presentation.sessionHash !== authority.sessionHash
    || presentation.artifactVersion !== value.artifactVersion
    || !isExactKeys(value.statementKeys, REAFFIRM_RIGHTS_STATEMENT_KEYS)
    || !otherAdultTypedNameIsValid(value.typedName)
    || !jurisdictionChoices().some(choice => choice.code === value.jurisdictionCode)) return notFound();

  const { data, error } = await createAdminClient().rpc("reaffirm_purpose_rights_v1", {
    p_session_hash: authority.sessionHash,
    p_nonce: authority.nonce,
    p_presentation: reaffirmRightsPresentationForDatabase(presentation),
    p_statement_keys: [...value.statementKeys],
    p_signing_name_ciphertext: encryptedLiteral(value.typedName.trim()),
    p_jurisdiction_code: value.jurisdictionCode,
    p_test_jurisdiction: true,
  });
  const receipt = RECEIPT.safeParse(data);
  if (error || !receipt.success || receipt.data.purposeKey !== presentation.purpose
    || receipt.data.artifactVersion !== presentation.artifactVersion
    || receipt.data.artifactKey !== presentation.artifactKey) return notFound();
  const signedAt = new Date(receipt.data.signedAt);
  if (Number.isNaN(signedAt.getTime())) return notFound();
  return closedResponse("api.consent-reaffirm-rights", RECEIPT_KEYS,
    { ...receipt.data, signedAt: signedAt.toISOString() }, 201);
}
