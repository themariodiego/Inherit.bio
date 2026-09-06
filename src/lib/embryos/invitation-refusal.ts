import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { mintPublicFormToken, readPublicFormToken } from "./operation-token";
import { readRightsSessionHash, RIGHTS_COOKIE_NAME } from "./rights-session";

export const invitationRefusalBody = z.object({
  operation: z.literal("refuse"),
  nonce: z.string().min(1).max(2_048),
}).strict();

export function refusalRequestAllowed(request: Request): boolean {
  return request.method === "POST" && new URL(request.url).search === ""
    && request.headers.get("origin") === new URL(request.url).origin
    && request.headers.get("sec-fetch-site") === "same-origin"
    && request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() === "application/json";
}

export function readInvitationRefusal(request: Request, nonce: string, now = Date.now()) {
  if (!refusalRequestAllowed(request)) return null;
  const cookies = (request.headers.get("cookie") ?? "").split(";")
    .filter(part => part.trim().split("=")[0] === RIGHTS_COOKIE_NAME);
  if (cookies.length !== 1) return null;
  const sessionHash = readRightsSessionHash(request);
  if (!sessionHash) return null;
  const claims = readPublicFormToken(nonce, "invitation-refuse", now, sessionHash);
  return claims ? { sessionHash, nonce: claims.nonce } : null;
}

/** No account, draft, contact, participant count or signature is returned. */
export async function loadInvitationRefusal(request: Request, now = Date.now()) {
  const sessionHash = readRightsSessionHash(request);
  if (!sessionHash) return null;
  const { data, error } = await createAdminClient().rpc("read_co_parent_refusal_v1", {
    p_session_hash: sessionHash,
  });
  if (error) return null;
  if (data === "done") return { kind: "done" as const };
  if (data !== "ready") return null;
  return { kind: "ready" as const, nonce: mintPublicFormToken("invitation-refuse", now, sessionHash) };
}
