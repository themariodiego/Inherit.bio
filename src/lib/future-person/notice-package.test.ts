import crypto from "node:crypto";
import {afterAll,describe,expect,it,vi} from "vitest";
vi.stubEnv("BYOK_ENCRYPTION_KEY",crypto.randomBytes(32).toString("base64"));
const {sealNoticePackage,openNoticePackage}=await import("./notice-package");
const {claimDataKey,openDocumentBytes,sealDocumentBytes}=await import("./document-envelope");
afterAll(()=>vi.unstubAllEnvs());
const id=(n:number)=>`7a000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const binding={reviewId:id(1),documentaryRevision:1,photoDocumentId:id(2),photoSha256:"a".repeat(64),
  birthDocumentId:id(3),birthSha256:"b".repeat(64)};
const human={fullName:"Synthetic Claimant",dateOfBirth:"2000-01-01",photoIdentityReviewed:true as const,
  birthRecordReviewed:true as const,adultAgeConfirmed:true as const};
const profile={childDateOfBirth:"2000-01-01",childPlaceOfBirth:"Synthetic City",parentNames:["Synthetic Parent"]};
const hex=(value:string)=>value.slice(2);
function open(value:ReturnType<typeof sealNoticePackage>,scope=binding){
  return openNoticePackage(hex(value.ciphertext),hex(value.wrappedKey),scope);
}

describe("the independently erasable minimum keyless notice package",()=>{
  it("reseals only the authorized minimum under a fresh independent key and exact document binding",()=>{
    const first=sealNoticePackage(human,{...profile,contactEmail:"omitted@example.test",candidateCount:8} as typeof profile,binding);
    const second=sealNoticePackage(human,profile,binding);
    expect(first.ciphertext).not.toBe(second.ciphertext);expect(first.wrappedKey).not.toBe(second.wrappedKey);
    const firstKey=claimDataKey(hex(first.wrappedKey)),secondKey=claimDataKey(hex(second.wrappedKey));
    try{expect(firstKey.equals(secondKey)).toBe(false);}finally{firstKey.fill(0);secondKey.fill(0);}
    expect(open(first)).toEqual({version:1,verifiedName:human.fullName,verifiedDateOfBirth:human.dateOfBirth,
      childPlaceOfBirth:profile.childPlaceOfBirth,parentNames:profile.parentNames});
    expect(Object.keys(open(first)!)).toEqual(["version","verifiedName","verifiedDateOfBirth","childPlaceOfBirth","parentNames"]);
    for(const absent of ["contactEmail","claimantName","candidateCount","identityHmac","profileId","ownerId","intake","rawKey","documentBytes"])
      expect(open(first)).not.toHaveProperty(absent);
    for(const value of [human.fullName,human.dateOfBirth,profile.childPlaceOfBirth,...profile.parentNames])
      expect(Buffer.from(hex(first.ciphertext),"hex").toString("utf8")).not.toContain(value);
  });
  it.each(["reviewId","photoDocumentId","birthDocumentId"] as const)("refuses a different exact %s",field=>{
    const sealed=sealNoticePackage(human,profile,binding);
    expect(open(sealed,{...binding,[field]:id(99)})).toBeNull();
  });
  it.each(["photoSha256","birthSha256"] as const)("refuses replaced %s",field=>{
    expect(open(sealNoticePackage(human,profile,binding),{...binding,[field]:"c".repeat(64)})).toBeNull();
  });
  it("refuses revision changes, switched kind bindings, wrong key, tampering and shredded wrappers",()=>{
    const sealed=sealNoticePackage(human,profile,binding),other=sealNoticePackage(human,profile,binding);
    expect(open(sealed,{...binding,documentaryRevision:2})).toBeNull();
    expect(open(sealed,{...binding,photoDocumentId:binding.birthDocumentId,photoSha256:binding.birthSha256,
      birthDocumentId:binding.photoDocumentId,birthSha256:binding.photoSha256})).toBeNull();
    expect(open({...sealed,wrappedKey:other.wrappedKey})).toBeNull();
    const tampered=Buffer.from(hex(sealed.ciphertext),"hex");tampered[tampered.length-1]!^=1;
    expect(open({...sealed,ciphertext:`\\x${tampered.toString("hex")}`})).toBeNull();
    expect(openNoticePackage(hex(sealed.ciphertext),"",binding)).toBeNull();
    expect(openNoticePackage(hex(sealed.ciphertext),crypto.randomBytes(72).toString("hex"),binding)).toBeNull();
  });
  it("rejects unknown decrypted fields and malformed or non-adult documentary values",()=>{
    const sealed=sealNoticePackage(human,profile,binding),key=claimDataKey(hex(sealed.wrappedKey));
    let bytes:Buffer|null=null;
    try{
      bytes=openDocumentBytes(key,`future-person-notice-package-v1|${JSON.stringify(binding)}`,Buffer.from(hex(sealed.ciphertext),"hex"));
      const good=JSON.parse(bytes!.toString("utf8"));
      for(const bad of [{...good,contactEmail:"extra@example.test"},{...good,verifiedDateOfBirth:"2000-02-30"},
        {...good,verifiedDateOfBirth:"2099-01-01"},{...good,professionalBasis:"Extra working reason must not transfer"},
        {...good,parentNames:[]},{...good,childPlaceOfBirth:"A\u0000B"}]){
        const raw=Buffer.from(JSON.stringify(bad));
        try{expect(openNoticePackage(sealDocumentBytes(key,`future-person-notice-package-v1|${JSON.stringify(binding)}`,raw).toString("hex"),
          hex(sealed.wrappedKey),binding)).toBeNull();}finally{raw.fill(0);}
      }
    }finally{key.fill(0);bytes?.fill(0);}
    expect(()=>sealNoticePackage(human,{...profile,childDateOfBirth:"2001-01-01"},binding)).toThrow("claim_package_unavailable");
    expect(()=>sealNoticePackage({...human,dateOfBirth:"2099-01-01"},profile,binding)).toThrow();
    expect(()=>sealNoticePackage(human,profile,{...binding,birthDocumentId:binding.photoDocumentId})).toThrow();
    expect(()=>sealNoticePackage(human,profile,{...binding,extra:"selector"} as typeof binding)).toThrow();
  });
});
