import "server-only";

import crypto from "node:crypto";
import { hmacSecret } from "@/lib/crypto";

const TOKEN_CONTEXT = "export-operation-v1";
const NONCE_CONTEXT = "export-operation-nonce-v1";
const HEX = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NONCE = /^[A-Za-z0-9_-]{43}$/;
export const EXPORT_OPERATION_LIFETIME_MS = 5 * 60 * 1000;
export const EXPORT_OPERATION_TOKEN_MAX_LENGTH = 2048;

type ExportRoute = "api.export" | "api.subject-export" | "api.future-person-export" | "api.third-party-subject-export";
type ExportContract = "account-export-v1" | "subject-export-v1" | "approved-future-person-export-v1" | "token-target-export-v1";

/**
 * Only a current server/database authorization capture may supply this context.
 * originBinding covers the exact originating session and its revisions; neither
 * a signed envelope nor an opaque receipt proves that the session is still live.
 * csrfBinding is the digest from the separately validated session-bound CSRF
 * header. This operation nonce never replaces that header or its consumption.
 */
type ExportContext = Readonly<{
  routeId: ExportRoute;
  origin: "authenticated" | "reviewer" | "independent-rights";
  principalId: string;
  targetKind: "account" | "subject" | "cohort";
  targetId: string;
  exportContract: ExportContract;
  originBinding: string;
  authorityReceipt: string;
  csrfBinding: string;
}>;

export type ExportOperationContext = ExportContext & (
  | Readonly<{ operation: "create" }>
  | Readonly<{ operation: "open-ready"; exportId: string; exportRevision: number }>
);
export type VerifiedExportOperation = ExportOperationContext & Readonly<{
  nonceHash: string;
  issuedAt: number;
  expiresAt: number;
}>;
export type MintedExportOperation = Readonly<{
  token: string;
  nonceHash: string;
  issuedAt: number;
  expiresAt: number;
}>;

type Claims = ExportOperationContext & Readonly<{
  version: "export-operation-v1";
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}>;
const CONTEXT_KEYS = ["routeId", "origin", "principalId", "targetKind", "targetId", "exportContract", "originBinding", "authorityReceipt", "csrfBinding", "operation"];
const READY_KEYS = ["exportId", "exportRevision"];
const CLAIM_KEYS = ["version", "nonce", "issuedAt", "expiresAt"];

