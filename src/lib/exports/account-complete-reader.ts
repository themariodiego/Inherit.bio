import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import {ACCOUNT_CLASS_KINDS,type AccountClassKind} from "./account-class-inventory";
import {ACCOUNT_HISTORY_KINDS,type AccountHistoryKind} from "./account-history-inventory";
import {ACCOUNT_SUBJECT_MEMBERS} from "./account-subject-member-names";
import {ACCOUNT_COMPLETE_FILE_KINDS,accountCompleteContextSchema,type AccountCompleteContext} from "./account-complete-context";
import type {PreparedStoredArtifact} from "@/lib/genome/prepared-source/artifact-identity";
import type {RequesterStatementRuntime} from "./requester-statement-runtime";

const count=z.number().int().nonnegative().safe(),hash=z.string().regex(/^[a-f0-9]{64}$/u),uuid=z.uuid();
const identity=z.string().regex(/^[\x20-\x7e]{1,2048}$/u),key=z.tuple([uuid,identity]);
const rowBase=z.object({identity,key,subjectId:uuid,scope:z.literal("subject")}).strict();
const row=z.union([rowBase.extend({rowText:z.string(),rowSource:z.null()}).strict(),
 rowBase.extend({rowText:z.null(),rowSource:z.object({byteCount:count.positive(),sha256:hash}).strict()}).strict()]);
const kinds=[...ACCOUNT_CLASS_KINDS,...ACCOUNT_HISTORY_KINDS,...ACCOUNT_SUBJECT_MEMBERS,...ACCOUNT_COMPLETE_FILE_KINDS] as const;
type CompleteKind=(typeof kinds)[number];
type SubjectMember=(typeof ACCOUNT_SUBJECT_MEMBERS)[number];
const page=z.object({version:z.literal("account-complete-page-v1"),kind:z.enum(kinds),rows:z.array(row).max(500),
 nextAfterKey:key.nullable()}).strict();
const bytesPage=z.object({version:z.literal("account-complete-row-bytes-v1"),kind:z.enum(kinds),key,
 byteOffset:count,totalBytes:count.positive(),sha256:hash,base64:z.string().max(1_048_576),eof:z.boolean()}).strict();
export type AccountCompleteRpc=(name:"export_archive_account_complete_v1",args:{p_operation:"context"|"rows"|"row-bytes"|"original"|"member-rows"|"member-bytes"|"history-rows"|"history-bytes"|"file-rows"|"file-bytes"|"prepared-member";
 p_export_id:string;p_attempt_id:string;p_authority_receipt:string;p_kind:string|null;p_after_key:unknown},signal:AbortSignal)
 =>PromiseLike<{data:unknown;error:unknown}>;
const unavailable=()=>new Error("account_complete_source_unavailable"),encoder=new TextEncoder();
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const after=(a:z.infer<typeof key>,b:z.infer<typeof key>)=>Buffer.compare(Buffer.from(JSON.stringify(a)),Buffer.from(JSON.stringify(b)))>0;
type Reference={exportId:string;attemptId:string;authorityReceipt:string};
/** The supplement uses actual native current source, independently full
 * membership receipts and byte-source EOF. Large rows stream; they do not turn
 * into absent rows or a supported-value size cap. Legacy readers stay separate. */
