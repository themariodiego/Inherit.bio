import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import crypto from "node:crypto";
import {encryptSecret,decryptSecret,hmacSecret} from "@/lib/crypto";
import {newWrappedCaseKey,unwrapNewCaseKey,sealNewCaseBytes,openNewCaseBytes,newCaseHmac} from "./new-case-envelope-crypto";
beforeEach(()=>vi.stubEnv("BYOK_ENCRYPTION_KEY",Buffer.alloc(32,71).toString("base64")));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
// SOURCE-AUTHORED, UNRUN. Actual native AES-GCM and actual original wrapper
// are used. Mutable-buffer assertions do not certify immutable strings,
// crypto internal/platform memory, authority, provider disposal or release.
describe("NEW case wrapper compatibility and owned crypto copies",()=>{
 it("retains the original 72-byte deployment wrapping format",()=>{
  const wrapped=newWrappedCaseKey();let oldOpened:Buffer|undefined,key:Buffer|undefined;
  try{expect(wrapped.byteLength).toBe(72);oldOpened=Buffer.from(decryptSecret(wrapped),"base64");key=unwrapNewCaseKey(wrapped.toString("hex"));
   expect(key.byteLength).toBe(32);expect(key.equals(oldOpened)).toBe(true);}
  finally{wrapped.fill(0);oldOpened?.fill(0);key?.fill(0);}
 });
 it("opens a genuine original wrapper without changing or reencrypting its bytes",()=>{
  const raw=Buffer.alloc(32,59),wrapped=encryptSecret(raw.toString("base64")),original=Buffer.from(wrapped);let key:Buffer|undefined;
  try{key=unwrapNewCaseKey(wrapped.toString("hex"));expect(key.equals(raw)).toBe(true);expect(wrapped.equals(original)).toBe(true);}
  finally{raw.fill(0);wrapped.fill(0);original.fill(0);key?.fill(0);}
 });
 it("keeps the actual caller key and input, authenticates the exact AAD, and returns only the owned plaintext",()=>{
  const key=Buffer.alloc(32,61),input=Buffer.from("Synthetic source-only case statement.","utf8"),sealed=sealNewCaseBytes(key,"case-aad",input);
  let opened:Buffer|null=null;
  try{opened=openNewCaseBytes(key,"case-aad",sealed);expect(opened?.equals(input)).toBe(true);
   expect(openNewCaseBytes(key,"other-aad",sealed)).toBeNull();expect(key.every(value=>value===61)).toBe(true);expect(input.byteLength).toBeGreaterThan(0);}
  finally{key.fill(0);input.fill(0);sealed.fill(0);opened?.fill(0);}
 });
 it.each([false,true])("zeros actual decipher plaintext intermediates, including GCM failure=%s",tampered=>{
  const key=Buffer.alloc(32,67),input=Buffer.from("Synthetic intermediate plaintext bytes.","utf8"),sealed=sealNewCaseBytes(key,"case-aad",input);
  const probe=crypto.createDecipheriv("aes-256-gcm",key,Buffer.alloc(12));
  // Spy observes the actual native method; it does not replace its result.
  const update=vi.spyOn(Object.getPrototypeOf(probe),"update"),final=vi.spyOn(Object.getPrototypeOf(probe),"final");
  let opened:Buffer|null=null;
  try{if(tampered)sealed[12]=sealed[12]!^1;opened=openNewCaseBytes(key,"case-aad",sealed);
   if(tampered)expect(opened).toBeNull();else expect(opened?.equals(input)).toBe(true);
   const results=[...update.mock.results,...final.mock.results].filter(result=>result.type==="return"&&Buffer.isBuffer(result.value));
   expect(results.some(result=>result.value.byteLength>0)).toBe(true);
   for(const result of results)expect(result.value.every((byte:number)=>byte===0)).toBe(true);
  }finally{key.fill(0);input.fill(0);sealed.fill(0);opened?.fill(0);}
 });
 it("refuses tampered wrapping, invalid raw key sizes and noncanonical encoded case keys",()=>{
  const raw=Buffer.alloc(31,73),wrapped=encryptSecret(raw.toString("base64"));
  try{expect(()=>unwrapNewCaseKey(wrapped.toString("hex"))).toThrow();}
  finally{raw.fill(0);wrapped.fill(0);}
  const valid=newWrappedCaseKey();try{valid[12]=valid[12]!^1;expect(()=>unwrapNewCaseKey(valid.toString("hex"))).toThrow();}
  finally{valid.fill(0);}
  const full=Buffer.alloc(32,79),alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",canonical=full.toString("base64");
  const noncanonical=`${canonical.slice(0,42)}${alphabet[alphabet.indexOf(canonical[42]!)+1]}=`;
  const bad=encryptSecret(noncanonical);try{expect(()=>unwrapNewCaseKey(bad.toString("hex"))).toThrow();}
  finally{full.fill(0);bad.fill(0);}
 });
 it("retains the exact original context-separated nonce digest",()=>{
  expect(newCaseHmac("synthetic-payload","reviewer-only-correction-decision-nonce-v1"))
   .toBe(hmacSecret("synthetic-payload","reviewer-only-correction-decision-nonce-v1"));
  expect(newCaseHmac("synthetic-payload","another-purpose"))
   .not.toBe(newCaseHmac("synthetic-payload","reviewer-only-correction-decision-nonce-v1"));
 });
});
