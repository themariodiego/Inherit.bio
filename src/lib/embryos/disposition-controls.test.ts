import {randomBytes} from "node:crypto";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {readEmbryoOperation,verifyEmbryoOperation} from "./operation-token";
const mocks=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),open:vi.fn()}));
vi.mock("@/lib/account-deletion",()=>({getSensitiveAccountContext:mocks.auth}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({rpc:mocks.rpc})}));
vi.mock("@/lib/future-person/claims-open",()=>({futurePersonClaimsOpen:mocks.open}));
import {embryoDispositionControls} from "./disposition-controls";
const NOW=Date.parse("2026-10-01T00:00:00Z"),E="50000000-0000-4000-8000-000000000001",
  A="50000000-0000-4000-8000-000000000002",S="50000000-0000-4000-8000-000000000003",
  P="50000000-0000-4000-8000-000000000004";
const row={embryoId:E,label:"Embryo 1",mode:"two-parent-propose-confirm",currentDisposition:"unknown",proposal:null};
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("BYOK_ENCRYPTION_KEY",randomBytes(32).toString("base64"));
  mocks.open.mockReturnValue(true);mocks.auth.mockResolvedValue({user:{id:A},sessionId:S});
  mocks.rpc.mockResolvedValue({data:{items:[row],nextCursor:P},error:null});});
afterEach(()=>vi.unstubAllEnvs());
it("mints a real exact-account/session/operation/record token only after one read-only authority inventory",async()=>{
  const result=await embryoDispositionControls(null,NOW),control=result!.items[0];
  expect(result).toMatchObject({unavailable:false,nextCursor:P});
  expect(Object.keys(control).sort()).toEqual(["currentDisposition","embryoId","label","mode","nonce","proposal"]);
  const expected={accountId:A,sessionId:S,operation:"embryo_disposition" as const,targetKind:"embryo" as const,targetId:E};
  expect(verifyEmbryoOperation(control.nonce!,expected,NOW)).not.toBeNull();
  for(const changed of [{accountId:P},{sessionId:P},{targetId:P},{operation:"record_key_print" as const}])
    expect(verifyEmbryoOperation(control.nonce!,{...expected,...changed},NOW)).toBeNull();
  expect(readEmbryoOperation(control.nonce!,NOW)!.expiresAt).toBe(NOW+600_000);
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("embryo_disposition_controls_v1",{p_account:A,p_session:S,p_after:null});
  expect(JSON.stringify(result)).not.toMatch(/actorPrincipal|basisFingerprint|genotypes|scores|rank|qc_verdict/u);
  const next=await embryoDispositionControls(P,NOW);expect(next!.items[0].nonce).not.toBe(control.nonce);
  expect(mocks.rpc).toHaveBeenLastCalledWith("embryo_disposition_controls_v1",{p_account:A,p_session:S,p_after:P});
});
it("suppresses self-confirmation and issues the other parent confirmation proof without changing the proposal",async()=>{
  const pending={id:P,disposition:"transferred",expiresAt:new Date(NOW+86400_000).toISOString(),callerIsProposer:true};
  mocks.rpc.mockResolvedValueOnce({data:{items:[{...row,proposal:pending}],nextCursor:null},error:null});
  expect((await embryoDispositionControls(null,NOW))!.items[0]).toEqual({...row,proposal:pending,nonce:null});
  mocks.rpc.mockResolvedValueOnce({data:{items:[{...row,proposal:{...pending,callerIsProposer:false}}],nextCursor:null},error:null});
  expect((await embryoDispositionControls(null,NOW))!.items[0].nonce).not.toBeNull();
});
it("allows the single-authority direct mode while production and missing own Auth stop before trusted reads",async()=>{
  mocks.rpc.mockResolvedValueOnce({data:{items:[{...row,mode:"single-authority-direct"}],nextCursor:null},error:null});
  expect((await embryoDispositionControls(null,NOW))!.items[0].nonce).not.toBeNull();
  vi.clearAllMocks();mocks.open.mockReturnValueOnce(false);expect(await embryoDispositionControls()).toBeNull();
  expect(mocks.auth).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.auth.mockResolvedValueOnce(null);expect(await embryoDispositionControls()).toBeNull();expect(mocks.rpc).not.toHaveBeenCalled();
  expect(await embryoDispositionControls("bad")).toEqual({items:[],nextCursor:null,unavailable:true});expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each(["extra","duplicate","oversize","bad-mode","single-proposal","expired-proposal","stored-proposal","bad-cursor"])("refuses %s without rendering prospective controls",async kind=>{
  const item:Record<string,unknown>=structuredClone(row),pending={id:P,disposition:"stored",expiresAt:new Date(NOW+86400_000).toISOString(),callerIsProposer:false};
  let items=[item],nextCursor:string|null=null;
  if(kind==="extra")item.genotypes=[];
  if(kind==="duplicate")items.push({...item});
  if(kind==="oversize")items=Array.from({length:65},()=>({...item}));
  if(kind==="bad-mode")item.mode="custody-owner";
  if(kind==="single-proposal"){item.mode="single-authority-direct";item.proposal=pending;}
  if(kind==="expired-proposal")item.proposal={...pending,expiresAt:new Date(NOW).toISOString()};
  if(kind==="stored-proposal"){item.currentDisposition="stored";item.proposal=pending;}
  if(kind==="bad-cursor")nextCursor="bad";
  mocks.rpc.mockResolvedValueOnce({data:{items,nextCursor},error:null});
  expect(await embryoDispositionControls(null,NOW)).toEqual({items:[],nextCursor:null,unavailable:true});
});
it("keeps actual source failures closed and passes through an empty current inventory",async()=>{
  mocks.rpc.mockResolvedValueOnce({data:{items:[],nextCursor:null},error:null});
  expect(await embryoDispositionControls(null,NOW)).toEqual({items:[],nextCursor:null,unavailable:false});
  mocks.rpc.mockResolvedValueOnce({data:null,error:{message:"protected evidence"}});
  expect(await embryoDispositionControls(null,NOW)).toEqual({items:[],nextCursor:null,unavailable:true});
  mocks.rpc.mockRejectedValueOnce(new Error("protected evidence"));
  expect(await embryoDispositionControls(null,NOW)).toEqual({items:[],nextCursor:null,unavailable:true});
});
