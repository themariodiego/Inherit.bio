import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { correctionScope } from "./correction-case-envelope";
import { claimantCsrf, claimantSessionHash } from "./rights";
import { appealKeyedDigests } from "./appeal-keyed-digests";
import { normalizeContact } from "@/lib/embryos/routes";
import { openMailContact, sealClaimantContact } from "./claimant-contact";
import { readCorrectionIntakeNonce } from "./correction-intake-nonce";
import type { CorrectionIntakeRuntime } from "./correction-intake-runtime";

const hash = z.string().regex(/^[0-9a-f]{64}$/u);
const revision = z.number().int().positive().safe();
export const correctionPrepareFrame = z.object({ scope: correctionScope, rightsSessionId: z.uuid(),
  authorityRevision: revision, tokenHashId: z.uuid(), reviewerPrincipalId: z.uuid(),
  reviewerPrincipalRevision: revision, assignmentRevision: z.literal(1),
  sourceContactReferenceId: z.uuid(), sourceContactFingerprint: hash, caseContactId: z.uuid() }).strict();

export function correctionIntakeMutation(request: Request, token: string, now = Date.now()) {
  const sessionHash = claimantSessionHash(request), url = new URL(request.url), csrf = request.headers.get("x-inherit-csrf");
  if (!sessionHash || !Number.isSafeInteger(now) || now < 0 || token.length > 2048 || url.search
    || request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") !== "same-origin"
    || !csrf || !/^[0-9a-f]{64}$/u.test(csrf)) return null;
  let actual: Buffer | undefined, expected: Buffer | undefined;
  try {
    actual = Buffer.from(csrf, "utf8"); expected = Buffer.from(claimantCsrf(sessionHash), "utf8");
    if (!crypto.timingSafeEqual(actual, expected)) return null;
    const nonce = readCorrectionIntakeNonce(token, sessionHash, now);
    return nonce ? { sessionHash, nonce } : null;
  } finally { actual?.fill(0); expected?.fill(0); }
}

const contactRead = z.object({ caseContactId: z.uuid(),
  sourceContactCiphertextHex: z.string().regex(/^(?:[0-9a-f]{2}){29,16384}$/u) }).strict();
/** Clone only current native-selected ciphertext under its exact fingerprint.
 * The existing contact envelope format and shared claimant contact stay exact.
 * Legacy helper copies, immutable strings and platform disposal remain held. */
export function sealNewCorrectionContact(raw: unknown, expectedFrame: z.infer<typeof correctionPrepareFrame>, owner: CorrectionIntakeRuntime) {
  const selected = contactRead.parse(raw);
  if (selected.caseContactId !== expectedFrame.caseContactId) throw new Error("correction_unavailable");
  const bytes = owner.own(Buffer.from(selected.sourceContactCiphertextHex, "hex"));
  let address = "", digest: Buffer | undefined;
  try {
    owner.assertOpen(); digest = crypto.createHash("sha256").update(bytes).digest();
    if (digest.toString("hex") !== expectedFrame.sourceContactFingerprint) throw new Error("correction_unavailable");
    address = normalizeContact(openMailContact(bytes)); owner.assertOpen();
    return { ciphertext: sealClaimantContact(selected.caseContactId, address), hmacSet: appealKeyedDigests("contact", address) };
  } finally { address = ""; digest?.fill(0); owner.clear(bytes); }
}
