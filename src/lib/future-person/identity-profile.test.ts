import {randomBytes} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import {claimDataKey,openDocumentBytes,sealDocumentBytes} from "./document-envelope";
import {identityProfileBody,identityProfileDigestSet,openIdentityProfile,sealIdentityProfile} from "./identity-profile";

const PROFILE="48000000-0000-4000-8000-000000000001",EMBRYO="48000000-0000-4000-8000-000000000002";
const given={profileId:PROFILE,embryoId:EMBRYO,identityRevision:1};
const input={childDateOfBirth:"2005-01-04",childPlaceOfBirth:"Synthetic Place",parentNames:["Synthetic Parent A","Synthetic Parent B"],
  consentSignatureId:"48000000-0000-4000-8000-000000000003"};
afterEach(()=>vi.unstubAllEnvs());
function roots(){vi.stubEnv("BYOK_ENCRYPTION_KEY",randomBytes(32).toString("base64"));vi.stubEnv("INHERIT_HMAC_KEYRING","");}
describe("independently erasable parent matching profile",()=>{
  it("normalizes the exact supplied fields, stores only ciphertext/indexes and authenticates their real scope",()=>{
    roots();const sealed=sealIdentityProfile({...input,childPlaceOfBirth:"  Synthetic   Place  ",parentNames:["Synthetic Parent A","Synthetic Parent B"]},given);
    expect(openIdentityProfile(sealed.ciphertext,sealed.wrappedKey.toString("hex"),given))
      .toEqual({version:1,childDateOfBirth:input.childDateOfBirth,childPlaceOfBirth:input.childPlaceOfBirth,parentNames:input.parentNames});
    expect(Object.keys(sealed).sort()).toEqual(["ciphertext","matchIndexes","wrappedKey"]);
    expect(Object.keys(sealed.matchIndexes)).toEqual(["1"]);expect(sealed.matchIndexes["1"]).toMatch(/^[0-9a-f]{64}$/u);
    expect(sealed.ciphertext.toString("utf8")).not.toContain("Synthetic");expect(sealed.wrappedKey.length).toBe(72);
  });
  it("retains dual held revisions with purpose separation and an order-independent exact tuple",()=>{
    roots();vi.stubEnv("INHERIT_HMAC_KEYRING",`2:${randomBytes(32).toString("base64")}`);
    const original=identityProfileDigestSet({childDateOfBirth:input.childDateOfBirth,childPlaceOfBirth:input.childPlaceOfBirth,parentNames:input.parentNames});
    expect(Object.keys(original)).toEqual(["1","2"]);expect(original["1"]).not.toBe(original["2"]);
    expect(identityProfileDigestSet({childDateOfBirth:input.childDateOfBirth,childPlaceOfBirth:" synthetic   place ",parentNames:["synthetic parent b","synthetic parent a"]})).toEqual(original);
    expect(identityProfileDigestSet({childDateOfBirth:"2005-01-05",childPlaceOfBirth:input.childPlaceOfBirth,parentNames:input.parentNames})).not.toEqual(original);
    expect(identityProfileDigestSet({childDateOfBirth:input.childDateOfBirth,childPlaceOfBirth:"Different Synthetic Place",parentNames:input.parentNames})).not.toEqual(original);
  });
  it("accepts the registered valid past date and distinct people with the same supplied name",()=>{
    roots();const sealed=sealIdentityProfile({...input,childDateOfBirth:"1899-01-04",parentNames:["Synthetic Parent","Synthetic Parent"]},given);
    expect(openIdentityProfile(sealed.ciphertext,sealed.wrappedKey.toString("hex"),given)?.childDateOfBirth).toBe("1899-01-04");
    expect(openIdentityProfile(sealed.ciphertext,sealed.wrappedKey.toString("hex"),given)?.parentNames).toHaveLength(2);
  });
  it("uses distinct random data keys and makes only the erased profile unavailable",()=>{
    roots();const first=sealIdentityProfile(input,given),second=sealIdentityProfile(input,{...given,profileId:EMBRYO});
    const a=claimDataKey(first.wrappedKey.toString("hex")),b=claimDataKey(second.wrappedKey.toString("hex"));
    try{expect(a).not.toEqual(b);}finally{a.fill(0);b.fill(0);}
    expect(openIdentityProfile(first.ciphertext,null,given)).toBeNull();
    expect(openIdentityProfile(second.ciphertext,second.wrappedKey.toString("hex"),{...given,profileId:EMBRYO})).not.toBeNull();
  });
  it.each(["profile","embryo","revision","ciphertext","wrapper","wrong-root"])("refuses a crossed %s without legacy plaintext or derived-key fallback",kind=>{
    roots();const sealed=sealIdentityProfile(input,given),crossed={...given};let wrapper=sealed.wrappedKey.toString("hex");
    if(kind==="profile")crossed.profileId=EMBRYO;if(kind==="embryo")crossed.embryoId=PROFILE;if(kind==="revision")crossed.identityRevision=2;
    if(kind==="ciphertext")sealed.ciphertext[30]^=1;if(kind==="wrapper")wrapper="00".repeat(29);if(kind==="wrong-root")roots();
    expect(openIdentityProfile(sealed.ciphertext,wrapper,crossed)).toBeNull();
  });
  it("refuses correctly encrypted unknown fields rather than silently projecting a genetic or contact field",()=>{
    roots();const sealed=sealIdentityProfile(input,given),key=claimDataKey(sealed.wrappedKey.toString("hex"));
    const binding=`future-person-profile-v1|${PROFILE}|${EMBRYO}|1`;
    try{
      const original=openDocumentBytes(key,binding,sealed.ciphertext)!;
      const body=JSON.parse(original.toString("utf8"));original.fill(0);
      const extra=sealDocumentBytes(key,binding,Buffer.from(JSON.stringify({...body,email:"synthetic@e2e.local"})));
      expect(openIdentityProfile(extra,sealed.wrappedKey.toString("hex"),given)).toBeNull();
    }finally{key.fill(0);}
  });
  it.each(["future-date","invalid-date","extra-subject","missing-consent","control-character"])("refuses %s before encryption",kind=>{
    const bad:Record<string,unknown>=structuredClone(input);
    if(kind==="future-date")bad.childDateOfBirth="2999-01-01";if(kind==="invalid-date")bad.childDateOfBirth="2005-02-30";
    if(kind==="extra-subject")bad.subjectId=EMBRYO;if(kind==="missing-consent")delete bad.consentSignatureId;
    if(kind==="control-character")bad.childPlaceOfBirth="Synthetic\u0000 Place";
    expect(identityProfileBody.safeParse(bad).success).toBe(false);
  });
});
