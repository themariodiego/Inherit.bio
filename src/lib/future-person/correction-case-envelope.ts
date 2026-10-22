import "server-only";

import crypto from "node:crypto";
import { z } from "zod";
import {unwrapNewCaseKey,newWrappedCaseKey,openNewCaseBytes,sealNewCaseBytes,newCaseHmac} from "@/lib/future-person/new-case-envelope-crypto";

/** NEW correction format only. This module supplies cryptography, not claimant,
 * reviewer, source-provenance, delivery, disposal or approval authority. */
export const correctionField = z.enum(["display-label", "disposition-record", "identity-match-profile", "report-provenance", "variant-call-source"]);
const revision = z.number().int().positive().safe();
const clock = z.iso.datetime({ offset: true });
const hexadecimal = z.string().regex(/^(?:[0-9a-f]{2})+$/u);
const prose = (maximum: number) => z.string().max(maximum * 4)
  .transform(value => value.normalize("NFC").trim())
  .refine(value => [...value].length >= 20 && [...value].length <= maximum
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value));
export const correctionStatement = prose(4000);
export const correctionReason = prose(2000);
export const correctionIntakeBody = z.object({ field: correctionField, statement: correctionStatement,
  nonce: z.string().min(1).max(2048) }).strict();

// Scope grammar and AAD retain the frozen prerequisite. Native SQL creates and
// persists these exact strings before sealing; JavaScript never picks a clock,
// principal, subject, reviewer or an original statement revision.
export const correctionScope = z.object({ version: z.literal(1), caseKind: z.literal("correction"),
  caseId: z.uuid(), originalAuthorPrincipalId: z.uuid(), initialStatementRevision: z.literal(1),
  originalSubmittedAt: clock, originalDeadline: clock,
  requestedField: correctionField, originalSubjectId: z.uuid() }).strict();
export type CorrectionScope = z.infer<typeof correctionScope>;
export function correctionStatementAad(raw: unknown): string {
  const s = correctionScope.parse(raw);
  return JSON.stringify(["reviewer-only-case-statement-v1", s.version, s.caseKind, s.requestedField,
    s.caseId, s.originalAuthorPrincipalId, s.initialStatementRevision,
    s.originalSubmittedAt, s.originalDeadline, s.originalSubjectId]);
}
export function correctionPackageAad(raw: unknown): string {
  return JSON.stringify(["reviewer-only-correction-working-package-v1", correctionStatementAad(raw)]);
}
const workingPackage = z.object({ version: z.literal(1), field: correctionField, statement: correctionStatement }).strict();
export const sealedCorrection = z.object({ format: z.literal("reviewer-only-case-statement-v1"),
  statementCiphertextHex: hexadecimal.min(96).max(32056),
  workingCiphertextHex: hexadecimal.min(96).max(32768), wrappedCaseKeyHex: hexadecimal.length(144) }).strict();
function sealedHex(key:Buffer,aad:string,bytes:Uint8Array){
 const sealed=sealNewCaseBytes(key,aad,bytes);try{return sealed.toString("hex");}finally{sealed.fill(0);}
}
function openHex(key:Buffer,aad:string,hex:string){
 const sealed=Buffer.from(hex,"hex");try{return openNewCaseBytes(key,aad,sealed);}finally{sealed.fill(0);}
}

/** Seal both complete correction working fields under one new independent key.
 * An appeal's name/contact/reference package is a different, unavailable flow. */
export function sealNewCorrection(rawScope: unknown, rawStatement: unknown) {
  const scope = correctionScope.parse(rawScope), statement = correctionStatement.parse(rawStatement);
  let wrapped:Buffer|undefined,key:Buffer|undefined,text:Buffer|undefined,packageBytes:Buffer|undefined;
  try {
    wrapped=newWrappedCaseKey();key=unwrapNewCaseKey(wrapped.toString("hex"));text=Buffer.from(statement,"utf8");
    packageBytes=Buffer.from(JSON.stringify(workingPackage.parse({version:1,field:scope.requestedField,statement})),"utf8");
    return sealedCorrection.parse({ format: "reviewer-only-case-statement-v1",
      statementCiphertextHex: sealedHex(key, correctionStatementAad(scope), text),
      workingCiphertextHex: sealedHex(key, correctionPackageAad(scope), packageBytes),
      wrappedCaseKeyHex: wrapped.toString("hex") });
  } finally { key?.fill(0); wrapped?.fill(0); text?.fill(0); packageBytes?.fill(0); }
}

/** Internal only, after an actual own-JWT audited assignment read and a current
 * source check. The caller must recheck again before any response. This has no
 * fallback for a legacy opaque row or another registered purpose. */
export function openNewCorrection(rawScope: unknown, rawEnvelope: unknown): string | null {
  const scope = correctionScope.safeParse(rawScope), envelope = sealedCorrection.safeParse(rawEnvelope);
  if (!scope.success || !envelope.success) return null;
  let key: Buffer | undefined, text: Buffer | null = null, packageBytes: Buffer | null = null;
  try {
    key = unwrapNewCaseKey(envelope.data.wrappedCaseKeyHex);
    text = openHex(key, correctionStatementAad(scope.data), envelope.data.statementCiphertextHex);
    packageBytes = openHex(key, correctionPackageAad(scope.data), envelope.data.workingCiphertextHex);
    if (!text || !packageBytes) return null;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const rawStatement = decoder.decode(text);
    const rawFields: unknown = JSON.parse(decoder.decode(packageBytes));
    const statement = correctionStatement.safeParse(rawStatement);
    const fields = workingPackage.safeParse(rawFields);
    if (!statement.success || !fields.success || fields.data.field !== scope.data.requestedField
      || statement.data !== fields.data.statement || statement.data !== rawStatement
      || typeof rawFields !== "object" || rawFields === null
      || (rawFields as { statement?: unknown }).statement !== fields.data.statement) return null;
    return statement.data;
  } catch { return null; } finally { key?.fill(0); text?.fill(0); packageBytes?.fill(0); }
}

