import {randomBytes} from "node:crypto";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {readIdentityProfileOperation} from "./identity-profile-operation";

const mocks=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),open:vi.fn()}));
vi.mock("@/lib/account-deletion",()=>({getSensitiveAccountContext:mocks.auth}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({rpc:mocks.rpc})}));
vi.mock("./claims-open",()=>({futurePersonClaimsOpen:mocks.open}));
import {identityProfileControls} from "./identity-profile-controls";

const NOW=Date.parse("2026-10-01T00:00:00Z"),A="49000000-0000-4000-8000-000000000001",B="49000000-0000-4000-8000-000000000002";
const C="49000000-0000-4000-8000-000000000003",D="49000000-0000-4000-8000-000000000004";
const context={embryoId:A,subjectId:B,actorPrincipal:C,basisFingerprint:"a".repeat(64),basisRevision:1,
  participantSetRevision:1,recipientSetRevision:1,cohortLifecycleRevision:1,subjectLifecycleRevision:1,dispositionRevision:1,
  accountRevision:1,authSessionRevision:1,sessionRevision:1,consentSignatureId:D,currentProfileId:C,
  nextIdentityRevision:2,expiresAt:"2040-10-01T00:00:00Z"};
const erase={...context,consentSignatureId:null,basisFingerprint:"b".repeat(64)};
const item={embryoId:A,label:"Synthetic record",hasProfile:true,expiresAt:context.expiresAt,saveContext:context,deleteContext:erase};
beforeEach(()=>{vi.clearAllMocks();vi.spyOn(console,"warn").mockImplementation(()=>{});vi.stubEnv("BYOK_ENCRYPTION_KEY",randomBytes(32).toString("base64"));
  mocks.open.mockReturnValue(true);mocks.auth.mockResolvedValue({user:{id:B},sessionId:C});
  mocks.rpc.mockResolvedValue({data:{items:[item],nextCursor:D},error:null});});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
