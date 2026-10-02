import "server-only";
import {createArchivePersistence,type ArchiveWorkerRpc} from "./archive-persistence";
import {storeArchiveSegments,type ArchiveSegmentationOptions,type ArchiveAttempt} from "./archive-segments";
import {createZip64Archive,createZip64FileSpool} from "./archive-zip64";
import {createAccountContentReader,type AccountContentRpc} from "./account-content-reader";
import {prepareAccountArchiveMetadata,type AccountMetadataRpc} from "./account-member-metadata";
import {prepareAccountHistoryInventory,type AccountInventoryRpc} from "./account-history-inventory";
import {prepareAccountClassInventory,type AccountClassRpc} from "./account-class-inventory";
import {prepareAccountPartitionMembers} from "./account-partition-members";
import {prepareAccountScientificMembers} from "./account-scientific-members";
import {prepareAccountChatMembers} from "./account-chat-members";
import {prepareAccountArchiveAuditMembers,type AccountAuditRpc} from "./account-audit-members";
import {prepareFuturePersonArchiveMembers} from "./future-person-member-plan";
import {boundClaimantAuditMember} from "./bound-claimant-legal-audit";
import {prepareAccountOriginalSource,type AccountOriginalRpc} from "./account-original-source";
import {prepareBoundAccountArchiveSource,type BoundArchiveSourceRpc} from "./bound-account-source";
import {boundSourceManifestSchema} from "@/lib/future-person/bound-source-reader";
import {accountArchiveContextSchema,type AccountMemberRpc,type AccountBoundSourceRpc} from "./bound-account-archive-worker";
import {composeAccountMemberFactories,bufferAccountMemberFactories} from "./account-member-composition";
import {prepareAccountArchivePlan,type AccountArchiveFile,type AccountArchiveSourceMember} from "./account-archive-plan";
import {z} from "zod";
const unavailable=()=>new Error("account_archive_unavailable");

/** Internal consumed-account executor. Request capture/create/status and the
 * durable attempt door are distinct authority boundaries, never a stored JWT.
 * Every class and required member is proved before any archive byte reservation.
 * Provider writes are an explicit unresolved caller capability, not a default
 * implementation/provider choice. Returns byte completion only, never READY,
 * a download, mail, a public gate or unsupported whole-graph success. */
