import {afterEach,describe,expect,it,vi} from "vitest";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {Resend} from "resend";
import {keylessReviewDocument} from "../e2e/fixtures/keyless-review-documents";
import {syntheticDeliveredCallback} from "../e2e/fixtures/synthetic-notice-callback";

afterEach(()=>vi.unstubAllEnvs());
const identity={fullName:"Synthetic Claimant",placeOfBirth:"Synthetic Town",parentNames:["Synthetic Parent One","Synthetic Parent Two"]};
describe("DOB-aware synthetic papers preserve the original native fixtures",()=>{
  it("pins both complete original PDF byte streams to their frozen494 digests",()=>{
    const old={photo:{bytes:1139,sha256:"572a7acd54b5232e0c056f9c54cc3b776bd461a1a0506a255940b2c8a33c7684"},
      birth:{bytes:1314,sha256:"0dc8272480c992af0da789da36c792915cc9fded9997c2809a52c5718ff785f3"}};
    for(const kind of ["photo","birth"] as const){
      const bytes=keylessReviewDocument(kind,identity);
      expect({bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")}).toEqual(old[kind]);
    }
  });
  it("shows the explicit historical DOB in each actual paper without the old date or active content",()=>{
    for(const kind of ["photo","birth"] as const){
      const bytes=keylessReviewDocument(kind,{...identity,dateOfBirth:"2007-10-01"}),text=bytes.toString();
      expect(text).toContain("Birth date: 2007-10-01");expect(text).not.toContain("2000-01-31");
      expect(text).toContain("/Count 2");expect(text).toContain("1 0 0 rg");expect(text).toContain("0 0 1 rg");
      expect(text).not.toMatch(/\/JavaScript|\/JS\b|\/URI\b|\/Launch\b|https?:|file:/u);
    }
  });
  it("refuses calendar rollover and PDF/text injection while retaining genuine leap days",()=>{
    expect(()=>keylessReviewDocument("birth",{...identity,dateOfBirth:"2000-02-29"})).not.toThrow();
    for(const dateOfBirth of ["1900-02-29","2007-02-29","2007-13-01","2007-04-31","2007-10-01) /JS",""])
      expect(()=>keylessReviewDocument("birth",{...identity,dateOfBirth})).toThrow();
    expect(()=>keylessReviewDocument("photo",{...identity,fullName:"Synthetic Name) /JS"})).toThrow();
  });
});

describe("actual installed provider SDK authenticates the software-only callback",()=>{
  function configured(){
    vi.stubEnv("INHERIT_CI_SYNTHETIC_WEBHOOK_SECRET",`whsec_${randomBytes(32).toString("base64")}`);
    vi.stubEnv("RESEND_API_KEY",randomBytes(24).toString("base64url"));
    return new Resend(process.env.RESEND_API_KEY);
  }
  function verify(sdk:Resend,callback:ReturnType<typeof syntheticDeliveredCallback>){
    return sdk.webhooks.verify({payload:callback.payload,webhookSecret:process.env.INHERIT_CI_SYNTHETIC_WEBHOOK_SECRET!,
      headers:{id:callback.headers["svix-id"],timestamp:callback.headers["svix-timestamp"],signature:callback.headers["svix-signature"]}});
  }
  it("verifies the accepted local message ID and current timestamp without a network request",()=>{
    const sdk=configured(),id=randomUUID(),callback=syntheticDeliveredCallback(id);
    expect(verify(sdk,callback)).toEqual(JSON.parse(callback.payload));
    expect(JSON.parse(callback.payload)).toMatchObject({type:"email.delivered",data:{email_id:id}});
    expect(callback.payload.includes(process.env.INHERIT_CI_SYNTHETIC_WEBHOOK_SECRET!)).toBe(false);
  });
  it("refuses changed payloads, identities and signatures using the unchanged real SDK verifier",()=>{
    const sdk=configured(),id=randomUUID(),callback=syntheticDeliveredCallback(id);
    expect(()=>verify(sdk,{...callback,payload:callback.payload.replace(id,randomUUID())})).toThrow();
    expect(()=>verify(sdk,{...callback,headers:{...callback.headers,"svix-id":randomUUID()}})).toThrow();
    expect(()=>verify(sdk,{...callback,headers:{...callback.headers,"svix-signature":"v1,invalid"}})).toThrow();
  });
  it("refuses correctly signed past/future callback clocks outside the real installed tolerance",()=>{
    const sdk=configured();
    for(const difference of [-10*60_000,10*60_000])
      expect(()=>verify(sdk,syntheticDeliveredCallback(randomUUID(),new Date(Date.now()+difference)))).toThrow();
  });
  it("cannot manufacture a callback without this run's ephemeral environment key or accepted UUID",()=>{
    configured();expect(()=>syntheticDeliveredCallback("not-an-accepted-message")).toThrow();
    expect(()=>syntheticDeliveredCallback(randomUUID(),new Date(NaN))).toThrow();
    vi.stubEnv("INHERIT_CI_SYNTHETIC_WEBHOOK_SECRET","");expect(()=>syntheticDeliveredCallback(randomUUID())).toThrow();
  });
});
