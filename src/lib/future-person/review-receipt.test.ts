import crypto from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
vi.stubEnv("BYOK_ENCRYPTION_KEY",crypto.randomBytes(32).toString("base64"));
const {mintReceiptOpenNonce,readReceiptOpenNonce,mintReceiptAckNonce,readReceiptAckNonce,receiptCsrf,receiptCsrfMatches,chunkReceiptProof}=await import("./review-receipt");
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
    const csrf=receiptCsrf(D,C,A,S);
    expect(receiptCsrfMatches(csrf,D,C,A,S)).toBe(true);
    expect(receiptCsrfMatches(csrf,D,"b".repeat(64),A,S)).toBe(false);
    expect(receiptCsrfMatches(csrf,A,C,A,S)).toBe(false);
    expect(receiptCsrfMatches(nonce,D,C,A,S)).toBe(false);
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