export async function buildAccountArchive(options:{job:{exportId:string;principalHash:string;authorityReceipt:string;deadline:string};
 workerRpc:ArchiveWorkerRpc;memberRpc:AccountMemberRpc;contentRpc:AccountContentRpc;metadataRpc:AccountMetadataRpc;
 inventoryRpc:AccountInventoryRpc;classRpc:AccountClassRpc;auditRpc:AccountAuditRpc;originalRpc:AccountOriginalRpc;
 boundSourceRpc:AccountBoundSourceRpc;readOriginalRange:NonNullable<Parameters<typeof prepareAccountOriginalSource>[0]["readRange"]>;
 write:ArchiveSegmentationOptions["write"];signal:AbortSignal}){
 const persistence=createArchivePersistence(options.job,options.workerRpc),spool=await createZip64FileSpool();
 let attempt:ArchiveAttempt|undefined,plan:Awaited<ReturnType<typeof prepareAccountArchivePlan>>|undefined;
 let context:z.infer<typeof accountArchiveContextSchema>|undefined,workingSignal=options.signal;
 const active=()=>{if(options.signal.aborted||workingSignal.aborted||Date.now()>=persistence.job.deadline)throw unavailable();};
 const check=async(signal:AbortSignal)=>{active();if(signal.aborted||!attempt)throw unavailable();
  const receipt=await persistence.checkAuthority(attempt,signal);active();if(signal.aborted)throw unavailable();return receipt;};
 async function member(operation:string,subject:string|null,after:string|null,signal:AbortSignal){
  await check(signal);const stop=new AbortController(),current=AbortSignal.any([options.signal,signal,stop.signal]);let abort=()=>{};
  const timer=setTimeout(()=>stop.abort(),Math.min(30_000,persistence.job.deadline-Date.now()));timer.unref();
  const canceled=new Promise<never>((_,reject)=>{abort=()=>reject(unavailable());current.addEventListener("abort",abort,{once:true});});
  try{if(current.aborted)throw unavailable();const response=await Promise.race([Promise.resolve().then(()=>options.memberRpc("export_archive_account_members_v1",{
   p_operation:operation,p_export_id:options.job.exportId,p_attempt_id:attempt!.attemptId,p_authority_receipt:options.job.authorityReceipt,
   p_subject_id:subject,p_after_id:after},current)),canceled]);
   if(current.aborted||response.error!==null)throw unavailable();await check(signal);return response.data;
  }finally{clearTimeout(timer);current.removeEventListener("abort",abort);stop.abort();}
 }
 async function prepare(currentAttempt:ArchiveAttempt,signal:AbortSignal){
  if(!attempt||currentAttempt.attemptId!==attempt.attemptId)throw unavailable();
  workingSignal=AbortSignal.any([options.signal,signal]);
  const reference={exportId:options.job.exportId,attemptId:attempt.attemptId,authorityReceipt:options.job.authorityReceipt};
  const reader=await createAccountContentReader({reference,deadline:options.job.deadline,memberRpc:options.memberRpc,
   contentRpc:options.contentRpc,signal:workingSignal,check});context=reader.context;
  const common={reference,context,signal:workingSignal,check};
  const metadata=await prepareAccountArchiveMetadata({...common,files:reader.files,rpc:options.metadataRpc});
  const history=await prepareAccountHistoryInventory({...common,rpc:options.inventoryRpc});
  const classes=await prepareAccountClassInventory({...common,rpc:options.classRpc});
  const partition=await prepareAccountPartitionMembers({...common,history,classes,metadata});
  const science=await prepareAccountScientificMembers({reader,metadata,signal:workingSignal,check});
  const chats=await prepareAccountChatMembers({reader,signal:workingSignal,check});
  const audit=await prepareAccountArchiveAuditMembers({...common,rpc:options.auditRpc});
  const retained:Awaited<ReturnType<typeof prepareFuturePersonArchiveMembers>>[]=[];
  const files:AccountArchiveFile[]=[],sources:AccountArchiveSourceMember[]=[];
  for(const file of reader.files){
   const source=await prepareAccountOriginalSource({reference,context,snapshot:file,rpc:options.originalRpc,
    readRange:options.readOriginalRange,signal:workingSignal,preparationSignal:signal,check});
   files.push({fileId:file.file.id,subjectId:file.file.subject_id,projection:"own-upload",
    byte_identical_to_upload:!source.provenance.originalRetired,originalRetired:source.provenance.originalRetired,
    sourceSha256:file.file.sha256,decodedSha256:file.file.source_sha256});
   if(source.member)sources.push({fileId:file.file.id,subjectId:file.file.subject_id,member:source.member});
  }
  for(const partition of context.partitions.filter(p=>p.class==="claimed-bound")){
   const prepared=await prepareFuturePersonArchiveMembers({authorityReceipt:reference.authorityReceipt,signal:workingSignal,active,check,
    auditMemberSchema:boundClaimantAuditMember,call:(operation,current,after)=>member(operation==="context"?"bound-context":operation,partition.subjectId,after??null,current)});
   if(prepared.snapshot.source.subjectId!==partition.subjectId||partition.fileIds.length!==1
    ||prepared.snapshot.source.fileId!==partition.fileIds[0])throw unavailable();
   const envelope=z.object({version:z.literal("bound-account-archive-source-v1"),exportId:z.uuid(),attemptId:z.uuid(),
    authorityReceipt:z.string().regex(/^[a-f0-9]{64}$/u),source:boundSourceManifestSchema}).strict();
   const sourceRpc:BoundArchiveSourceRpc=async(_name,args,current)=>{
    await check(current);const response=await options.boundSourceRpc("export_archive_account_bound_source_v1",{...args,p_subject_id:partition.subjectId},current);
    if(response.error!==null)return response;const parsed=envelope.parse(response.data);
    if(parsed.source.actor.accountId!==context!.actor.accountId||parsed.source.actor.sessionId!==context!.actor.sessionId
     ||parsed.source.subjectId!==partition.subjectId||parsed.source.fileId!==prepared.snapshot.source.fileId)throw unavailable();
    await check(current);return response;
   };
   const source=await prepareBoundAccountArchiveSource(reference,sourceRpc,workingSignal,signal);
   if(source.provenance.sourceSha256!==prepared.snapshot.source.sourceSha256
    ||source.provenance.membershipSha256!==prepared.snapshot.source.membershipSha256
    ||source.provenance.publicationRevision!==prepared.snapshot.source.publicationRevision)throw unavailable();
   retained.push(prepared);files.push({fileId:source.provenance.fileId,subjectId:source.provenance.subjectId,projection:"sanitized-embryo",
    byte_identical_to_upload:false,originalRetired:false,sourceSha256:source.provenance.sourceSha256,
    membershipSha256:source.provenance.membershipSha256,publicationRevision:source.provenance.publicationRevision,currentParts:source.provenance.parts});
   for(const member of source.members)sources.push({fileId:source.provenance.fileId,subjectId:source.provenance.subjectId,member});
  }
  await classes.acceptBoundMembership(retained.map(p=>p.snapshot),signal);await classes.assertComplete(signal);
  const factories=composeAccountMemberFactories([
   {kind:"account-metadata",factories:partition.factories},{kind:"ordinary-science",factories:science.factories},
   {kind:"saved-chats",factories:chats.factories},{kind:"actor-audit",factories:audit},
   // Root indexes/global legal ledger are generated once from the actual whole
   // account scope; retained subject events keep their exact custody selector.
   {kind:"retained-custody",factories:retained.flatMap(p=>p.factories.filter(f=>f.name.startsWith("subjects/")||f.name.startsWith("variants/")||f.name.startsWith("originals/")))},
  ]);
  // The durable current reader recomputes the exact complete graph receipt,
  // including every source/member/class frame. Factory reads independently
  // prove their content/EOF again. Repeating all factories' context reads for
  // every ZIP header/byte would multiply the same full-graph authorization.
  const current=check;
  plan=await prepareAccountArchivePlan({context,factories:bufferAccountMemberFactories(factories),files,sources,signal,check:current});
 }
 try{
  const summary=await storeArchiveSegments({exportId:options.job.exportId,principalHash:options.job.principalHash,
   authorityReceipt:options.job.authorityReceipt,deadline:persistence.job.deadline,signal:options.signal,checkAuthority:persistence.checkAuthority,
   beginAttempt:async(value,signal)=>{await persistence.beginAttempt(value,signal);attempt=value;},prepareSource:prepare,
   reserve:persistence.reserve,acknowledge:persistence.acknowledge,appendPage:persistence.appendPage,write:options.write,
   source:signal=>{if(!plan||!context)throw unavailable();return createZip64Archive({members:(async function*(){yield* plan!.members;})(),
    expectedMemberCount:plan.members.length,expectedPayloadBytes:plan.payloadBytes,modifiedAt:Date.parse(context.capturedAt),
    deadline:persistence.job.deadline,signal,authorityReceipt:options.job.authorityReceipt,
    checkAuthority:async current=>{await plan!.check(current);return options.job.authorityReceipt;},spool});}});
  if(!plan)throw unavailable();await persistence.recordBytesComplete(summary,options.signal);
  return {summary,memberCount:plan.members.length,payloadBytes:plan.payloadBytes};
 }finally{await spool.dispose();}
}
