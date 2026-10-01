import "server-only";

import crypto from "node:crypto";
import {z} from "zod";
import {hmacSecret} from "@/lib/crypto";

const PURPOSE="future-person-keyless-verification-proof-v1";
const LIFETIME=10*60*1000;
const hash=z.string().regex(/^[0-9a-f]{64}$/u);
const revision=z.number().int().positive().safe();
const document=z.object({id:z.uuid(),sha256:hash}).strict();
const scope=z.object({
  reviewId:z.uuid(),reviewerAccountId:z.uuid(),authSessionId:z.uuid(),
  reviewRevision:revision,assignmentRevision:revision,
  accountAuthRevision:revision,originatingSessionRevision:revision,
  photoIdentity:document,birthRecord:document,
  // Both digests are selected/recomputed by the server, never accepted from a
  // browser. They bind the freshly verified tuple and entire current SQL
  // comparison receipt without carrying an identity or selector in the token.
  verifiedTupleDigest:hash,comparisonReceiptDigest:hash,
}).strict().refine(value=>value.photoIdentity.id!==value.birthRecord.id);
export type KeylessVerificationScope=z.infer<typeof scope>;
const envelope=z.object({version:z.literal(1),receipt:hash,
  issuedAt:z.number().int().nonnegative().safe(),expiresAt:z.number().int().positive().safe(),
}).strict();
const invalid=()=>new Error("claim verification unavailable");

function receipt(given:KeylessVerificationScope):string {
  const parsed=scope.safeParse(given);if(!parsed.success)throw invalid();
  // Rebuild in the declared order; caller insertion order never changes proof.
  return hmacSecret(JSON.stringify(parsed.data),`${PURPOSE}|receipt`);
}
function proofKey():Buffer {
  return Buffer.from(hmacSecret("encrypted-reviewer-verification",`${PURPOSE}|key`),"hex");
}

/** An encrypted, ten-minute receipt of a read-only documentary lookup. It is
 * not approval, age proof, a read receipt, or a replacement operation nonce.
 * Final decision must freshly reauthorize/recompute this exact scope and
 * atomically consume its separately registered one-use decision nonce. */
export function sealKeylessVerificationProof(given:KeylessVerificationScope,now=Date.now()):string {
  if(!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(now+LIFETIME))throw invalid();
  const plaintext=Buffer.from(JSON.stringify({version:1,receipt:receipt(given),issuedAt:now,expiresAt:now+LIFETIME}),"utf8");
  const key=proofKey(),iv=crypto.randomBytes(12);
  try{
    const cipher=crypto.createCipheriv("aes-256-gcm",key,iv);cipher.setAAD(Buffer.from(PURPOSE));
    const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
    return Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString("base64url");
  }finally{key.fill(0);plaintext.fill(0);}
}

/** Nothing from the proof supplies authority: `fresh` must come from the
 * current own-JWT assignment/document/matching RPC plus verified tuple. */
export function keylessVerificationProofMatches(token:unknown,fresh:KeylessVerificationScope,now=Date.now()):boolean {
  let key:Buffer|undefined,plaintext:Buffer|undefined;
  try{
    if(typeof token!=="string"||token.length<40||token.length>1024||!/^[A-Za-z0-9_-]+$/u.test(token)
      ||!Number.isSafeInteger(now)||now<0)return false;
    const bytes=Buffer.from(token,"base64url");
    if(bytes.length<29||bytes.toString("base64url")!==token)return false;
    key=proofKey();
    const decipher=crypto.createDecipheriv("aes-256-gcm",key,bytes.subarray(0,12));
    decipher.setAAD(Buffer.from(PURPOSE));decipher.setAuthTag(bytes.subarray(12,28));
    plaintext=Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]);
    const parsed=envelope.safeParse(JSON.parse(plaintext.toString("utf8")));
    if(!parsed.success||parsed.data.issuedAt>now||parsed.data.expiresAt<=now
      ||parsed.data.expiresAt-parsed.data.issuedAt!==LIFETIME)return false;
    return crypto.timingSafeEqual(Buffer.from(parsed.data.receipt,"hex"),Buffer.from(receipt(fresh),"hex"));
  }catch{return false;}finally{key?.fill(0);plaintext?.fill(0);}
}
