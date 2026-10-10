import "server-only";
import {requesterStatementsOpen} from "@/lib/future-person/requester-statement";
import {accountOwnStatementCapture} from "./requester-statement-account-members";
import {accountPathBSourceSchema,type AccountPathBSource} from "./account-path-b-members";
import {createHash} from "node:crypto";
import {z} from "zod";
import {accountArchiveContextSchema} from "./bound-account-archive-worker";
import type {FuturePersonMemberFactory} from "./future-person-member-plan";
import type {Zip64Member} from "./archive-zip64";
import type {RequesterStatementRuntime} from "./requester-statement-runtime";

export const ACCOUNT_SUBJECT_MEMBERS=["subject.json","consents.json","legacy-consents.json","attestations.json","audit-log.json",
 "reports.json","reports.txt","prs.json","ancestry.json","chats.json","portrait.json","embryos.json"] as const;
const indexes=["subjects","consents","legacy-consents","attestations","audit-log","portrait","embryos"] as const;
const uuid=z.uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/u),count=z.number().int().nonnegative().safe();
const part=z.object({name:z.string(),sequence:z.number().int().min(0).max(49),partId:uuid,sizeBytes:count.positive(),sha256:hash}).strict();
const fileSchema=z.object({fileId:uuid,subjectId:uuid,projection:z.enum(["own-upload","sanitized-embryo"]),
 byte_identical_to_upload:z.boolean(),originalRetired:z.boolean(),sourceSha256:hash,decodedSha256:hash.optional(),
 membershipSha256:hash.optional(),publicationRevision:z.number().int().positive().safe().optional(),
 currentParts:z.array(part).min(1).max(50).optional()}).strict()
 .refine(f=>f.projection==="own-upload"?f.byte_identical_to_upload===!f.originalRetired&&f.currentParts===undefined:
  !f.byte_identical_to_upload&&!f.originalRetired&&f.membershipSha256!==undefined&&f.publicationRevision!==undefined
   &&f.currentParts!==undefined&&new Set(f.currentParts.map(p=>p.partId)).size===f.currentParts.length
   &&f.currentParts.every((p,i)=>p.sequence===i&&p.name===`originals/${f.fileId}/canonical-part-${String(i).padStart(4,"0")}.vcf`));
export type AccountArchiveFile=z.infer<typeof fileSchema>;
export type AccountArchiveSourceMember={fileId:string;subjectId:string;member:Zip64Member};
const unavailable=()=>new Error("account_archive_plan_unavailable"),encoder=new TextEncoder();

/** Pure assembly fence, never a source/actor authorization door. Its caller
 * must obtain these factories and file/source descriptors through the genuine
 * consumed-request readers, prove all class inventories, and keep their current
 * checks in `check`. It reads complete actual members before returning a plan,
 * retains descriptors only, and rereads each member at ZIP open. No provider,
 * human JWT, publication/READY transition or alternate authority is created. */
