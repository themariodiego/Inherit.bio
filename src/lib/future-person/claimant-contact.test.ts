import crypto from "node:crypto";
import {afterAll,describe,expect,it,vi} from "vitest";
vi.stubEnv("BYOK_ENCRYPTION_KEY",crypto.randomBytes(32).toString("base64"));
const {encryptSecret,decryptSecret}=await import("@/lib/crypto");
const {sealClaimantContact,openMailContact}=await import("./claimant-contact");
afterAll(()=>vi.unstubAllEnvs());
const ID="7e000000-0000-4000-8000-000000000001";
describe("independently shreddable claimant contact",()=>{
  it("opens the exact email while retaining legacy contact compatibility",()=>{
    const sealed=sealClaimantContact(ID,"synthetic@e2e.local");
    expect(openMailContact(Buffer.from(sealed.slice(2),"hex"))).toBe("synthetic@e2e.local");
    const outer=JSON.parse(decryptSecret(Buffer.from(sealed.slice(2),"hex")));
    expect(Object.keys(outer).sort()).toEqual(["contactId","sealedEmail","version","wrappedKey"]);
    expect(JSON.stringify(outer)).not.toContain("synthetic@e2e.local");
    expect(openMailContact(encryptSecret("legacy@e2e.local"))).toBe("legacy@e2e.local");
  });
  it("refuses a moved contact, wrong wrapped key, corrupted ciphertext or extra field",()=>{
    const sealed=sealClaimantContact(ID,"synthetic@e2e.local");
    const outer=JSON.parse(decryptSecret(Buffer.from(sealed.slice(2),"hex")));
    for(const bad of [{...outer,contactId:"7e000000-0000-4000-8000-000000000002"},
      {...outer,wrappedKey:encryptSecret(crypto.randomBytes(32).toString("base64")).toString("hex")},
      {...outer,sealedEmail:"00".repeat(40)},{...outer,plaintext:"forbidden"}]){
      expect(()=>openMailContact(encryptSecret(JSON.stringify(bad)))).toThrow();
    }
    expect(()=>openMailContact(Buffer.alloc(16385))).toThrow();
    expect(()=>openMailContact(encryptSecret("not an email"))).toThrow();
  });
  it("uses a fresh per-contact key even for the same address and identifier",()=>{
    const a=sealClaimantContact(ID,"synthetic@e2e.local"),b=sealClaimantContact(ID,"synthetic@e2e.local");
    const x=JSON.parse(decryptSecret(Buffer.from(a.slice(2),"hex"))),y=JSON.parse(decryptSecret(Buffer.from(b.slice(2),"hex")));
    expect(x.wrappedKey).not.toBe(y.wrappedKey);expect(x.sealedEmail).not.toBe(y.sealedEmail);
  });
});