export function sealCorrectionRejectReason(rawScope: unknown, wrappedHex: string, rawNonce: string, rawReason: unknown): string {
  const scope = correctionScope.parse(rawScope), reason = correctionReason.parse(rawReason);
  if (!/^[A-Za-z0-9_-]{16,256}$/u.test(rawNonce)) throw new Error("correction_unavailable");
  const nonceHash = crypto.createHash("sha256").update(rawNonce, "utf8").digest("hex");
  let key:Buffer|undefined,bytes:Buffer|undefined;
  try { key=unwrapNewCaseKey(wrappedHex);bytes=Buffer.from(reason,"utf8");
    return sealedHex(key, JSON.stringify(["reviewer-only-correction-reason-v1", correctionStatementAad(scope), nonceHash]), bytes); }
  finally { key?.fill(0); bytes?.fill(0); }
}

// This descriptor is emitted only by the proposed audited own-JWT read. Shape
// validation and a valid token are not substitutes for native currentness.
export const correctionReadBinding = z.object({
  actor: z.object({ accountId: z.uuid(), sessionId: z.uuid(), principalId: z.uuid(),
    principalRevision: revision,
    live: z.object({ authorized: z.literal(true), account_auth_session_revision: revision,
      session_revision: revision }).strict() }).strict(),
  assignmentRevision: revision,
  sourceHash: hexadecimal.length(64),
}).strict();
const reviewTokenClaims = z.object({ version: z.literal(1),
  operation: z.literal("future-person-correction-review"), caseId: z.uuid(),
  readBinding: correctionReadBinding, nonce: z.string().regex(/^[A-Za-z0-9_-]{16,256}$/u),
  expiresAt: z.number().int().safe().nonnegative() }).strict();
const tokenContext = "reviewer-only-correction-decision-nonce-v1";
const tokenLifetimeMs = 10 * 60 * 1000;

/** GET may mint this stateless token after the actual complete case read.
 * No case or nonce row is written here. Only the POST records consumption. */
export function mintCorrectionReviewNonce(caseId: string, rawBinding: unknown,
  originalDeadline: string, now = Date.now()): string {
  const deadline = Date.parse(clock.parse(originalDeadline));
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(deadline)
    || deadline <= now) throw new Error("correction_unavailable");
  let nonceBytes:Buffer|undefined,payloadBytes:Buffer|undefined;
  try{
    nonceBytes=crypto.randomBytes(24);
    const claims = reviewTokenClaims.parse({ version: 1, operation: "future-person-correction-review",
      caseId, readBinding: rawBinding, nonce:nonceBytes.toString("base64url"),
      expiresAt: Math.min(deadline, now + tokenLifetimeMs) });
    payloadBytes=Buffer.from(JSON.stringify(claims),"utf8");const payload=payloadBytes.toString("base64url");
    const token = `${payload}.${newCaseHmac(payload, tokenContext)}`;
    if (token.length > 2048) throw new Error("correction_unavailable");return token;
  }finally{nonceBytes?.fill(0);payloadBytes?.fill(0);}
}

/** The caller supplies its current own-JWT case read, never a cached actor or
 * a caller-selected assignment. SQL rechecks the same complete source again. */
export function readCorrectionReviewNonce(token: string, caseId: string, rawBinding: unknown,
  originalDeadline: string, now = Date.now()): string | null {
  if (!Number.isSafeInteger(now) || now < 0 || token.length > 2048) return null;
  let expectedBytes:Buffer|undefined,suppliedBytes:Buffer|undefined,payloadBytes:Buffer|undefined;
  try {
    const parts = token.split(".");
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/u.test(parts[0]!)
      || !/^[0-9a-f]{64}$/u.test(parts[1]!)) return null;
    const expected = newCaseHmac(parts[0]!, tokenContext);
    expectedBytes=Buffer.from(expected,"utf8");suppliedBytes=Buffer.from(parts[1]!,"utf8");
    if (!crypto.timingSafeEqual(expectedBytes,suppliedBytes)) return null;
    payloadBytes=Buffer.from(parts[0]!,"base64url");
    const claims = reviewTokenClaims.safeParse(JSON.parse(payloadBytes.toString("utf8")));
    const binding = correctionReadBinding.safeParse(rawBinding);
    const deadline = Date.parse(clock.parse(originalDeadline));
    if (!claims.success || !binding.success || !Number.isSafeInteger(deadline)
      || deadline <= now || claims.data.expiresAt <= now
      || claims.data.expiresAt > Math.min(deadline, now + tokenLifetimeMs)
      || claims.data.caseId !== caseId
      || JSON.stringify(claims.data.readBinding) !== JSON.stringify(binding.data)) return null;
    return claims.data.nonce;
  } catch { return null; }finally{expectedBytes?.fill(0);suppliedBytes?.fill(0);payloadBytes?.fill(0);}
}