export async function prepareAccountCompleteReader(options:{reference:Reference;rpc:AccountCompleteRpc;signal:AbortSignal;
 deadline:string;check(signal:AbortSignal):Promise<unknown>;runtime:RequesterStatementRuntime}){
 const stopAt=Date.parse(options.deadline);
 async function call(operation:Parameters<AccountCompleteRpc>[1]["p_operation"],signal:AbortSignal,kind:string|null=null,selected:unknown=null){
  if(options.signal.aborted||signal.aborted||!Number.isFinite(stopAt)||Date.now()>=stopAt)throw unavailable();
  await options.check(signal);const stop=new AbortController(),current=AbortSignal.any([options.signal,signal,stop.signal]);let interrupt=()=>{};
  const timer=setTimeout(()=>stop.abort(),Math.min(30_000,stopAt-Date.now()));timer.unref();
  const canceled=new Promise<never>((_,reject)=>{interrupt=()=>reject(unavailable());current.addEventListener("abort",interrupt,{once:true});});
  try{
   if(current.aborted)throw unavailable();const response=await Promise.race([options.runtime.track("account-complete-rpc",()=>options.rpc(
    "export_archive_account_complete_v1",{p_operation:operation,p_export_id:options.reference.exportId,p_attempt_id:options.reference.attemptId,
     p_authority_receipt:options.reference.authorityReceipt,p_kind:kind,p_after_key:selected},current)),canceled]);
   if(current.aborted||response.error!==null)throw unavailable();await options.check(signal);
   // Source data is private. Only this fixed refusal may leave the reader.
   const serialized=JSON.stringify(response.data);
   if(typeof serialized!=="string"||Buffer.byteLength(serialized,"utf8")>4_000_000)throw unavailable();return response.data;
  }finally{clearTimeout(timer);current.removeEventListener("abort",interrupt);stop.abort();}
 }
 const context=accountCompleteContextSchema.parse(await call("context",options.signal));
 if(context.authorityReceipt!==options.reference.authorityReceipt||context.deadline!==options.deadline
  ||Date.parse(context.deadline)<=Date.now())throw unavailable();
 const captured:AccountCompleteContext=context;
 async function check(signal:AbortSignal){
  const current=accountCompleteContextSchema.parse(await call("context",signal));if(!same(captured,current))throw unavailable();
 }
 async function* rowBytes(kind:CompleteKind,value:z.infer<typeof row>,signal:AbortSignal,
  operation:"row-bytes"|"member-bytes"|"history-bytes"|"file-bytes",selector:{subjectId?:string;fileId?:string}){
  if(value.rowText!==null){
   if(kind!=="reports.txt")JSON.parse(value.rowText);const bytes=encoder.encode(value.rowText);options.runtime.own(bytes);
   try{if(bytes.byteLength===0||bytes.byteLength>4_000_000)throw unavailable();yield bytes;}
   finally{options.runtime.clear(bytes);}return;
  }
  const expected=value.rowSource,digest=createHash("sha256");let offset=0;
  for(;;){
   const part=bytesPage.parse(await call(operation,signal,kind,{...selector,key:value.key,offset}));
   if(part.kind!==kind||!same(part.key,value.key)||part.byteOffset!==offset||part.totalBytes!==expected.byteCount
    ||part.sha256!==expected.sha256)throw unavailable();
   const bytes=Buffer.from(part.base64,"base64");options.runtime.own(bytes);
   try{
    const length=Math.min(786_432,expected.byteCount-offset);
    if(length<=0||bytes.byteLength!==length||bytes.toString("base64")!==part.base64||part.eof!==(offset+length===expected.byteCount))throw unavailable();
    digest.update(bytes);offset+=length;yield bytes;
   }finally{options.runtime.clear(bytes);}
   if(part.eof){if(offset!==expected.byteCount||digest.digest("hex")!==expected.sha256)throw unavailable();break;}
  }
 }
 async function* readRecords(kind:CompleteKind,signal:AbortSignal,selected:{
  operation:"rows"|"member-rows"|"history-rows"|"file-rows";bytesOperation:"row-bytes"|"member-bytes"|"history-bytes"|"file-bytes";
  expected:{rows:number;membershipSha256:string;partitions:{subjectId:string;rows:number}[]};seed:string;subjectId?:string;fileId?:string;
  permitted(subjectId:string):boolean}){
  await check(signal);const expected=selected.expected;
  let cursor:z.infer<typeof key>|null=null,n=0,digest=createHash("sha256").update(selected.seed).digest();
  const subjects=new Map<string,number>();
  for(;;){
   const selector=selected.fileId!==undefined?{fileId:selected.fileId,afterKey:cursor}:
    selected.subjectId===undefined?cursor:{subjectId:selected.subjectId,afterKey:cursor};
   const current=page.parse(await call(selected.operation,signal,kind,selector));
   if(current.kind!==kind||current.nextAfterKey!==null&&(current.rows.length===0||!same(current.nextAfterKey,current.rows.at(-1)!.key)))throw unavailable();
   for(const value of current.rows){
    if(!same(value.key,[selected.fileId??value.subjectId,value.identity])||cursor!==null&&!after(value.key,cursor)||++n>expected.rows)throw unavailable();
    if(!selected.permitted(value.subjectId)||!expected.partitions.some(p=>p.subjectId===value.subjectId))throw unavailable();
    const next=createHash("sha256").update(digest).update(`${value.identity}:${value.subjectId}:`,"utf8");
    let consumed=false,completed=false;
    const bytes=async function*(currentSignal:AbortSignal){
     if(consumed)throw unavailable();consumed=true;
     const selector={...(selected.subjectId===undefined?{}:{subjectId:selected.subjectId}),...(selected.fileId===undefined?{}:{fileId:selected.fileId})};
     await check(currentSignal);for await(const bytes of rowBytes(kind,value,currentSignal,selected.bytesOperation,selector)){next.update(bytes);yield bytes;}
     next.update("\n");digest=next.digest();await check(currentSignal);completed=true;
    };
    yield {identity:value.identity,key:value.key,subjectId:value.subjectId,bytes};
    if(!completed)throw unavailable();cursor=value.key;subjects.set(value.subjectId,(subjects.get(value.subjectId)??0)+1);
   }
   if(current.nextAfterKey===null)break;
  }
  if(n!==expected.rows||digest.toString("hex")!==expected.membershipSha256||subjects.size!==expected.partitions.length
   ||expected.partitions.some(p=>subjects.get(p.subjectId)!==p.rows))throw unavailable();await check(signal);
 }
 function records(kind:AccountClassKind,signal:AbortSignal){
  if(!ACCOUNT_CLASS_KINDS.includes(kind))throw unavailable();
  const expected=context.completeReceipt.classes.find(c=>c.kind===kind)!.routed;
  return readRecords(kind,signal,{operation:"rows",bytesOperation:"row-bytes",expected,seed:`account-complete-routed-v1|${kind}`,
   permitted:subject=>{const item=context.dispositions.find(d=>d.kind===kind&&d.subjectId===subject);
    return item?.status==="permitted"&&(kind!=="embryo_variants"||["own-subject","claimed-bound","separate-raw-export"].includes(item.reason));}});
 }
 function memberRecords(subjectId:string,kind:SubjectMember,signal:AbortSignal){
  if(!ACCOUNT_SUBJECT_MEMBERS.includes(kind))throw unavailable();
  const item=context.completeReceipt.members.find(m=>m.subjectId===subjectId&&m.member===kind);if(!item)throw unavailable();
  return readRecords(kind,signal,{operation:"member-rows",bytesOperation:"member-bytes",subjectId,
   seed:`account-complete-member-v1|${subjectId}|${kind}`,expected:{rows:item.rows,membershipSha256:item.membershipSha256,
    partitions:item.rows?[{subjectId,rows:item.rows}]:[]},permitted:subject=>subject===subjectId&&item.status==="permitted"});
 }
 function historyRecords(kind:AccountHistoryKind,signal:AbortSignal){
  if(!ACCOUNT_HISTORY_KINDS.includes(kind))throw unavailable();
  const expected=context.completeReceipt.history.find(h=>h.kind===kind)!.routed;
  return readRecords(kind,signal,{operation:"history-rows",bytesOperation:"history-bytes",expected,
   seed:`account-complete-history-routed-v1|${kind}`,permitted:subject=>context.partitions.some(p=>p.subjectId===subject)});
 }
 function fileRecords(fileId:string,kind:(typeof ACCOUNT_COMPLETE_FILE_KINDS)[number],signal:AbortSignal){
  if(!ACCOUNT_COMPLETE_FILE_KINDS.includes(kind))throw unavailable();
  const file=context.completeReceipt.files.find(f=>f.fileId===fileId);
  if(!file||file.content.backend!=="database-v1")throw unavailable();
  const item=file.content.receipts.find(r=>r.kind===kind)!;
  return readRecords(kind,signal,{operation:"file-rows",bytesOperation:"file-bytes",fileId,
   seed:`account-complete-file-v1|${fileId}|${kind}`,expected:{...item,partitions:item.rows?[{subjectId:file.subjectId,rows:item.rows}]:[]},
   permitted:subject=>subject===file.subjectId});
 }
 return {context,check,records,memberRecords,historyRecords,fileRecords,
  preparedMember:(fileId:string,manifestId:string,expected:PreparedStoredArtifact,signal:AbortSignal)=>{
   const file=context.completeReceipt.files.find(f=>f.fileId===fileId);
   if(!file||file.content.backend!=="prepared-object-v1"||file.content.source.manifestId!==manifestId)throw unavailable();
   return call("prepared-member",signal,null,{fileId,manifestId,artifactId:expected.receipt.artifactId,expected});
  },
  original:(fileId:string,descriptor:unknown,signal:AbortSignal)=>call("original",signal,null,{fileId,expected:descriptor})};
}
