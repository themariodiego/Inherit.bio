import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { decryptSecret, encryptSecret, hmacSecret } from "@/lib/crypto";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { createClient } from "@/lib/supabase/server";
import { ownerObjectionView } from "./owner-objection";

const claims = z.object({ version: z.literal(1), operation: z.literal("owner-account-objection"),
  accountId: z.uuid(), authSessionId: z.uuid(), noticeId: z.uuid(), noticeRevision: z.number().int().positive().safe(),
  issuedAt: z.number().int().nonnegative().safe(), expiresAt: z.number().int().positive().safe(),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{32}$/u),
}).strict();
const accountRow = ownerObjectionView.extend({ noticeId: z.uuid(), noticeRevision: z.number().int().positive().safe() }).strict();
const inventory = z.object({ items: z.array(accountRow).max(64), nextCursor: z.uuid().nullable() }).strict()
  .refine(value => new Set(value.items.map(item => item.noticeId)).size === value.items.length);
type Account = Readonly<{ accountId: string; authSessionId: string }>;
export function mintOwnerAccountObjection(account: Account, notice: { noticeId: string; noticeRevision: number; noticeDeadline: string }, now = Date.now()) {
  const expiry = Math.min(now + 600_000, Date.parse(notice.noticeDeadline));
  if (!Number.isFinite(expiry) || expiry <= now) throw new Error("claim_notice_unavailable");
  const parsed = claims.parse({ version: 1, operation: "owner-account-objection", ...account,
    noticeId: notice.noticeId, noticeRevision: notice.noticeRevision, issuedAt: now, expiresAt: expiry,
    nonce: crypto.randomBytes(24).toString("base64url") });
  // The existing root authenticates a stateless form proof, not an identity,
  // account session or stored owner authority. Those are rechecked independently.
  const nonce = encryptSecret(JSON.stringify(parsed)).toString("hex");
  return { nonce, csrf: hmacSecret(nonce, "owner-account-objection-csrf-v1") };
}
export function readOwnerAccountObjection(request: Request, token: string, account: Account, now = Date.now()) {
  const url = new URL(request.url), csrf = request.headers.get("x-inherit-csrf");
  if (url.search || request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") !== "same-origin"
    || !/^[0-9a-f]{180,2048}$/u.test(token) || !csrf || !/^[0-9a-f]{64}$/u.test(csrf)
    || !crypto.timingSafeEqual(Buffer.from(csrf), Buffer.from(hmacSecret(token, "owner-account-objection-csrf-v1")))) return null;
  try {
    const parsed = claims.safeParse(JSON.parse(decryptSecret(Buffer.from(token, "hex"))));
    if (!parsed.success) return null;
    const proof = parsed.data;
    if (proof.accountId !== account.accountId || proof.authSessionId !== account.authSessionId || proof.issuedAt > now
      || proof.expiresAt <= now || proof.expiresAt > proof.issuedAt + 600_000 || proof.expiresAt > now + 600_000) return null;
    return proof;
  } catch { return null; }
}
export async function ownerAccountObjectionControls(after: string | null = null) {
  const account = await getSensitiveAccountContext(); if (!account) return null;
  if (after !== null && !z.uuid().safeParse(after).success) return { items: [], nextCursor: null, unavailable: true };
  try {
    // The caller's own JWT precedes every current-owner selector. No service
    // actor or mailed fragment can stand in for fresh account authentication.
    const { data, error } = await (await createClient()).rpc("future_person_owner_objection_controls_v1", { p_after: after });
    const parsed = inventory.safeParse(data); if (error || !parsed.success) return { items: [], nextCursor: null, unavailable: true };
    return { items: parsed.data.items.map(item => ({ summary: item.safeNoticeSummary, deadline: item.noticeDeadline,
      explanation: item.objectionArtifactBody, ...mintOwnerAccountObjection({ accountId: account.user.id, authSessionId: account.sessionId }, item) })),
      nextCursor: parsed.data.nextCursor, unavailable: false };
  } catch { return { items: [], nextCursor: null, unavailable: true }; }
}
