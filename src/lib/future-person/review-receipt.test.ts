import crypto from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
vi.stubEnv("BYOK_ENCRYPTION_KEY",crypto.randomBytes(32).toString("base64"));
const receiptModule=await import("./review-receipt");
const {mintReceiptOpenNonce,readReceiptOpenNonce,mintReceiptAckNonce,readReceiptAckNonce,chunkReceiptProof}=receiptModule;
afterAll(()=>vi.unstubAllEnvs());
const D="7e000000-0000-4000-8000-000000000001";
const A="7e000000-0000-4000-8000-000000000002";
const S="7e000000-0000-4000-8000-000000000003";
const C="a".repeat(64);
const NOW=Date.UTC(2026,8,30,12);
describe("complete document receipt is bound to its exact reviewer and chunk",()=>{
  it("refuses crossed document, account, session, expired and modified opening tokens",()=>{
    const nonce=mintReceiptOpenNonce(D,A,S,NOW);
    expect(readReceiptOpenNonce(nonce,D,A,S,NOW)).not.toBeNull();
    for(const binding of [[A,A,S],[D,D,S],[D,A,D]])expect(readReceiptOpenNonce(nonce,...binding as [string,string,string],NOW)).toBeNull();
    expect(readReceiptOpenNonce(nonce,D,A,S,NOW+600001)).toBeNull();
    expect(readReceiptOpenNonce(`x${nonce.slice(1)}`,D,A,S,NOW)).toBeNull();
  });
  it("refuses another sequence, download, rotated cookie, reviewer or auth session",()=>{
    const nonce=mintReceiptAckNonce(D,0,C,A,S,NOW);
    expect(readReceiptAckNonce(nonce,D,0,C,A,S,NOW)).not.toBeNull();
    for(const binding of [[A,0,C,A,S],[D,1,C,A,S],[D,0,"b".repeat(64),A,S],[D,0,C,D,S],[D,0,C,A,D]])
      expect(readReceiptAckNonce(nonce,...binding as [string,number,string,string,string],NOW)).toBeNull();
    expect(readReceiptAckNonce(nonce,D,0,C,A,S,NOW+600001)).toBeNull();
    // 2026-11-19 (G8.5, the migration stage): the receipt digest (receiptCsrf), the same for every
    // chunk, is gone; each acknowledgement spends the reviewer's one-time session token for its route
    // (src/lib/security/session-csrf-routes.test.ts). These lines asserted the digest's bindings.
    expect(Object.keys(receiptModule)).not.toContain("receiptCsrf");
    expect(Object.keys(receiptModule)).not.toContain("receiptCsrfMatches");
  });
  it("requires the complete challenged bytes, not the published whole-file digest",()=>{
    const bytes=Buffer.from("Synthetic document bytes");
    const proof=chunkReceiptProof(C,bytes);
    expect(proof).toBe(crypto.createHash("sha256").update(Buffer.from(C,"hex")).update(bytes).digest("hex"));
    expect(proof).not.toBe(crypto.createHash("sha256").update(bytes).digest("hex"));
    expect(proof).not.toBe(chunkReceiptProof("b".repeat(64),bytes));
    expect(proof).not.toBe(chunkReceiptProof(C,bytes.subarray(0,-1)));
    expect(()=>chunkReceiptProof(C,new Uint8Array())).toThrow();
    expect(()=>chunkReceiptProof(C,new Uint8Array(4_000_001))).toThrow();
  });
});
