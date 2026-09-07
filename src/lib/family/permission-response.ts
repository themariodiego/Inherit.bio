import { z } from "zod";
import type { GrantPurposeRequest } from "./grant-token";

export type PermissionAction =
  | { kind: "grant"; request: GrantPurposeRequest }
  | { kind: "revoke"; grantId: string };

/** Consume the exact operation receipt before a refresh can replace this row. */
export async function submitFamilyPermission(action: PermissionAction): Promise<boolean> {
  const response = action.kind === "grant"
    ? await fetch("/api/consents", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(action.request) })
    : await fetch(`/api/consents/${action.grantId}/revoke`, { method: "POST" });
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
