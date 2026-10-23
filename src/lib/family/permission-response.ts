import { z } from "zod";
import type { CsrfHandle } from "@/lib/security/session-csrf-client";
import type { GrantPurposeRequest } from "./grant-token";

export type PermissionAction =
  | { kind: "grant"; request: GrantPurposeRequest }
  /** `nonce` is the one-time nonce the page rendered for this grant's revocation (G5.6, 23 Oct 2026). */
  | { kind: "revoke"; grantId: string; nonce: string };

/** The one-time X-Inherit-CSRF tokens of the two routes a permission row sends to. */
export interface PermissionCsrf { grant: CsrfHandle; revoke: CsrfHandle }

/** Consume the exact operation receipt before a refresh can replace this row. */
export async function submitFamilyPermission(action: PermissionAction, csrf: PermissionCsrf): Promise<boolean> {
  const response = action.kind === "grant"
    ? await fetch("/api/consents", { method: "POST", headers: { "content-type": "application/json",
      "X-Inherit-CSRF": csrf.grant.value() }, body: JSON.stringify(action.request) })
    : await fetch(`/api/consents/${action.grantId}/revoke`, { method: "POST",
      headers: { "X-Inherit-Operation-Nonce": action.nonce, "X-Inherit-CSRF": csrf.revoke.value() } });
  (action.kind === "grant" ? csrf.grant : csrf.revoke).accept(response);
  const receipt: unknown = await response.json().catch(() => null);
  if (action.kind === "revoke") {
    return response.status === 200 && z.object({ revoked: z.literal(true), effectiveAt: z.iso.datetime() })
      .strict().safeParse(receipt).success;
  }
  return response.status === 201 && z.object({
    recordKind: z.literal("purpose_grant"), recordId: z.uuid(),
    artifactKey: z.literal("consent.share-with-adult"), artifactVersion: z.literal(action.request.artifactVersion),
    purposeKey: z.literal(action.request.purposeKey), signedAt: z.iso.datetime(),
  }).strict().safeParse(receipt).success;
}
