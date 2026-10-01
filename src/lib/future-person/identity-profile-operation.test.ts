import {randomBytes} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {hmacSecret} from "@/lib/crypto";
import {identityProfileContext,mintIdentityProfileOperation,readIdentityProfileOperation,type IdentityProfileContext} from "./identity-profile-operation";

const NOW=Date.parse("2026-10-01T00:00:00Z"),A="48000000-0000-4000-8000-000000000001",B="48000000-0000-4000-8000-000000000002";
const C="48000000-0000-4000-8000-000000000003",D="48000000-0000-4000-8000-000000000004";
const context:IdentityProfileContext={embryoId:A,subjectId:B,actorPrincipal:C,basisFingerprint:"a".repeat(64),basisRevision:1,
  participantSetRevision:1,recipientSetRevision:1,cohortLifecycleRevision:1,subjectLifecycleRevision:1,dispositionRevision:1,
  accountRevision:1,authSessionRevision:1,sessionRevision:1,consentSignatureId:D,currentProfileId:null,
  nextIdentityRevision:1,expiresAt:"2040-10-01T00:00:00Z"};
const binding={accountId:B,sessionId:C,embryoId:A,operation:"save" as const};
beforeEach(()=>vi.stubEnv("BYOK_ENCRYPTION_KEY",randomBytes(32).toString("base64")));
afterEach(()=>vi.unstubAllEnvs());
function signed(value:unknown){const payload=Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${hmacSecret(payload,"future-person-profile-operation-v1")}`;}
describe("exact authority-bound profile operation",()=>{
  it("issues no persisted nonce and accepts only its separate CSRF value and complete current receipt",()=>{
    const token=mintIdentityProfileOperation(binding,context,NOW);
    expect(token.operationNonce).not.toBe(token.csrf);
    expect(readIdentityProfileOperation(token.operationNonce,token.csrf,binding,context,NOW)?.nonce).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    expect(readIdentityProfileOperation(token.operationNonce,token.operationNonce,binding,context,NOW)).toBeNull();
    expect(readIdentityProfileOperation(token.operationNonce,token.csrf,binding,context,NOW+600_000)).toBeNull();
    const shuffled=Object.fromEntries(Object.entries(context).reverse()) as IdentityProfileContext;
    expect(readIdentityProfileOperation(token.operationNonce,token.csrf,binding,shuffled,NOW)).not.toBeNull();
  });
  it.each(["accountId","sessionId","embryoId","operation"])("refuses a crossed %s",field=>{
    const token=mintIdentityProfileOperation(binding,context,NOW),crossed={...binding};
    if(field==="accountId")crossed.accountId=D;if(field==="sessionId")crossed.sessionId=D;
    if(field==="embryoId")crossed.embryoId=D;if(field==="operation")crossed.operation="delete" as "save";
    expect(readIdentityProfileOperation(token.operationNonce,token.csrf,crossed,context,NOW)).toBeNull();
  });
  it.each(Object.keys(context))("refuses a changed current %s before any mutation",field=>{
    const token=mintIdentityProfileOperation(binding,context,NOW);
    const crossed:Record<string,unknown>={...context};const original=crossed[field];
    crossed[field]=typeof original==="number"?original+1:field==="expiresAt"?"2039-10-01T00:00:00Z":field==="basisFingerprint"?"b".repeat(64):original===D?A:D;
    expect(readIdentityProfileOperation(token.operationNonce,token.csrf,binding,crossed as IdentityProfileContext,NOW)).toBeNull();
  });
  it("refuses malformed and genuinely signed unknown claims, and caps expiry at the actual record deadline",()=>{
    const token=mintIdentityProfileOperation(binding,context,NOW),body=JSON.parse(Buffer.from(token.operationNonce.split(".")[0],"base64url").toString());
    expect(readIdentityProfileOperation(signed({...body,extra:"forbidden"}),token.csrf,binding,context,NOW)).toBeNull();
    expect(readIdentityProfileOperation(signed({...body,expiresAt:NOW+600_001}),token.csrf,binding,context,NOW)).toBeNull();
    expect(readIdentityProfileOperation(`${token.operationNonce}.extra`,token.csrf,binding,context,NOW)).toBeNull();
    const short={...context,expiresAt:new Date(NOW+10).toISOString()},bounded=mintIdentityProfileOperation(binding,short,NOW);
    expect(readIdentityProfileOperation(bounded.operationNonce,bounded.csrf,binding,short,NOW+9)).not.toBeNull();
    expect(readIdentityProfileOperation(bounded.operationNonce,bounded.csrf,binding,short,NOW+10)).toBeNull();
    expect(()=>mintIdentityProfileOperation(binding,{...context,expiresAt:new Date(NOW).toISOString()},NOW)).toThrow();
    expect(identityProfileContext.safeParse({...context,plaintext:"forbidden"}).success).toBe(false);
  });
});