it("renders only display status and prospective stateless proofs, with no profile or authority DTO fields",async()=>{
  const result=await identityProfileControls(null,NOW);expect(result).toMatchObject({unavailable:false,nextCursor:D});
  const control=result!.items[0];expect(Object.keys(control).sort()).toEqual(["delete","embryoId","expiresAt","hasProfile","label","save"]);
  expect(readIdentityProfileOperation(control.save!.operationNonce,control.save!.csrf,
    {accountId:B,sessionId:C,embryoId:A,operation:"save"},context,NOW)).not.toBeNull();
  expect(readIdentityProfileOperation(control.delete!.operationNonce,control.delete!.csrf,
    {accountId:B,sessionId:C,embryoId:A,operation:"delete"},erase,NOW)).not.toBeNull();
  expect(control.save!.operationNonce).not.toBe(control.delete!.operationNonce);
  expect(JSON.stringify(result)).not.toMatch(/parentNames|childDateOfBirth|ciphertext|wrapped|matchIndexes|basisFingerprint|actorPrincipal/u);
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("future_person_profile_controls_v1",{p_account:B,p_session:C,p_after:null});
  const next=await identityProfileControls(D,NOW);expect(next!.items[0].save!.operationNonce).not.toBe(control.save!.operationNonce);
  expect(mocks.rpc).toHaveBeenLastCalledWith("future_person_profile_controls_v1",{p_account:B,p_session:C,p_after:D});
  expect(mocks.rpc.mock.calls.every(call=>call[0]==="future_person_profile_controls_v1")).toBe(true);
});
it("keeps deletion available without a new consent and suppresses delete when no profile exists",async()=>{
  mocks.rpc.mockResolvedValueOnce({data:{items:[{...item,saveContext:null}],nextCursor:null},error:null});
  const eraseOnly=await identityProfileControls(null,NOW);expect(eraseOnly!.items[0].save).toBeNull();expect(eraseOnly!.items[0].delete).not.toBeNull();
  mocks.rpc.mockResolvedValueOnce({data:{items:[{...item,hasProfile:false,deleteContext:{...erase,currentProfileId:null},
    saveContext:{...context,currentProfileId:null}}],nextCursor:null},error:null});
  const empty=await identityProfileControls(null,NOW);expect(empty!.items[0].delete).toBeNull();expect(empty!.items[0].save).not.toBeNull();
});
it("closes production and anonymous requests before private reads and refuses malformed cursors",async()=>{
  mocks.open.mockReturnValueOnce(false);expect(await identityProfileControls()).toBeNull();expect(mocks.auth).not.toHaveBeenCalled();
  mocks.auth.mockResolvedValueOnce(null);expect(await identityProfileControls()).toBeNull();expect(mocks.rpc).not.toHaveBeenCalled();
  expect(await identityProfileControls("forbidden")).toEqual({items:[],nextCursor:null,unavailable:true});expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each(["unknown-profile-field","cross-record","cross-subject","cross-session-revision","profile-status","save-signature","expired","duplicate","oversize","invalid-cursor"])("fails closed for %s without issuing usable controls",async kind=>{
  const data={items:[structuredClone(item)],nextCursor:D};
  if(kind==="unknown-profile-field")Object.assign(data.items[0],{parentNames:["forbidden"]});
  if(kind==="cross-record")data.items[0].saveContext.embryoId=D;
  if(kind==="cross-subject")data.items[0].saveContext.subjectId=D;
  if(kind==="cross-session-revision")data.items[0].saveContext.sessionRevision=2;
  if(kind==="profile-status")data.items[0].hasProfile=false;
  if(kind==="save-signature")Object.assign(data.items[0].saveContext,{consentSignatureId:null});
  if(kind==="expired")data.items[0].saveContext.expiresAt=data.items[0].deleteContext.expiresAt=data.items[0].expiresAt=new Date(NOW).toISOString();
  if(kind==="duplicate")data.items.push(structuredClone(item));
  if(kind==="oversize")data.items=Array.from({length:65},()=>structuredClone(item));
  if(kind==="invalid-cursor")data.nextCursor="forbidden";
  mocks.rpc.mockResolvedValueOnce({data,error:null});
  expect(await identityProfileControls(null,NOW)).toEqual({items:[],nextCursor:null,unavailable:true});
});
it("keeps source failures closed without exposing database error details",async()=>{
  mocks.rpc.mockResolvedValueOnce({data:null,error:{message:"forbidden protected evidence"}});
  expect(await identityProfileControls(null,NOW)).toEqual({items:[],nextCursor:null,unavailable:true});
  mocks.rpc.mockRejectedValueOnce(new Error("forbidden protected evidence"));
  expect(await identityProfileControls(null,NOW)).toEqual({items:[],nextCursor:null,unavailable:true});
});
it("keeps the original parent's fresh saved-profile delete authority after the other parent saved",async()=>{
  const savedId="49000000-0000-4000-8000-000000000005";
  const ownerSave={...context,actorPrincipal:D,consentSignatureId:A,currentProfileId:savedId,nextIdentityRevision:3};
  const ownerErase={...ownerSave,consentSignatureId:null,basisFingerprint:"c".repeat(64)};
  mocks.auth.mockResolvedValueOnce({user:{id:B},sessionId:C});
  mocks.rpc.mockResolvedValueOnce({data:{items:[{...item,saveContext:ownerSave,deleteContext:ownerErase}],nextCursor:null},error:null});
  const result=await identityProfileControls(null,NOW);expect(result!.unavailable).toBe(false);
  const control=result!.items[0];expect(control.hasProfile).toBe(true);expect(control.delete).not.toBeNull();
  expect(readIdentityProfileOperation(control.delete!.operationNonce,control.delete!.csrf,
    {accountId:B,sessionId:C,embryoId:A,operation:"delete"},ownerErase,NOW)).not.toBeNull();
  expect(readIdentityProfileOperation(control.delete!.operationNonce,control.delete!.csrf,
    {accountId:D,sessionId:C,embryoId:A,operation:"delete"},ownerErase,NOW)).toBeNull();
  expect(console.warn).not.toHaveBeenCalled();
});
it("identifies RPC/schema/proof stages without logging sensitive fields or changing the generic refusal",async()=>{
  const refused={items:[],nextCursor:null,unavailable:true};
  mocks.rpc.mockResolvedValueOnce({data:null,error:{code:"40P01",message:"protected SQL",details:"protected authority"}});
  expect(await identityProfileControls(null,NOW)).toEqual(refused);
  expect(console.warn).toHaveBeenLastCalledWith("identity_profile_controls_unavailable",{stage:"rpc",code:"40P01"});
  const bad=structuredClone(item);bad.deleteContext.currentProfileId="protected profile";
  mocks.rpc.mockResolvedValueOnce({data:{items:[bad],nextCursor:null},error:null});
  expect(await identityProfileControls(null,NOW)).toEqual(refused);
  const schema=vi.mocked(console.warn).mock.calls.at(-1)![1];expect(schema).toMatchObject({stage:"schema"});
  expect(JSON.stringify(schema)).toContain("currentProfileId");expect(JSON.stringify(schema)).not.toContain("protected profile");
  const expired=structuredClone(item);expired.expiresAt=expired.saveContext.expiresAt=expired.deleteContext.expiresAt=new Date(NOW).toISOString();
  mocks.rpc.mockResolvedValueOnce({data:{items:[expired],nextCursor:null},error:null});
  expect(await identityProfileControls(null,NOW)).toEqual(refused);
  expect(console.warn).toHaveBeenLastCalledWith("identity_profile_controls_unavailable",{stage:"proof",code:"unavailable"});
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/protected SQL|protected authority|protected profile|[a-f0-9]{64}/u);
});
it("retains the generic refusal if a response or schema accessor throws, without exposing the exception",async()=>{
  mocks.rpc.mockResolvedValueOnce(Object.defineProperty({data:null},"error",{get(){throw new Error("protected RPC getter");}}));
  expect(await identityProfileControls(null,NOW)).toEqual({items:[],nextCursor:null,unavailable:true});
  expect(console.warn).toHaveBeenLastCalledWith("identity_profile_controls_unavailable",{stage:"rpc",code:"unavailable"});
  const data=Object.defineProperty({},"items",{get(){throw new Error("protected schema getter");}});
  mocks.rpc.mockResolvedValueOnce({data,error:null});
  expect(await identityProfileControls(null,NOW)).toEqual({items:[],nextCursor:null,unavailable:true});
  expect(console.warn).toHaveBeenLastCalledWith("identity_profile_controls_unavailable",{stage:"schema",issues:[{code:"unavailable",field:"inventory"}]});
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/protected|getter/u);
});
