import {randomUUID} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import type {SubjectExportHttpDependencies} from "./subject-export-http";
const present=vi.hoisted(()=>({create:vi.fn(),open:vi.fn(),cookies:vi.fn(()=>[] as {value:string}[])}));
vi.mock("./subject-export-http",()=>({subjectExportHttpDependencies:()=>({generation:null}),
 presentSubjectExportCreate:present.create,presentSubjectExportOpen:present.open}));
vi.mock("next/headers",()=>({cookies:async()=>({getAll:present.cookies})}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>{throw new Error("unexpected-database-read");}}));
import {subjectExportControls} from "./subject-export-controls";

const actor={accountId:randomUUID(),sessionId:randomUUID()};
function deps(delivery=false):SubjectExportHttpDependencies{
 return {actor:async()=>actor,origin:()=>"https://test.e2e.local",rpc:()=>{throw new Error("unused");},generation:{} as never,
  ...(delivery?{delivery:{} as never}:{})};
}
describe("one-record export presentation",()=>{
 it("shows nothing while no generation capability is configured, without Auth or a database read",async()=>{
  expect(await subjectExportControls()).toBeNull();expect(present.create).not.toHaveBeenCalled();
 });
 it("presents each own record's action, its stated refusal, or an unavailable control",async()=>{
  const self=randomUUID(),adult=randomUUID(),joint=randomUUID();
  const create={operation:"create",nonce:"synthetic-action",csrf:"synthetic-csrf"};
  present.create.mockImplementation(async(_deps:unknown,id:string)=>id===self?create:id===joint?{refusal:"jointResults"}:(()=>{throw new Error("current_source_unavailable");})());
  const items=await subjectExportControls(deps(),async()=>[{id:self,subject_class:"self",display_label:null},
   {id:joint,subject_class:"other_adult",display_label:"Synthetic adult"},{id:adult,subject_class:"other_adult",display_label:null}]);
  expect(items).toEqual([
   {subjectId:self,self:true,label:null,route:`/api/subjects/${self}/export`,control:{available:true,create}},
   {subjectId:joint,self:false,label:"Synthetic adult",route:`/api/subjects/${joint}/export`,control:{available:false,refusal:"jointResults"}},
   {subjectId:adult,self:false,label:null,route:`/api/subjects/${adult}/export`,control:{available:false}}]);
  expect(present.create.mock.calls.every(([,,signal])=>(signal as AbortSignal).aborted)).toBe(true);
  expect(present.open).not.toHaveBeenCalled();
 });
 it("asks for an open proof only with the one export cookie and a delivery capability",async()=>{
  const self=randomUUID(),create={operation:"create",nonce:"a",csrf:"b"},open={status:"ready",operation:"open-ready",nonce:"c",csrf:"d"};
  present.create.mockResolvedValue(create);present.open.mockResolvedValue(open);present.cookies.mockReturnValue([{value:`${randomUUID()}.secret`}]);
  const items=await subjectExportControls(deps(true),async()=>[{id:self,subject_class:"self",display_label:null}]);
  expect(items![0].control).toEqual({available:true,create,open});
  const request=present.open.mock.calls[0][0] as Request;expect(new URL(request.url).pathname).toBe(`/api/subjects/${self}/export`);
  present.cookies.mockReturnValue([{value:"a"},{value:"b"}]);present.open.mockClear();
  expect((await subjectExportControls(deps(true),async()=>[{id:self,subject_class:"self",display_label:null}]))![0].control).toEqual({available:true,create});
  expect(present.open).not.toHaveBeenCalled();
 });
});
