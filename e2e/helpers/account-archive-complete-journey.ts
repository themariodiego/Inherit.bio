import {createHash} from "node:crypto";
import {expect,type Page} from "@playwright/test";
import AdmZip from "adm-zip";
import {z} from "zod";
import {assertTestAccountArchiveFixtureAdmission} from "../../src/lib/exports/account-archive-test-admission";
import {accountCompleteContextSchema} from "../../src/lib/exports/account-complete-context";
import {accountArchiveReadySchema} from "../../src/lib/exports/account-archive-test-publication";
import {withAccountArchiveR2Owner} from "../../src/lib/exports/account-archive-r2";
import {createRequesterStatementRuntime} from "../../src/lib/exports/requester-statement-runtime";
import {ACCOUNT_SUBJECT_MEMBERS} from "../../src/lib/exports/account-subject-member-names";
import {accountExportPreparing,accountExportReady,accountExportDownload} from "../../src/lib/exports/account-export-delivery-contract";

type Original={fileId:string;bytes:Uint8Array};
const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
const unavailable=()=>new Error("account_archive_test_journey_unavailable");
const uuid=z.uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/u),count=z.number().int().nonnegative().safe();
const manifestSchema=z.object({schemaVersion:z.literal("subject-partitioned-archive-v1"),capturedAt:z.iso.datetime({offset:true}),
 subjectPartitions:z.array(uuid),files:z.array(z.unknown()),resultSources:z.array(z.unknown()).optional(),
 completeReceipt:accountCompleteContextSchema.shape.completeReceipt,dispositions:accountCompleteContextSchema.shape.dispositions,
 members:z.array(z.object({name:z.string().min(1),sizeBytes:count,sha256:hash,rows:count,fileId:uuid.nullable(),subjectId:uuid.nullable()}).strict())}).strict();
const allocationProofSchema=z.object({count:count.positive(),written:count,disposed:count,absent:count,deleted:count,
 identitySha256:hash,deadlinePassed:z.boolean(),stopped:z.boolean(),cleanupDue:z.boolean()}).strict();
type AllocationProof=z.infer<typeof allocationProofSchema>;
async function allocationProof(exportId:string,attemptId:string,accountId:string,signal:AbortSignal){
 const runtime=createRequesterStatementRuntime(),deadline=Date.now()+30_000;
 try{return await withAccountArchiveR2Owner(process.env,signal,runtime,async tx=>{
  const rows=await tx<{proof:unknown}[]>`select jsonb_build_object(
   'count',count(*),'written',count(*) filter(where r.written_at is not null),
   'disposed',count(*) filter(where r.disposed_at is not null),
   'absent',count(*) filter(where r.disposed_at is not null and r.disposal_evidence=jsonb_build_object(
    'version','account-archive-r2-object-absent-v1','reservationSha256',r.disposal_evidence->>'reservationSha256',
    'allocationSha256',r.allocation_sha256,'disposition','current-object-absent','historyScope','current-object-only','terminal',true,'absent',true)
     and r.disposal_evidence->>'reservationSha256'~'^[a-f0-9]{64}$'),
   'deleted',count(*) filter(where s.delete_acknowledged_at is not null),
   'identitySha256',encode(extensions.digest(convert_to(jsonb_agg(to_jsonb(r)-array[
    'disposal_claim','disposal_claim_expires_at','disposed_at','disposal_evidence'] order by r.ordinal)::text,'UTF8'),'sha256'),'hex'),
   'deadlinePassed',bool_and(r.original_deadline+interval '30 seconds'<=clock_timestamp()),
   'stopped',bool_and(a.state='cleanup_pending' and a.stopped_at is not null),
   'cleanupDue',bool_and(a.cleanup_not_before<=clock_timestamp())
   ) as proof from private.account_archive_r2_allocations r
   join private.export_archive_segments s on s.attempt_id=r.attempt_id and s.ordinal=r.ordinal
   join private.export_archive_attempts a on a.id=r.attempt_id
   join private.export_archive_jobs j on j.export_id=a.export_id
   join public.generated_exports e on e.id=j.export_id
   where r.attempt_id=${attemptId}::uuid and j.export_id=${exportId}::uuid and e.account_id=${accountId}::uuid
    and e.target_kind='account' and e.target_id=e.account_id and e.origin_kind='account'
    and j.origin->>'kind'='account' and j.origin->>'accountId'=e.account_id::text
    and j.route_id='api.export' and j.export_contract='account-export-v1'`;
  if(rows.length!==1)throw unavailable();return allocationProofSchema.parse(rows[0]?.proof);
 });}finally{await runtime.settle(deadline);runtime.assertSettled();}
}

