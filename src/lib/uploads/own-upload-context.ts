import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { OwnAccountCompletionPresentation } from "./own-consent-token";

const revision = z.number().int().positive().safe();
export const ownUploadContextSchema = z.object({
  accountRevision: revision, authSessionRevision: revision, jurisdictionRevision: revision,
  subjectBindingRevision: revision, accountBindingRevision: revision,
  birthDateState: z.enum(["missing", "adult", "underage"]),
}).strict();

/** Resolve cryptographically validated claims, not a parsed cookie or metadata assertion. */
export async function currentOwnUploadAccount() {
  const client = await createClient();
  const [{ data: userData }, { data: claimsData }] = await Promise.all([
    client.auth.getUser(), client.auth.getClaims(),
  ]);
  const claims = claimsData?.claims;
  if (!userData.user || claims?.sub !== userData.user.id
    || typeof claims.session_id !== "string") return null;
  return { accountId: userData.user.id, sessionId: claims.session_id };
}

export function ownSnapshotArgs(snapshot: Omit<OwnAccountCompletionPresentation, "nonce" | "issuedAt" | "expiresAt">) {
  return {
    p_account_id: snapshot.accountId, p_session_id: snapshot.sessionId, p_subject_id: snapshot.subjectId,
    p_account_revision: snapshot.accountRevision, p_auth_session_revision: snapshot.authSessionRevision,
    p_jurisdiction_revision: snapshot.jurisdictionRevision,
    p_subject_binding_revision: snapshot.subjectBindingRevision,
    p_account_binding_revision: snapshot.accountBindingRevision,
  };
}

export function ownUploadJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: {
    "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store",
    "Vercel-CDN-Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
  } });
}
