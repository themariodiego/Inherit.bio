import { z } from "zod";
import { notFound } from "@/lib/embryos/api";
import { closedResponse, encryptedLiteral, readJson } from "@/lib/embryos/guards";
import { jurisdictionChoices } from "@/lib/legal/jurisdiction-declaration";
import { isTestJurisdictionEnabled } from "@/lib/legal/jurisdictions";
import { createAdminClient } from "@/lib/supabase/admin";
import { readAdultSubjectControlRequest } from "@/lib/uploads/adult-subject-control";
import {
  GRANT_RIGHTS_PURPOSES,
  GRANT_RIGHTS_STATEMENT_KEYS,
  presentationForDatabase,
  readGrantRightsPresentation,
} from "@/lib/uploads/grant-rights-presentation";
import { isExactKeys, otherAdultTypedNameIsValid } from "@/lib/uploads/other-adult-upload";

/**
 * `POST /api/consents/grant/session` (register api.consent-grant-rights). A
 * person who confirmed a Path B request with no account turns on one
 * individual purpose for the person who added their file, through their
 * adult-subject-control rights session. They sign consent.share-with-adult
 * with a typed name and their own declared country; they do not become a
 * result recipient. The body cannot name a subject, account, principal,
 * recipient or relationship: the signer and data subject are the session
 * principal, the recipient is the immutable Path B uploader, and every
 * revision comes from the presentation token the rights page minted, which
 * `grant_purpose_rights_v1` rechecks against current state and consumes.
 *
 * The register's jurisdictionAttestationVersion and jurisdictionAttestationHash
 * are not taken: docs/route-divergence.json (unhashableAttestationFields)
 * records this route as serving a plain jurisdictionCode instead, by owner
 * decision (2026-09-13, reaffirmed 2026-10-16; D-083), so the closed body
 * refuses them like any other unknown field.
 *
 * Every failure is the same resource-not-found-v1, and so is any request
 * outside the test jurisdiction (Path B is TEST-LOCAL). The database refuses
 * every request until an adult-subject-control issuer exists. It also runs
 * other-adult-mitigation-state-v1 at purpose-grant-create, which allows the
 * uploader of a no-account subject only while a 730-day clock is live and
 * before the 30-day re-notice boundary (owner decision 2026-10-22,
 * 20261016204000). copilot.local is accepted by the closed body and refused
 * by the database until a Path B Copilot scope exists.
 */

const body = z.object({
  purposeKey: z.enum(GRANT_RIGHTS_PURPOSES),
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
  const authority = readAdultSubjectControlRequest(request, parsed.data.nonce);
  if (!authority) return notFound();
  const value = parsed.data;
  const presentation = readGrantRightsPresentation(value.artifactPresentationToken);
  if (!presentation || presentation.sessionHash !== authority.sessionHash
    || presentation.purpose !== value.purposeKey || presentation.artifactVersion !== value.artifactVersion
    || !isExactKeys(value.statementKeys, GRANT_RIGHTS_STATEMENT_KEYS)
    || !otherAdultTypedNameIsValid(value.typedName)
    || !jurisdictionChoices().some(choice => choice.code === value.jurisdictionCode)) return notFound();

  const { data, error } = await createAdminClient().rpc("grant_purpose_rights_v1", {
    p_session_hash: authority.sessionHash,
    p_nonce: authority.nonce,
    p_presentation: presentationForDatabase(presentation),
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
  return closedResponse("api.consent-grant-rights", RECEIPT_KEYS,
    { ...receipt.data, signedAt: signedAt.toISOString() }, 201);
}