/** This supplemental journey is invoked only by Root's admitted private R2
 * TEST fixture, outside the unchanged standard closed browser servers. The
 * caller creates real Auth/uploads/consents through the existing user flows.
 * Worker output is ignored: the UI, complete native capture and actual saved
 * ZIP independently prove production of the bytes. No provider is mocked. */
export async function exerciseCompleteAccountArchiveDelivery(options:{page:Page;accountId:string;jobSecret:string;
 originals:readonly Original[];expectedSubjects:readonly string[];signal:AbortSignal}){
 const {page,signal}=options;
 if(!options.jobSecret||options.jobSecret.length>4096||!options.originals.length||!options.expectedSubjects.length)throw unavailable();
 const admission=await assertTestAccountArchiveFixtureAdmission({signal});
 // Only the public file-system sink is observed. It receives real verified
 // browser download writes; Auth, API, worker, Storage and native source remain
 // real. This small invented fixture can retain its ZIP for full member checks.
 await page.addInitScript(()=>{
  const state={chunks:[] as number[][],closed:false,aborted:false};
  Object.defineProperty(window,"__inheritArchiveSink",{value:state});
  Object.defineProperty(window,"showSaveFilePicker",{value:async()=>({createWritable:async()=>({
   write:async(bytes:Uint8Array)=>{if(state.closed||state.aborted)throw new Error("closed");state.chunks.push(Array.from(bytes));},
   close:async()=>{if(state.aborted)throw new Error("aborted");state.closed=true;},
   abort:async()=>{state.aborted=true;state.chunks=[];},
  })})});
 });
 await page.goto("/settings/data");
 const create=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/export"&&response.request().method()==="POST");
 await page.getByRole("button",{name:"Prepare complete export",exact:true}).click();
 const created=await create;expect(created.status()).toBe(202);const request=accountExportPreparing.parse(await created.json());
 await expect(page.getByRole("button",{name:"Prepare complete export",exact:true})).toBeDisabled();
 // The selected live app job credential is supplied at invocation, never a
 // fixed hosted fallback. It is used only by the Node test request context.
 const generated=await page.request.post("/api/jobs/account-export",{headers:{authorization:`Bearer ${options.jobSecret}`,
  "X-Inherit-Account-Export-Operation":"generation"}});
 expect(generated.status()).toBe(204);expect(await generated.body()).toHaveLength(0);
 const checked=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/export"&&response.request().method()==="GET");
 await page.getByRole("button",{name:"Check export status",exact:true}).click();
 const checkedResponse=await checked;expect(checkedResponse.status()).toBe(200);const publicReady=accountExportReady.parse(await checkedResponse.json());
 expect(publicReady.exportId).toBe(request.exportId);
 const runtime=createRequesterStatementRuntime(),settleAt=Date.now()+30_000;
 let captured:{context:ReturnType<typeof accountCompleteContextSchema.parse>;ready:ReturnType<typeof accountArchiveReadySchema.parse>};
 try{captured=await withAccountArchiveR2Owner(process.env,signal,runtime,async tx=>{
  const rows=await tx<{context:unknown;ready:unknown}[]>`select
   public.export_archive_account_complete_v1('context',j.export_id,j.active_attempt,j.authority_receipt,null,null) as context,
   private.account_archive_test_ready_v1(j.origin,j.export_id,j.export_cookie_hash) as ready
   from private.export_archive_jobs j join public.generated_exports e on e.id=j.export_id
   where j.export_id=${request.exportId}::uuid and e.account_id=${options.accountId}::uuid
    and e.target_id=e.account_id and e.target_kind='account' and e.origin_kind='account'
    and j.origin->>'kind'='account' and j.origin->>'accountId'=e.account_id::text
    and j.route_id='api.export' and j.export_contract='account-export-v1'`;
  if(rows.length!==1)throw unavailable();return {context:accountCompleteContextSchema.parse(rows[0]?.context),
   ready:accountArchiveReadySchema.parse(rows[0]?.ready)};
 });}finally{await runtime.settle(settleAt);runtime.assertSettled();}
 expect(captured.context.targetId).toBe(options.accountId);
 expect(captured.context.partitions.map(p=>p.subjectId).sort()).toEqual([...options.expectedSubjects].sort());
 expect(captured.ready.exportId).toBe(request.exportId);expect(captured.ready.sizeBytes).toBe(publicReady.sizeBytes);
 expect(captured.ready.sha256).toBe(publicReady.sha256);
 await page.reload();
 const opened=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/export"&&response.request().method()==="POST");
 await page.getByRole("button",{name:"Save complete export",exact:true}).click();
 const openedResponse=await opened;expect(openedResponse.status()).toBe(200);const download=accountExportDownload.parse(await openedResponse.json());
 await expect(page.getByRole("status")).toHaveText("Your complete export has been saved.");
 const sink=await page.evaluate(()=>{
  const state=(window as typeof window&{__inheritArchiveSink:{chunks:number[][];closed:boolean;aborted:boolean}}).__inheritArchiveSink;
  return {chunks:state.chunks,closed:state.closed,aborted:state.aborted};
 });
 expect(sink.closed).toBe(true);expect(sink.aborted).toBe(false);
 const bytes=Buffer.concat(sink.chunks.map(value=>Buffer.from(value)));
 expect(bytes.length).toBe(captured.ready.sizeBytes);expect(sha(bytes)).toBe(captured.ready.sha256);
 const zip=new AdmZip(bytes),names=zip.getEntries().map(entry=>entry.entryName);
 expect(new Set(names).size).toBe(names.length);expect(names).toHaveLength(captured.ready.memberCount);
 const manifest=manifestSchema.parse(JSON.parse(zip.readAsText("manifest.json")));
 expect(manifest.subjectPartitions).toEqual(captured.context.partitions.map(partition=>partition.subjectId));
 expect(manifest.completeReceipt).toEqual(captured.context.completeReceipt);
 expect(manifest.dispositions).toEqual(captured.context.dispositions);
 expect(manifest.members).toHaveLength(captured.ready.memberCount-1);
 expect([...manifest.members.map(member=>member.name),"manifest.json"].sort()).toEqual([...names].sort());
 for(const member of manifest.members){
  const body=zip.readFile(member.name);expect(body).not.toBeNull();
  expect(body!.byteLength).toBe(member.sizeBytes);expect(sha(body!)).toBe(member.sha256);
 }
 expect(sha(zip.readFile("manifest.json")!)).toBe(captured.ready.manifestMemberSha256);
 expect(sha(Buffer.from(JSON.stringify(manifest.members)))).toBe(captured.ready.memberSha256);
 for(const subjectId of options.expectedSubjects)for(const member of ACCOUNT_SUBJECT_MEMBERS)
  expect(names).toContain(`subjects/${subjectId}/${member}`);
 for(const original of options.originals){
  const members=names.filter(name=>name.startsWith(`originals/${original.fileId}/original`));expect(members).toHaveLength(1);
  expect(zip.readFile(members[0])).toEqual(Buffer.from(original.bytes));
  expect(names).toContain(`variants/${original.fileId}.csv`);
 }
 // Every separately raw-authorized file must be accounted for; ungranted raw
 // sources remain explicit native exclusions rather than fake empty exports.
 for(const file of captured.context.completeReceipt.files)expect(names).toContain(`variants/${file.fileId}.csv`);
 const allowedFiles=new Set(captured.context.partitions.flatMap(p=>p.fileIds));
 for(const name of names){const raw=/^(?:variants|observed|canonical)\/([a-f0-9-]{36})\./u.exec(name);
  if(raw)expect(allowedFiles.has(raw[1])).toBe(true);}
 const finalRuntime=createRequesterStatementRuntime(),finalDeadline=Date.now()+30_000;
 try{await withAccountArchiveR2Owner(process.env,signal,finalRuntime,async tx=>{
  const rows=await tx<{context:unknown;nextSequence:number;acknowledged:boolean}[]>`select
   public.export_archive_account_complete_v1('context',j.export_id,j.active_attempt,j.authority_receipt,null,null) as context,
   d.next_sequence::integer as "nextSequence",d.account_chunk_acknowledged_at is not null as acknowledged
   from private.export_archive_jobs j join private.export_archive_downloads d on d.export_id=j.export_id
   where j.export_id=${request.exportId}::uuid and d.id=${download.session}::uuid`;
  expect(rows).toHaveLength(1);expect(accountCompleteContextSchema.parse(rows[0]?.context)).toEqual(captured.context);
  const receipt=z.object({context:accountCompleteContextSchema,nextSequence:z.number().int().nonnegative().safe(),
   acknowledged:z.literal(true)}).strict().parse(rows[0]);
  expect(receipt.nextSequence).toBe(captured.ready.segmentCount);
 });}finally{await finalRuntime.settle(finalDeadline);finalRuntime.assertSettled();}
 const allocations=await allocationProof(request.exportId,captured.ready.attemptId,options.accountId,signal);
 expect(allocations.count).toBe(captured.ready.segmentCount);expect(allocations.written).toBe(allocations.count);
 expect(allocations.disposed).toBe(0);expect(allocations.absent).toBe(0);expect(allocations.deleted).toBe(0);
 await page.evaluate(()=>{
  const state=(window as typeof window&{__inheritArchiveSink:{chunks:number[][]}}).__inheritArchiveSink;
  for(const chunk of state.chunks)chunk.fill(0);state.chunks=[];
 });bytes.fill(0);
 return Object.freeze({version:"account-archive-test-delivery-proof-v1" as const,admission,
  exportId:request.exportId as string,attemptId:captured.ready.attemptId,expiresAt:captured.ready.expiresAt,
  sizeBytes:bytes.length,sha256:captured.ready.sha256,captureSha256:captured.context.completeReceipt.captureSha256,
  allocations:Object.freeze(allocations)});
}