export async function prepareAccountArchivePlan(options:{context:z.infer<typeof accountArchiveContextSchema>;
 factories:FuturePersonMemberFactory[];files:AccountArchiveFile[];sources:AccountArchiveSourceMember[];resultSources?:AccountPathBSource[];
 signal:AbortSignal;check:(signal:AbortSignal)=>Promise<unknown>;sensitiveRuntime?:RequesterStatementRuntime;
 ownStatements?:z.infer<typeof accountOwnStatementCapture>}){
 const context=accountArchiveContextSchema.parse(options.context),files=options.files.map(f=>fileSchema.parse(f));
 const ownStatements=options.ownStatements===undefined?undefined:accountOwnStatementCapture.parse(options.ownStatements);
 const resultSources=(options.resultSources??[]).map(value=>accountPathBSourceSchema.parse(value));
 if(new Set(resultSources.map(r=>`${r.fileId}:${r.purpose}:${r.bindingRevision}`)).size!==resultSources.length
  ||resultSources.some(r=>!context.partitions.some(p=>p.subjectId===r.subjectId&&p.class==="ordinary")
   ||context.partitions.some(p=>p.fileIds.includes(r.fileId))))throw unavailable();
 const fileSubjects=new Map(context.partitions.flatMap(p=>p.fileIds.map(f=>[f,p.subjectId] as const)));
 if(context.targetKind!=="account"||context.targetId!==context.actor.accountId||files.length!==context.fileCount
  ||new Set(files.map(f=>f.fileId)).size!==context.fileCount||files.some(f=>fileSubjects.get(f.fileId)!==f.subjectId
   ||context.partitions.find(p=>p.subjectId===f.subjectId)!.class==="claimed-bound"&&f.projection!=="sanitized-embryo"
   ||context.partitions.find(p=>p.subjectId===f.subjectId)!.class==="ordinary"&&f.projection!=="own-upload"))throw unavailable();
 const fileById=new Map(files.map(f=>[f.fileId,f]));
 async function bounded<T>(signal:AbortSignal,operation:(current:AbortSignal)=>PromiseLike<T>){
  const remaining=Date.parse(context.deadline)-Date.now();if(options.signal.aborted||signal.aborted||remaining<=0||remaining>86_400_000)throw unavailable();
  const stop=new AbortController(),current=AbortSignal.any([options.signal,signal,stop.signal]);let abort=()=>{};
  const timer=setTimeout(()=>stop.abort(),Math.min(30_000,remaining));timer.unref();
  const canceled=new Promise<never>((_,reject)=>{abort=()=>reject(unavailable());current.addEventListener("abort",abort,{once:true});});
  const execute=async()=>{
   const value=await operation(current);
   // A late iterator/read value stays owned even when the caller lost its race.
   if(typeof value==="object"&&value!==null&&"value" in value&&value.value instanceof Uint8Array)options.sensitiveRuntime?.own(value.value);
   return value;
  };
  try{if(current.aborted)throw unavailable();const pending=options.sensitiveRuntime?.track("account-plan-read",execute)??Promise.resolve().then(execute);
   const value=await Promise.race([pending,canceled]);
   if(current.aborted||Date.now()>=Date.parse(context.deadline))throw unavailable();return value;
  }finally{clearTimeout(timer);current.removeEventListener("abort",abort);stop.abort();}
 }
 const check=(signal:AbortSignal)=>bounded(signal,current=>options.check(current));
 const input=new Map<string,FuturePersonMemberFactory>(),sourceNames=new Set<string>();
 const required=new Set(context.partitions.flatMap(p=>ACCOUNT_SUBJECT_MEMBERS.map(name=>`subjects/${p.subjectId}/${name}`)));
 for(const factory of options.factories){
  if(input.has(factory.name)||!Number.isSafeInteger(factory.rows)||factory.rows<0||typeof factory.chunks!=="function")throw unavailable();
  const own=/^subjects\/([a-f0-9-]{36})\/my-correction-statements\.json$/u.exec(factory.name);
  if(own&&(!requesterStatementsOpen()||!context.partitions.some(p=>p.subjectId===own[1]&&p.class==="claimed-bound")))throw unavailable();
  const requester=/^subjects\/([a-f0-9-]{36})\/my-requester-statements\.json$/u.exec(factory.name);
  if(requester&&(!requesterStatementsOpen()||ownStatements?.version!=="test-account-own-statements-v2"
   ||!context.partitions.some(p=>p.subjectId===requester[1])
   ||ownStatements.partitions.find(p=>p.subjectId===requester[1])?.rows!==factory.rows))throw unavailable();
  if(factory.name!=="legal-audit.json"&&!required.has(factory.name)&&!own&&!requester){
   const match=/^(variants|canonical|observed)\/([a-f0-9-]{36})\.(csv|jsonl)$/u.exec(factory.name),file=match?fileById.get(match[2]):undefined;
   const sanitized=/^originals\/([a-f0-9-]{36})\/embryo-autosomal-source\.jsonl$/u.exec(factory.name);
   if(sanitized){if(fileById.get(sanitized[1])?.projection!=="sanitized-embryo")throw unavailable();}
   else if(!match||!file||(match[1]==="variants"?match[3]!=="csv":match[3]!=="jsonl"||file.projection!=="own-upload"))throw unavailable();
  }
  input.set(factory.name,factory);
 }
 if(!input.has("legal-audit.json")||[...required].some(name=>!input.has(name)))throw unavailable();
 if(files.some(file=>file.originalRetired&&!input.has(`canonical/${file.fileId}.jsonl`)))throw unavailable();
 if(files.some(file=>file.projection==="sanitized-embryo"
  &&(!input.has(`variants/${file.fileId}.csv`)||!input.has(`originals/${file.fileId}/embryo-autosomal-source.jsonl`))))throw unavailable();
 const sources=new Map<string,AccountArchiveSourceMember>();
 for(const source of options.sources){
  const file=fileById.get(source.fileId),prefix=`originals/${source.fileId}/`;
  if(!file||file.subjectId!==source.subjectId||file.originalRetired||sources.has(source.member.name)||input.has(source.member.name)
   ||!source.member.name.startsWith(prefix)||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/u.test(source.member.name.slice(prefix.length))
   ||!Number.isSafeInteger(source.member.sizeBytes)||source.member.sizeBytes<=0)throw unavailable();
  if(file.projection==="sanitized-embryo"&&!file.currentParts!.some(p=>p.name===source.member.name&&p.sizeBytes===source.member.sizeBytes))throw unavailable();
  sourceNames.add(source.fileId);sources.set(source.member.name,source);
 }
 if(files.some(file=>!file.originalRetired&&!sourceNames.has(file.fileId)))throw unavailable();
 if(files.some(file=>file.projection==="own-upload"&&!file.originalRetired
  &&[...sources.values()].filter(source=>source.fileId===file.fileId).length!==1))throw unavailable();
 if(files.some(file=>file.projection==="sanitized-embryo"&&file.currentParts!.some(part=>!sources.has(part.name))))throw unavailable();
 // All top-level indexes are generated here from the exact selected subjects;
 // caller factories cannot replace them with sensitive result rows.
 for(const name of indexes){
  const rows=context.partitions.map(p=>({subjectId:p.subjectId,path:name==="subjects"?`subjects/${p.subjectId}/`:`subjects/${p.subjectId}/${name}.json`}));
  const bytes=encoder.encode(JSON.stringify({schemaVersion:"subject-partitioned-archive-v1",rows})+"\n");
  options.sensitiveRuntime?.own(bytes);
  input.set(`${name}.json`,{name:`${name}.json`,rows:rows.length,chunks:async function*(signal){await check(signal);yield bytes;await check(signal);}});
 }
 async function* verified(source:AsyncIterable<Uint8Array>,signal:AbortSignal,expected?:{sizeBytes:number;sha256:string}){
  const iterator=source[Symbol.asyncIterator](),digest=createHash("sha256");let size=0;
  try{for(;;){await check(signal);const next=await bounded(signal,()=>iterator.next());await check(signal);
    if(next.done){if(expected&&(size!==expected.sizeBytes||digest.digest("hex")!==expected.sha256))throw unavailable();return;}
    if(!(next.value instanceof Uint8Array)||next.value.byteLength<1||next.value.byteLength>4_000_000)throw unavailable();
    size+=next.value.byteLength;if(!Number.isSafeInteger(size)||(expected&&size>expected.sizeBytes))throw unavailable();
    digest.update(next.value);yield next.value;
   }}finally{
    if(options.sensitiveRuntime&&iterator.return)await options.sensitiveRuntime.wait(options.sensitiveRuntime.cleanup("account-plan-iterator-return",()=>iterator.return!()),Date.parse(context.deadline));
    else try{void iterator.return?.().catch(()=>{});}catch{/* Original unmarked path. */}
   }
 }
 async function* sourceChunks(member:Zip64Member,signal:AbortSignal){
  const stop=new AbortController(),lifetime=AbortSignal.any([options.signal,signal,stop.signal]);let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try{
   const source=await bounded(signal,async current=>{
    const abort=()=>stop.abort();current.addEventListener("abort",abort,{once:true});
    try{if(current.aborted)throw unavailable();const opened=await member.open(lifetime);
     if(current.aborted||lifetime.aborted){
      if(options.sensitiveRuntime)await options.sensitiveRuntime.cleanup("account-late-open-cancel",()=>opened.cancel());
      else void opened.cancel().catch(()=>{});throw unavailable();
     }return opened;
    }
    finally{current.removeEventListener("abort",abort);}
   });reader=source.getReader();
   for(;;){const next=await bounded(signal,async()=>{
    const value=await reader!.read();if(!value.done&&value.value instanceof Uint8Array)options.sensitiveRuntime?.own(value.value);return value;
   });if(next.done)return;yield next.value;}
  }finally{stop.abort();if(reader){
   const selected=reader;
   if(options.sensitiveRuntime){try{await options.sensitiveRuntime.wait(options.sensitiveRuntime.cleanup("account-plan-reader-cancel",()=>selected.cancel()),Date.parse(context.deadline));}finally{try{selected.releaseLock();}catch{/* Tracked unresolved cleanup holds. */}}}
   else{void selected.cancel().catch(()=>{});try{selected.releaseLock();}catch{/* Original unmarked path. */}}
  }}
 }
 function stream(iterator:AsyncIterable<Uint8Array>,signal:AbortSignal){
  const chunks=iterator[Symbol.asyncIterator]();let closed=false;
  async function close(){
   if(options.sensitiveRuntime&&chunks.return)await options.sensitiveRuntime.wait(options.sensitiveRuntime.cleanup("account-stream-iterator-return",()=>chunks.return!()),Date.parse(context.deadline));
   else try{void chunks.return?.().catch(()=>{});}catch{/* Original unmarked path. */}
  }
  return new ReadableStream<Uint8Array>({async pull(controller){const actual=async()=>{try{
   if(closed||signal.aborted)throw unavailable();
   const next=async()=>{const value=await chunks.next();if(!value.done&&value.value instanceof Uint8Array)options.sensitiveRuntime?.own(value.value);return value;};
   const value=await(options.sensitiveRuntime?.track("account-stream-next",next)??next());if(signal.aborted)throw unavailable();
   if(value.done){closed=true;controller.close();}else controller.enqueue(value.value);
  }catch{closed=true;controller.error(unavailable());await close();}};
  await(options.sensitiveRuntime?.track("account-stream-pull-callback",actual)??actual());},
  async cancel(){const actual=async()=>{closed=true;await close();};await(options.sensitiveRuntime?.cleanup("account-stream-cancel-callback",actual)??actual());}},{highWaterMark:0});
 }
 const descriptors:{name:string;sizeBytes:number;sha256:string;rows:number;subjectId:string|null;fileId:string|null}[]=[],members:Zip64Member[]=[];
 let payloadBytes=0;
 for(const name of [...input.keys(),...sources.keys()].sort()){
  const factory=input.get(name),source=sources.get(name);
  const chunks=(signal:AbortSignal)=>factory?factory.chunks(signal):sourceChunks(source!.member,signal);
  const digest=createHash("sha256");let sizeBytes=0;
  for await(const bytes of verified(chunks(options.signal),options.signal)){sizeBytes+=bytes.byteLength;if(!Number.isSafeInteger(sizeBytes))throw unavailable();digest.update(bytes);}
  if(source&&sizeBytes!==source.member.sizeBytes)throw unavailable();
  const raw=/^(?:(?:variants|canonical|observed)\/([a-f0-9-]{36})\.|originals\/([a-f0-9-]{36})\/)/u.exec(name),subject=/^subjects\/([a-f0-9-]{36})\//u.exec(name);
  const fileId=source?.fileId??raw?.[1]??raw?.[2]??null,subjectId=source?.subjectId??subject?.[1]??(fileId?fileSubjects.get(fileId)!:null);
  const descriptor={name,sizeBytes,sha256:digest.digest("hex"),rows:factory?.rows??0,fileId,subjectId};
  if(source&&fileById.get(source.fileId)!.projection==="own-upload"&&descriptor.sha256!==fileById.get(source.fileId)!.sourceSha256)throw unavailable();
  if(source&&fileById.get(source.fileId)!.projection==="sanitized-embryo"
   &&descriptor.sha256!==fileById.get(source.fileId)!.currentParts!.find(p=>p.name===name)!.sha256)throw unavailable();
  descriptors.push(descriptor);
  members.push({name,sizeBytes,open:async signal=>stream(verified(chunks(signal),signal,descriptor),signal)});
  payloadBytes+=sizeBytes;if(!Number.isSafeInteger(payloadBytes))throw unavailable();
 }
 await check(options.signal);
 const manifest=encoder.encode(JSON.stringify({schemaVersion:"subject-partitioned-archive-v1",capturedAt:context.capturedAt,
  subjectPartitions:context.partitions.map(p=>p.subjectId),files,...(resultSources.length?{resultSources}:{}),members:descriptors})+"\n");
 options.sensitiveRuntime?.own(manifest);
 const manifestFactory:FuturePersonMemberFactory={name:"manifest.json",rows:descriptors.length,chunks:async function*(signal){await check(signal);yield manifest;await check(signal);}};
 const manifestSha256=createHash("sha256").update(manifest).digest("hex");
 members.push({name:"manifest.json",sizeBytes:manifest.byteLength,open:async signal=>stream(verified(manifestFactory.chunks(signal),signal,
  {sizeBytes:manifest.byteLength,sha256:manifestSha256}),signal)});payloadBytes+=manifest.byteLength;
 if(!Number.isSafeInteger(payloadBytes))throw unavailable();members.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
 return {members,payloadBytes,descriptors,check,manifestMemberSha256:manifestSha256};
}
