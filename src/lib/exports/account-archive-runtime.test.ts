import {randomUUID} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import {accountArchiveExecution} from "./account-archive-runtime";
import {accountArchiveGenerationCapability,approvedAccountArchiveGeneration} from "./account-archive-generation";
const sdk=vi.hoisted(()=>({create:vi.fn(),rpc:vi.fn(),retry:vi.fn(),abort:vi.fn()}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:sdk.create}));
vi.mock("@/lib/genome/prepared-source/storage-common",async importOriginal=>({
 ...await importOriginal<typeof import("@/lib/genome/prepared-source/storage-common")>(),
 preparedStorageConfig:()=>({origin:"https://store.e2e.local",key:"synthetic-service-store-key"}),
}));
afterEach(()=>{vi.clearAllMocks();vi.unstubAllGlobals();});
function fixture(){
 sdk.create.mockImplementation(()=>({rpc:sdk.rpc}));sdk.rpc.mockImplementation(()=>({retry:sdk.retry}));
 sdk.retry.mockImplementation(()=>({abortSignal:sdk.abort}));sdk.abort.mockResolvedValue({data:{stored:true},error:null});
 const write=vi.fn<Parameters<typeof accountArchiveExecution>[0]>(),execution=accountArchiveExecution(write);
 return {write,execution,signal:new AbortController().signal};
}
describe("real consumed account SDK composition",()=>{
 it("constructs no client, target read or provider write while configuration is still closed",()=>{
  const f=fixture();expect(approvedAccountArchiveGeneration()).toBeNull();
  const check=vi.fn(async()=>{}),capability=accountArchiveGenerationCapability({write:f.write,assertReady:check});
  expect(capability.assertReady).toBe(check);expect(capability.execution.write).toBe(f.write);
  expect(sdk.create).not.toHaveBeenCalled();expect(sdk.rpc).not.toHaveBeenCalled();expect(f.write).not.toHaveBeenCalled();expect(check).not.toHaveBeenCalled();
 });
 it("uses all eight actual named member/source service doors with POST, disabled retry and the consumer's signal",async()=>{
  const f=fixture(),reference={p_export_id:randomUUID(),p_attempt_id:randomUUID(),p_authority_receipt:"a".repeat(64)};
  await f.execution.memberRpc("export_archive_account_members_v1",{...reference,p_operation:"context",p_subject_id:null,p_after_id:null},f.signal);
  await f.execution.contentRpc("export_archive_account_content_v1",{...reference,p_operation:"chats",p_payload:{}},f.signal);
  await f.execution.metadataRpc("export_archive_account_metadata_v1",{...reference,p_operation:"context",p_after_id:null},f.signal);
  await f.execution.inventoryRpc("export_archive_account_inventory_v1",{...reference,p_operation:"context",p_kind:null,p_after_id:null},f.signal);
  await f.execution.classRpc("export_archive_account_classes_v1",{...reference,p_operation:"context",p_kind:null,p_after_id:null},f.signal);
  await f.execution.auditRpc("export_archive_account_audit_v1",{...reference,p_operation:"context",p_subject_id:null,p_after_seq:null},f.signal);
  await f.execution.originalRpc("export_archive_account_original_v1",{...reference,p_operation:"descriptor",p_file_id:randomUUID(),p_expected:null},f.signal);
  await f.execution.boundSourceRpc("export_archive_account_bound_source_v1",{...reference,p_subject_id:randomUUID(),p_operation:"manifest",p_expected:null},f.signal);
  expect(sdk.create).toHaveBeenCalledTimes(1);expect(sdk.rpc.mock.calls.map(([name])=>name)).toEqual([
   "export_archive_account_members_v1","export_archive_account_content_v1","export_archive_account_metadata_v1","export_archive_account_inventory_v1",
   "export_archive_account_classes_v1","export_archive_account_audit_v1","export_archive_account_original_v1","export_archive_account_bound_source_v1"]);
  expect(sdk.rpc.mock.calls.every(([,args,options])=>Object.entries(reference).every(([key,value])=>args[key]===value)
   &&JSON.stringify(options)==='{"get":false,"head":false}')).toBe(true);
  expect(sdk.retry.mock.calls.every(([enabled])=>enabled===false)).toBe(true);
  expect(sdk.abort.mock.calls.every(([signal])=>signal===f.signal)).toBe(true);expect(f.write).not.toHaveBeenCalled();
 });
 it("preserves real durable worker operations without any target or human JWT substitution",async()=>{
  const f=fixture(),args={p_operation:"begin" as const,p_export_id:randomUUID(),p_attempt_id:randomUUID(),p_authority_receipt:"b".repeat(64),p_payload:null};
  expect(await f.execution.workerRpc("export_archive_worker_v1",args,{get:false,head:false}).retry(false).abortSignal(f.signal)).toEqual({data:{stored:true},error:null});
  expect(sdk.rpc.mock.calls).toEqual([["export_archive_worker_v1",args,{get:false,head:false}]]);
  expect(sdk.retry.mock.calls).toEqual([[false]]);expect(sdk.abort.mock.calls).toEqual([[f.signal]]);
 });
 it("rejects a crossed RPC name, canceled reader or missing writer before creating a service client",async()=>{
  const f=fixture(),stop=new AbortController();stop.abort();
  const read=f.execution.memberRpc as unknown as(name:string,args:unknown,signal:AbortSignal)=>PromiseLike<unknown>;
  expect(()=>read("unregistered_reader",{},f.signal)).toThrow();expect(()=>read("export_archive_account_members_v1",{},stop.signal)).toThrow();
  expect(()=>accountArchiveExecution(null as never)).toThrow();expect(sdk.create).not.toHaveBeenCalled();expect(sdk.rpc).not.toHaveBeenCalled();
 });
 it("keeps original bytes on the existing fixed store, with no delivery URL, prefix or archive writer inference",async()=>{
  const f=fixture(),response=new Response(new Uint8Array([1]),{status:206});
  const transport=vi.fn(async()=>response);vi.stubGlobal("fetch",transport);
  const source={version:"account-original-download-v1" as const,fileId:randomUUID(),sourceRevision:1,rawSha256:"c".repeat(64),
   bucket:"genomes" as const,objectId:randomUUID(),objectKey:randomUUID(),storageVersion:randomUUID(),sizeBytes:1,expiresAt:new Date(Date.now()+60000).toISOString()};
  expect(await f.execution.readOriginalRange(source,0,0,f.signal)).toBe(response);
  expect(transport).toHaveBeenCalledWith(`https://store.e2e.local/storage/v1/object/authenticated/genomes/${source.objectKey}`,{
   method:"GET",signal:f.signal,cache:"no-store",redirect:"error",headers:{Authorization:"Bearer synthetic-service-store-key",apikey:"synthetic-service-store-key",
    "Accept-Encoding":"identity",Range:"bytes=0-0"}});
  expect(f.write).not.toHaveBeenCalled();expect(sdk.create).not.toHaveBeenCalled();
 });
});