/** A separate later checkpoint, after the real expiry workflow has stopped
 * this attempt and its native cleanup fence is genuinely due. Root invokes the
 * ordinary disposal worker to make that transition first; neither this probe
 * nor an ACK changes or backdates a deadline. It submits one natural operation,
 * then requires native absence ACKs for the entire unchanged allocation bag.
 * Provider history and platform copies remain separately qualified policy. */
export async function exerciseCompleteAccountArchiveDisposal(options:{page:Page;accountId:string;jobSecret:string;
 delivery:{exportId:string;attemptId:string;allocations:AllocationProof};signal:AbortSignal}){
 const {delivery,signal}=options;
 if(!options.jobSecret||options.jobSecret.length>4096||signal.aborted)throw unavailable();
 const expected=allocationProofSchema.parse(delivery.allocations);
 const before=await allocationProof(uuid.parse(delivery.exportId),uuid.parse(delivery.attemptId),uuid.parse(options.accountId),signal);
 expect(before.identitySha256).toBe(expected.identitySha256);expect(before.count).toBe(expected.count);
 expect(before.written).toBe(expected.written);expect(before.disposed).toBe(0);expect(before.absent).toBe(0);expect(before.deleted).toBe(0);
 expect(before.deadlinePassed).toBe(true);expect(before.stopped).toBe(true);expect(before.cleanupDue).toBe(true);
 const response=await options.page.request.post("/api/jobs/account-export",{headers:{authorization:`Bearer ${options.jobSecret}`,
  "X-Inherit-Account-Export-Operation":"disposal"}});
 expect(response.status()).toBe(204);expect(await response.body()).toHaveLength(0);
 const after=await allocationProof(delivery.exportId,delivery.attemptId,options.accountId,signal);
 expect(after.identitySha256).toBe(expected.identitySha256);expect(after.count).toBe(expected.count);
 expect(after.written).toBe(expected.written);expect(after.disposed).toBe(after.count);expect(after.absent).toBe(after.count);
 expect(after.deleted).toBe(after.count);expect(after.deadlinePassed).toBe(true);expect(after.stopped).toBe(true);expect(after.cleanupDue).toBe(true);
 return Object.freeze({version:"account-archive-test-current-object-disposal-proof-v1" as const,
  exportId:delivery.exportId,attemptId:delivery.attemptId,allocationCount:after.count,identitySha256:after.identitySha256,
  disposition:"current-object-absent" as const,historyScope:"current-object-only" as const});
}