function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === null || prototype === Object.prototype) && Reflect.ownKeys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    return typeof key === "string" && descriptor.enumerable && "value" in descriptor;
  });
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function digest(value: unknown): value is string { return typeof value === "string" && HEX.test(value); }
function uuid(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
function nonce(value: unknown): value is string {
  if (typeof value !== "string" || !NONCE.test(value)) return false;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 32 && bytes.toString("base64url") === value;
}
function time(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function sameDigest(a: string, b: string): boolean {
  return digest(a) && digest(b) && crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

function contextOf(value: unknown, claims = false): ExportOperationContext | null {
  if (!record(value) || !exactKeys(value, [
    ...CONTEXT_KEYS, ...(value.operation === "open-ready" ? READY_KEYS : []), ...(claims ? CLAIM_KEYS : []),
  ])) return null;
  if (!uuid(value.principalId) || !uuid(value.targetId)
    || !digest(value.originBinding) || !digest(value.authorityReceipt) || !digest(value.csrfBinding)) return null;
  // The generic delivery contract mentions reviewer origins, but none of the
  // four registered export POSTs authorizes one. Do not convert it to account.
  const authenticated = value.origin === "authenticated";
  const rights = value.origin === "independent-rights";
  const applicable =
    (value.routeId === "api.export" && authenticated && value.targetKind === "account" && value.exportContract === "account-export-v1")
    || (value.routeId === "api.subject-export" && authenticated && value.targetKind === "subject"
      && (value.exportContract === "subject-export-v1" || value.exportContract === "approved-future-person-export-v1"))
    || (value.routeId === "api.future-person-export" && rights && value.targetKind === "subject" && value.exportContract === "approved-future-person-export-v1")
    || (value.routeId === "api.third-party-subject-export" && rights
      && (value.targetKind === "subject" || value.targetKind === "cohort") && value.exportContract === "token-target-export-v1");
  if (!applicable || (value.operation !== "create" && value.operation !== "open-ready")) return null;
  if (value.operation === "open-ready" && (!uuid(value.exportId)
    || !Number.isSafeInteger(value.exportRevision) || (value.exportRevision as number) < 1)) return null;
  const common: ExportContext = {
    routeId: value.routeId as ExportRoute, origin: value.origin as ExportContext["origin"],
    principalId: value.principalId, targetKind: value.targetKind as ExportContext["targetKind"], targetId: value.targetId,
    exportContract: value.exportContract as ExportContract, originBinding: value.originBinding,
    authorityReceipt: value.authorityReceipt, csrfBinding: value.csrfBinding,
  };
  return value.operation === "create" ? { ...common, operation: "create" }
    : { ...common, operation: "open-ready", exportId: value.exportId as string, exportRevision: value.exportRevision as number };
}
function encode(claims: Claims): string { return Buffer.from(JSON.stringify(claims), "utf8").toString("base64url"); }
function verified(context: ExportOperationContext, claims: Claims): VerifiedExportOperation {
  return Object.freeze({ ...context, nonceHash: hmacSecret(claims.nonce, NONCE_CONTEXT), issuedAt: claims.issuedAt, expiresAt: claims.expiresAt });
}

/** Mint only during the separately authorized presentation flow, never a poll GET. */
export function mintExportOperation(context: ExportOperationContext, now = Date.now()): MintedExportOperation {
  const checked = contextOf(context);
  if (!checked || !time(now) || !time(now + EXPORT_OPERATION_LIFETIME_MS)) throw new Error("export_operation_context_invalid");
  const claims: Claims = { ...checked, version: "export-operation-v1", nonce: crypto.randomBytes(32).toString("base64url"),
    issuedAt: now, expiresAt: now + EXPORT_OPERATION_LIFETIME_MS };
  const payload = encode(claims);
  const token = `${payload}.${hmacSecret(payload, TOKEN_CONTEXT)}`;
  if (token.length > EXPORT_OPERATION_TOKEN_MAX_LENGTH) throw new Error("export_operation_context_invalid");
  return Object.freeze({ token, nonceHash: hmacSecret(claims.nonce, NONCE_CONTEXT), issuedAt: claims.issuedAt, expiresAt: claims.expiresAt });
}

/**
 * expected must be freshly re-derived from the route, live authority and separate
 * CSRF check, never decoded from this token or selected by the request body.
 * Success is not a database decision: the operation must atomically consume its
 * nonceHash and recheck the complete authority graph before any side effect.
 * Repeated verification alone deliberately does not provide single-use state.
 */
export function verifyExportOperation(token: unknown, expected: ExportOperationContext, now = Date.now()): VerifiedExportOperation | null {
  const context = contextOf(expected);
  if (!context || !time(now) || typeof token !== "string" || token.length > EXPORT_OPERATION_TOKEN_MAX_LENGTH) return null;
  const match = /^([A-Za-z0-9_-]+)\.([0-9a-f]{64})$/.exec(token);
  if (!match || !sameDigest(match[2], hmacSecret(match[1], TOKEN_CONTEXT))) return null;
  let value: unknown;
  try { value = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")); } catch { return null; }
  const captured = contextOf(value, true);
  if (!captured || !record(value) || value.version !== "export-operation-v1"
    || !nonce(value.nonce)
    || !time(value.issuedAt) || !time(value.expiresAt)
    || value.issuedAt > now || value.expiresAt <= now
    || value.expiresAt - value.issuedAt !== EXPORT_OPERATION_LIFETIME_MS) return null;
  const claims: Claims = { ...captured, version: "export-operation-v1", nonce: value.nonce, issuedAt: value.issuedAt, expiresAt: value.expiresAt };
  // Reject duplicate keys, extra whitespace, alternate order/escaping, invalid
  // UTF-8 and noncanonical base64url instead of normalizing a signed envelope.
  if (encode(claims) !== match[1]) return null;
  if (!sameDigest(context.originBinding, captured.originBinding)
    || !sameDigest(context.authorityReceipt, captured.authorityReceipt)
    || !sameDigest(context.csrfBinding, captured.csrfBinding)
    || JSON.stringify(context) !== JSON.stringify(captured)) return null;
  return verified(context, claims);
}
