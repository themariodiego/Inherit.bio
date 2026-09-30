import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({open:vi.fn(),account:vi.fn(),rpc:vi.fn(),project:vi.fn()}));
vi.mock("next/navigation",()=>({notFound:()=>{throw new Error("opaque404");}}));
vi.mock("@/lib/future-person/claims-open",()=>({futurePersonClaimsOpen:mocks.open}));
vi.mock("@/lib/account-deletion",()=>({getSensitiveAccountContext:mocks.account}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc:mocks.rpc})}));
vi.mock("@/lib/future-person/review",()=>({isCanonicalId:(id:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id),reviewCaseBody:mocks.project}));
import Page from "./page";
const ID="11111111-1111-4111-8111-111111111111";
const run=(id=ID,search:Record<string,string>={})=>Page({params:Promise.resolve({id}),searchParams:Promise.resolve(search)});
beforeEach(()=>{vi.clearAllMocks();mocks.open.mockReturnValue(true);mocks.account.mockResolvedValue({user:{id:ID},sessionId:ID});mocks.rpc.mockResolvedValue({data:{bounded:true},error:null});mocks.project.mockReturnValue({claimId:ID});});
describe("the reviewer page's own-JWT authority",()=>{
 it("checks the exact current named-reviewer case before returning the viewer",async()=>{
  const rendered=await run();expect(rendered.type).toBe("main");expect(mocks.rpc.mock.calls).toEqual([["read_claim_review_case_v1",{p_review_id:ID}]]);
  expect(JSON.stringify(rendered)).not.toContain("bounded");
 });
 it("refuses an anonymous caller without calling any privileged reader",async()=>{
  mocks.account.mockResolvedValue(null);await expect(run()).rejects.toThrow("opaque404");expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it.each(["42501","P0001"])("refuses database failure %s with the same opaque page",async code=>{
  mocks.rpc.mockResolvedValue({data:null,error:{code}});await expect(run()).rejects.toThrow("opaque404");expect(mocks.project).not.toHaveBeenCalled();
 });
 it("refuses malformed or unprojectable cases",async()=>{mocks.project.mockReturnValue(null);await expect(run()).rejects.toThrow("opaque404");});
 it.each(["INVALID",ID.toUpperCase()])("refuses an invalid selector before any account read",async id=>{
  // The all-digit fixture has no upper-case variant; use an actual letter-bearing id.
  const invalid=id===ID?"abcdefab-1111-4111-8111-111111111111".toUpperCase():id;
  await expect(run(invalid)).rejects.toThrow("opaque404");expect(mocks.account).not.toHaveBeenCalled();
 });
 it("refuses a query selector before account lookup",async()=>{await expect(run(ID,{subject:ID})).rejects.toThrow("opaque404");expect(mocks.account).not.toHaveBeenCalled();});
 it("reads nothing on the closed deployment",async()=>{mocks.open.mockReturnValue(false);await expect(run()).rejects.toThrow("opaque404");expect(mocks.account).not.toHaveBeenCalled();});
});
