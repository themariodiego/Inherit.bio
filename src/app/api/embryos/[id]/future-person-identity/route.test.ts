import {randomBytes} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {mintIdentityProfileOperation,type IdentityProfileContext} from "@/lib/future-person/identity-profile-operation";
import {openIdentityProfile} from "@/lib/future-person/identity-profile";
import {PUT,DELETE} from "./route";
const A="48000000-0000-4000-8000-000000000001",S="48000000-0000-4000-8000-000000000002",
  E="48000000-0000-4000-8000-000000000003",P="48000000-0000-4000-8000-000000000004",C="48000000-0000-4000-8000-000000000005";
const input={childDateOfBirth:"2005-01-04",childPlaceOfBirth:"Synthetic Place",parentNames:["Synthetic Parent A","Synthetic Parent B"],consentSignatureId:C};
const expected:IdentityProfileContext={embryoId:E,subjectId:P,actorPrincipal:A,basisFingerprint:"a".repeat(64),basisRevision:1,
  participantSetRevision:1,recipientSetRevision:1,cohortLifecycleRevision:1,subjectLifecycleRevision:1,dispositionRevision:1,
  accountRevision:1,authSessionRevision:1,sessionRevision:1,consentSignatureId:C,currentProfileId:null,
  nextIdentityRevision:1,expiresAt:"2040-01-04T00:00:00+00:00"};
const mocks=vi.hoisted(()=>({account:null as null|{user:{id:string};sessionId:string},rpc:vi.fn(),context:null as unknown,write:null as unknown,error:null as null|{code:string}}));
vi.mock("@/lib/account-deletion",async original=>({...await original<typeof import("@/lib/account-deletion")>(),getSensitiveAccountContext:async()=>mocks.account}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({rpc:(...args:unknown[])=>mocks.rpc(...args)})}));
beforeEach(()=>{
  vi.stubEnv("BYOK_ENCRYPTION_KEY",randomBytes(32).toString("base64"));vi.stubEnv("INHERIT_HMAC_KEYRING","");
  vi.stubEnv("INHERIT_TEST_JURISDICTION","1");vi.stubEnv("NEXT_PUBLIC_APP_URL","https://inherit.bio");
  mocks.account={user:{id:A},sessionId:S};mocks.context=expected;mocks.write={status:"saved",expiresAt:expected.expiresAt};mocks.error=null;
  mocks.rpc.mockImplementation(async(name:string)=>({data:name==="future_person_profile_context_v1"?mocks.context:mocks.write,error:mocks.error}));
});
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
function req(operation:"save"|"delete",body:unknown=operation==="save"?input:undefined,headers:Record<string,string>={},tokenContext=operation==="save"?expected:{...expected,consentSignatureId:null}){
  const token=mintIdentityProfileOperation({accountId:A,sessionId:S,embryoId:E,operation},tokenContext);
  return new Request(`https://inherit.bio/api/embryos/${E}/future-person-identity`,{method:operation==="save"?"PUT":"DELETE",
    headers:{origin:"https://inherit.bio","sec-fetch-site":"same-origin","content-type":"application/json",
      "x-inherit-csrf":token.csrf,"x-inherit-operation-nonce":token.operationNonce,...headers},body:body===undefined?undefined:JSON.stringify(body)});
}
const routeContext={params:Promise.resolve({id:E})};
describe("closed parent identity profile endpoint",()=>{
  it("encrypts the actual supplied profile under the exact allocated scope and returns no identity values",async()=>{
    const response=await PUT(req("save"),routeContext);expect(response.status).toBe(200);
    expect(await response.json()).toEqual({status:"saved",expiresAt:expected.expiresAt});
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    const [name,args]=mocks.rpc.mock.calls[1];expect(name).toBe("write_future_person_profile_v1");
    expect(Object.keys(args).sort()).toEqual(["p_account","p_ciphertext","p_embryo","p_expected","p_indexes","p_nonce","p_profile","p_session","p_signature","p_wrapped_key"]);
    expect(args.p_expected).toEqual(expected);expect(args.p_account).toBe(A);expect(args.p_session).toBe(S);
    const cipher=Buffer.from(args.p_ciphertext.slice(2),"hex"),wrapper=args.p_wrapped_key.slice(2);
    expect(openIdentityProfile(cipher,wrapper,{profileId:args.p_profile,embryoId:E,identityRevision:1}))
      .toEqual({version:1,childDateOfBirth:input.childDateOfBirth,childPlaceOfBirth:input.childPlaceOfBirth,parentNames:input.parentNames});
    expect(JSON.stringify(args)).not.toContain("Synthetic");expect(JSON.stringify(args)).not.toContain("2005-01-04");
  });
  it("takes no body on delete and returns exactly an empty 204",async()=>{
    mocks.context={...expected,consentSignatureId:null};
    const response=await DELETE(req("delete"),routeContext);expect(response.status).toBe(204);expect(await response.text()).toBe("");
    expect(mocks.rpc.mock.calls[1][0]).toBe("delete_future_person_profile_v1");
  });
  it.each(["production","unknown","foreign-origin","missing-operation","missing-csrf","extra-field","invalid-date","body-on-delete","huge"])("refuses %s before the write",async kind=>{
    let request=req("save"),context=routeContext,method=PUT;
    if(kind==="production")vi.stubEnv("INHERIT_TEST_JURISDICTION","");
    if(kind==="unknown")context={params:Promise.resolve({id:"unknown"})};
    if(kind==="foreign-origin")request=req("save",input,{origin:"https://foreign.invalid"});
    if(kind==="missing-operation")request=req("save",input,{"x-inherit-operation-nonce":""});
    if(kind==="missing-csrf")request=req("save",input,{"x-inherit-csrf":""});
    if(kind==="extra-field")request=req("save",{...input,subjectId:P});
    if(kind==="invalid-date")request=req("save",{...input,childDateOfBirth:"2005-02-30"});
    if(kind==="body-on-delete"){method=DELETE;request=req("delete",{});}
    if(kind==="huge")request=req("save",{...input,parentNames:["x".repeat(9000)]});
    const response=await method(request,context);expect([403,404,422]).toContain(response.status);
    expect(mocks.rpc.mock.calls.every(call=>call[0]==="future_person_profile_context_v1")).toBe(true);
  });
  it("requires Auth before reading a profile or accepting a client identity",async()=>{
    mocks.account=null;const response=await PUT(req("save"),routeContext);expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses a changed authority receipt even if the page token remains correctly signed",async()=>{
    mocks.context={...expected,recipientSetRevision:2};const response=await PUT(req("save"),routeContext);
    expect(response.status).toBe(404);expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["extra-context","cross-record","wrong-deadline","extra-success"])("blocks a database %s without leaking its data",async kind=>{
    if(kind==="extra-context")mocks.context={...expected,plaintext:"Synthetic"};
    if(kind==="cross-record")mocks.context={...expected,embryoId:P};
    if(kind==="wrong-deadline")mocks.write={status:"saved",expiresAt:"2041-01-04T00:00:00+00:00"};
    if(kind==="extra-success")mocks.write={...mocks.write as object,plaintext:"Synthetic"};
    const response=await PUT(req("save"),routeContext);expect(response.status).toBe(503);expect(await response.json()).toEqual({error:"unavailable"});
  });
});
