import "server-only";

import crypto from "node:crypto";

/**
 * D-081(a): `adultInvitationAvailable` lived here and was called from
 * `/withdraw/[token]` on a plain GET, which made a mailed URL an oracle for
 * whether its token was still live. It had exactly one caller and nothing
 * read its result but the rendering, so it is removed rather than left for
 * the next page to reach for. The POST path resolves the hash itself.
 */

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function adultInvitationTokenHash(token: string): string | null {
  if (!TOKEN.test(token)) return null;
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}
