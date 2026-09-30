import "server-only";
import crypto from "node:crypto";
import { hmacSecret } from "@/lib/crypto";
import { mintPublicFormToken, readPublicFormToken } from "@/lib/embryos/operation-token";
import { sha256Hex } from "./claim-session";

const openBinding = (document: string, account: string, session: string) => sha256Hex(`${document}|${account}|${session}`);
/** Stateless page token: only the receipt POST records its nonce hash. */
export function mintReceiptOpenNonce(document: string, account: string, session: string, now = Date.now()) {
  return mintPublicFormToken("claim-review-receipt-open", now, openBinding(document, account, session));
}
export function readReceiptOpenNonce(token: string, document: string, account: string, session: string, now = Date.now()) {
  return token.length <= 2048 ? readPublicFormToken(token, "claim-review-receipt-open", now, openBinding(document, account, session))?.nonce ?? null : null;
}
const ackBinding = (download: string, sequence: number, cookieHash: string, account: string, session: string) =>
  sha256Hex(`${download}|${sequence}|${cookieHash}|${account}|${session}`);
/** Issued only in the authorized receipt POST, one distinct nonce per chunk. */
export function mintReceiptAckNonce(download: string, sequence: number, cookieHash: string, account: string, session: string, now = Date.now()) {
  return mintPublicFormToken("claim-review-receipt-ack", now, ackBinding(download, sequence, cookieHash, account, session));
}
export function readReceiptAckNonce(token: string, download: string, sequence: number, cookieHash: string, account: string, session: string, now = Date.now()) {
  return token.length <= 2048 ? readPublicFormToken(token, "claim-review-receipt-ack", now, ackBinding(download, sequence, cookieHash, account, session))?.nonce ?? null : null;
}
export function receiptCsrf(download: string, cookieHash: string, account: string, session: string) {
  return hmacSecret(`${download}|${cookieHash}|${account}|${session}`, "claim-review-receipt-csrf-v1");
}
export function receiptCsrfMatches(value: string | null, download: string, cookieHash: string, account: string, session: string) {
  return value !== null && /^[0-9a-f]{64}$/u.test(value) && crypto.timingSafeEqual(Buffer.from(value),Buffer.from(receiptCsrf(download,cookieHash,account,session)));
}
/** Whole-file public digests cannot substitute for the random challenge and actual chunk. */
export function chunkReceiptProof(challenge: string, bytes: Uint8Array) {
  if (!/^[0-9a-f]{64}$/u.test(challenge) || bytes.length < 1 || bytes.length > 4_000_000) throw new Error("Invalid receipt bytes");
  return crypto.createHash("sha256").update(Buffer.from(challenge,"hex")).update(bytes).digest("hex");
}
