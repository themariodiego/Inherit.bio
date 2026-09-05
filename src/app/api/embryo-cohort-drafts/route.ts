import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { hmacSecret } from "@/lib/crypto";
import { invalidRequest, rpcErrorResponse, unavailable } from "@/lib/embryos/api";
import { basisCaseFor, uploadSituationValue } from "@/lib/embryos/basis";
import {
  closedResponse,
  csrfOperation,
  encryptedLiteral,
  jurisdictionDenied,
  originDenied,
  readJson,
  requestForbidden,
  unauthorized,
} from "@/lib/embryos/guards";
import {
  COHORT_DRAFT_CREATED_KEYS,
  cohortDraftBody,
  cohortDraftCreated,
  draftContacts,
  draftRequestIssues,
  normalizeContact,
} from "@/lib/embryos/routes";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * `POST /api/embryo-cohort-drafts` (register api.embryo-cohort-drafts;
 * contract §6.1). Reserves one no-data, no-analysis cohort draft: the
 * situation, the basis, the embryo count and exactly the parent contacts
 * the basis derives. The acting account is the owner and, for its own
 * embryos, one genetic parent; for a third-party upload it is never a
 * parent. Every contact is normalised, keyed and encrypted here and read
 * back only by the mail worker. The one-time token in `x-inherit-csrf`
 * binds the request to this account and session; only its nonce reaches
 * the RPC, which records it before any write.
 */
export async function POST(request: Request) {
  const context = await getSensitiveAccountContext();
  if (!context?.user.email) return unauthorized();
  const forbidden = originDenied(request);
  if (forbidden) return forbidden;
  const denied = jurisdictionDenied();
  if (denied) return denied;

  const parsed = cohortDraftBody.safeParse(await readJson(request));
  if (!parsed.success) return invalidRequest(["body"]);
  const issues = draftRequestIssues(parsed.data, context.user.email);
  if (issues.length > 0) return invalidRequest(issues);

  const claims = csrfOperation(request, {
    accountId: context.user.id,
    sessionId: context.sessionId,
    operation: "cohort_draft_create",
    targetKind: "account",
    targetId: context.user.id,
  });
  if (!claims) return requestForbidden();

  const owner = normalizeContact(context.user.email);
  const contacts = draftContacts(parsed.data);
  const { data, error } = await createAdminClient().rpc("create_embryo_cohort_draft_v1", {
    p_account_id: context.user.id,
    p_session_id: context.sessionId,
    p_upload_situation: uploadSituationValue(parsed.data.uploadSituation),
    p_basis_case: basisCaseFor(parsed.data.basis),
    p_embryo_count: parsed.data.embryoCount,
    p_owner_contact_ciphertext: encryptedLiteral(owner),
    p_owner_contact_hmac: hmacSecret(owner, "contact-email-v1"),
    p_contact_ciphertexts: contacts.map(encryptedLiteral),
    p_contact_hmacs: contacts.map((contact) => hmacSecret(contact, "contact-email-v1")),
    p_token_nonce: claims.nonce,
    p_test_jurisdiction: true,
  });
  if (error) return rpcErrorResponse(error);
  const row = data?.[0];
  if (!row) return unavailable();

  return closedResponse("api.embryo-cohort-drafts", COHORT_DRAFT_CREATED_KEYS, cohortDraftCreated(row), 201);
}
