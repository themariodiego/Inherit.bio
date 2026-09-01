import "server-only";

import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function adultInvitationTokenHash(token: string): string | null {
  if (!TOKEN.test(token)) return null;
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export async function adultInvitationAvailable(token: string): Promise<boolean> {
  const hash = adultInvitationTokenHash(token);
  if (!hash) return false;
  const { data, error } = await createAdminClient().rpc(
    "resolve_adult_subject_invitation_v1",
    { p_token_hash: hash },
  );
  return !error && data?.[0]?.state === "available";
}
