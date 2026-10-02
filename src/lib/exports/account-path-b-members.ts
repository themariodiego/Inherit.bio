import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import {accountArchiveContextSchema} from "./bound-account-archive-worker";
import {reportScientificCorrections,reportOutcomeScientificCorrections,REPORT_SCIENTIFIC_CORRECTION_NOTICE} from "@/lib/genome/report-scientific-corrections";
import {reportCatalogSnapshotSchema} from "@/lib/genome/report-catalog-snapshot";
import type {FuturePersonMemberFactory} from "./future-person-member-plan";

const uuid=z.uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/u),count=z.number().int().nonnegative().safe();
const revision=count.positive(),date=z.iso.datetime({offset:true});
const outcome=z.discriminatedUnion("status",[
 z.object({status:z.literal("genotyped"),genotype:z.string().max(64),interpretation:z.string().max(100000),strandFlipped:z.boolean()}).strict(),
 z.object({status:z.literal("unrecognized"),genotype:z.string().max(64)}).strict(),
 z.object({status:z.literal("no-call")}).strict(),z.object({status:z.literal("not-covered")}).strict(),
]);
const report=z.object({slug:z.string().min(1).max(500),covered:z.boolean(),catalogSnapshot:reportCatalogSnapshotSchema,
 variants:z.array(z.object({rsid:revision,outcome}).strict()).max(1000),conflictingRsids:z.array(revision).max(1000)}).strict()
 .refine(r=>r.slug===r.catalogSnapshot.template.slug&&r.variants.length===r.catalogSnapshot.template.variants.length
  &&r.variants.every((v,i)=>v.rsid===r.catalogSnapshot.template.variants[i].rsid)
  &&new Set(r.conflictingRsids).size===r.conflictingRsids.length
  &&r.conflictingRsids.every(id=>r.variants.some(v=>v.rsid===id))
  &&r.covered===r.variants.some(v=>v.outcome.status==="genotyped"));
export const accountPathBResultSchema=z.object({bindingRevision:revision,fileId:uuid,subjectId:uuid,
 purpose:z.enum(["reports.monogenic","reports.polygenic"]),completedAt:date,
 source:z.object({sourceRevision:revision,rawSha256:hash,decodedSha256:hash,normalizedAt:date,
  normalizationRevision:revision,sourcePublicationRevision:revision,variantCount:count,build:z.enum(["GRCh37","GRCh38"]),
  computationRevision:z.string().regex(/^path-b-reports-v1:[a-f0-9]{64}$/u),catalogSha256:hash}).strict(),
 reports:z.array(report).max(1000),prs:z.array(z.object({pgs_id:z.string().min(1).max(500),raw_score:z.number(),
  coverage:z.number().min(0).max(1),matched:count.max(9999999)}).strict()).max(1000)}).strict()
 .refine(r=>r.source.sourceRevision===r.source.normalizationRevision
  &&r.source.computationRevision===`path-b-reports-v1:${r.source.catalogSha256}`
  &&new Set(r.reports.map(p=>p.slug)).size===r.reports.length&&new Set(r.prs.map(p=>p.pgs_id)).size===r.prs.length
  &&r.reports.every(p=>p.catalogSnapshot.template.layer===(r.purpose==="reports.monogenic"?"variant_call":"estimate"))
  &&(r.purpose!=="reports.monogenic"||r.prs.length===0));
const record=z.object({id:uuid,subjectId:uuid,rowText:z.string().max(4000000)}).strict();
const snapshot=z.object({subjectId:uuid,records:z.array(record),rows:count,sha256:hash,excludedHeldUploads:count}).strict();
const envelope=z.object({version:z.literal("account-path-b-results-v1"),authorityReceipt:hash,snapshot}).strict();
export type AccountPathBRpc=(name:"export_archive_account_path_b_v1",args:{p_export_id:string;p_attempt_id:string;
 p_authority_receipt:string;p_subject_id:string},signal:AbortSignal)=>PromiseLike<{data:unknown;error:unknown}>;
const unavailable=()=>new Error("account_archive_path_b_unavailable"),encoder=new TextEncoder();
type Record=z.infer<typeof record>;
export const accountPathBSourceSchema=accountPathBResultSchema.shape.source.extend({fileId:uuid,subjectId:uuid,
 purpose:z.enum(["reports.monogenic","reports.polygenic"]),bindingRevision:revision,
 projection:z.literal("saved-path-b-results-v1"),rawSourceDisposition:z.literal("held-original-out-of-scope")}).strict();
export type AccountPathBSource=z.infer<typeof accountPathBSourceSchema>;

/** Actual immutable saved outputs only, through the consumed writing attempt.
 * No display filter, recomputation, raw-source descriptor or caller grant exists.
 * Every original result/catalog/PRS and exact current provenance is retained;
 * all records, hashes and authority are rechecked before every member read. */
export async function prepareAccountPathBMembers(options:{context:z.infer<typeof accountArchiveContextSchema>;
 reference:{exportId:string;attemptId:string;authorityReceipt:string};rpc:AccountPathBRpc;signal:AbortSignal;
 check:(signal:AbortSignal)=>Promise<unknown>}){
 const context=accountArchiveContextSchema.parse(options.context),subjects=new Set(context.partitions.map(p=>p.subjectId));
 if(context.targetKind!=="account"||context.targetId!==context.actor.accountId||context.authorityReceipt!==options.reference.authorityReceipt)throw unavailable();
 const selected=context.partitions.filter(p=>p.class==="ordinary"),captured=new Map<string,z.infer<typeof snapshot>>();
 async function bounded<T>(signal:AbortSignal,operation:(signal:AbortSignal)=>PromiseLike<T>){
  const remaining=Date.parse(context.deadline)-Date.now();if(signal.aborted||options.signal.aborted||remaining<=0)throw unavailable();
  const stop=new AbortController(),current=AbortSignal.any([options.signal,signal,stop.signal]);let abort=()=>{};
  const timer=setTimeout(()=>stop.abort(),Math.min(30000,remaining));timer.unref();
  const canceled=new Promise<never>((_,reject)=>{abort=()=>reject(unavailable());current.addEventListener("abort",abort,{once:true});});
  try{if(current.aborted)throw unavailable();const value=await Promise.race([Promise.resolve().then(()=>operation(current)),canceled]);
   if(current.aborted||Date.now()>=Date.parse(context.deadline))throw unavailable();return value;
  }finally{clearTimeout(timer);current.removeEventListener("abort",abort);stop.abort();}
 }
 async function read(subjectId:string,signal:AbortSignal){
  await bounded(signal,options.check);const reply=await bounded(signal,current=>options.rpc("export_archive_account_path_b_v1",{
   p_export_id:options.reference.exportId,p_attempt_id:options.reference.attemptId,p_authority_receipt:options.reference.authorityReceipt,
   p_subject_id:subjectId},current));if(reply.error!==null)throw unavailable();
  const value=envelope.parse(reply.data);if(value.authorityReceipt!==options.reference.authorityReceipt||value.snapshot.subjectId!==subjectId
   ||!subjects.has(subjectId)||value.snapshot.records.length!==value.snapshot.rows||Buffer.byteLength(JSON.stringify(value),"utf8")>4000000)throw unavailable();
  let last="",digest=createHash("sha256").update("account-class-members-v1|path_b_report_bindings").digest();
  for(const item of value.snapshot.records){const row=accountPathBResultSchema.parse(JSON.parse(item.rowText));
   if(item.id<=last||item.subjectId!==subjectId||row.subjectId!==subjectId||Buffer.byteLength(item.rowText,"utf8")>4000000)throw unavailable();
   digest=createHash("sha256").update(digest).update(`${item.id}:${item.subjectId}:${item.rowText}\n`).digest();last=item.id;
  }
  if(digest.toString("hex")!==value.snapshot.sha256)throw unavailable();
  const before=captured.get(subjectId);if(before&&JSON.stringify(value.snapshot)!==JSON.stringify(before))throw unavailable();
  await bounded(signal,options.check);return value.snapshot;
 }
 for(const part of selected){captured.set(part.subjectId,await read(part.subjectId,options.signal));
  if(Buffer.byteLength(JSON.stringify([...captured.values()]),"utf8")>4000000)throw unavailable();
 }
 const check=async(signal:AbortSignal)=>{for(const part of selected)await read(part.subjectId,signal);};
 const allRecords=():Record[]=>[...captured.values()].flatMap(s=>s.records).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 const factories:FuturePersonMemberFactory[]=[];
 for(const [subjectId,source]of captured){if(source.rows===0)continue;
  for(const kind of ["reports","prs"] as const)factories.push({name:`subjects/${subjectId}/${kind}.json`,rows:source.rows,
   chunks:async function*(signal){await check(signal);yield encoder.encode('{"schemaVersion":"subject-partitioned-archive-v1","projection":"saved-path-b-results-v1","rows":[');
    let n=0;for(const item of source.records){const row=accountPathBResultSchema.parse(JSON.parse(item.rowText));
     const value={fileId:row.fileId,subjectId:row.subjectId,purpose:row.purpose,completedAt:row.completedAt,
      bindingRevision:row.bindingRevision,source:row.source,[kind]:row[kind]};
     const bytes=encoder.encode((n++?",":"")+JSON.stringify(value));for(let at=0;at<bytes.byteLength;at+=1048576)yield bytes.subarray(at,at+1048576);
    }if(n!==source.rows)throw unavailable();await check(signal);yield encoder.encode("]}\n");}});
  const reports=source.records.reduce((n,r)=>n+accountPathBResultSchema.parse(JSON.parse(r.rowText)).reports.length,0);
  factories.push({name:`subjects/${subjectId}/reports.txt`,rows:reports,chunks:async function*(signal){
   await check(signal);yield encoder.encode("Your stored Path B reports\n");let n=0;
   for(const item of source.records){const row=accountPathBResultSchema.parse(JSON.parse(item.rowText));
    yield encoder.encode(`\nFile: ${row.fileId}\nSource revision: ${row.source.sourceRevision}\nSHA-256: ${row.source.decodedSha256}\n`);
    for(const result of row.reports){n++;const template=result.catalogSnapshot.template;
     const corrections=[...reportScientificCorrections(template),...reportOutcomeScientificCorrections(result.slug,result.variants)];
     const text=[...(corrections.length?[REPORT_SCIENTIFIC_CORRECTION_NOTICE]:[]),template.title,`Report: ${result.slug}`,`Purpose: ${row.purpose}`,`Completed: ${row.completedAt}`,
      `Covered at generation: ${result.covered?"yes":"no"}`,template.summary,`Evidence at generation: ${template.evidence}`,
      `Catalog SHA-256: ${result.catalogSnapshot.templateSha256}`,
      ...template.citations.map(c=>`Source: ${c.label}${c.pmid?` — https://pubmed.ncbi.nlm.nih.gov/${c.pmid}/`:""}${c.doi?` — https://doi.org/${c.doi}`:""}${c.accessedOn?` (read ${c.accessedOn})`:""}`),
      ...result.variants.map(v=>`rs${v.rsid}: ${result.conflictingRsids.includes(v.rsid)?"conflicting source calls; no reliable genotype":
       v.outcome.status==="genotyped"?`${v.outcome.genotype}${v.outcome.strandFlipped?" [opposite strand]":""} — ${v.outcome.interpretation}`:
        v.outcome.status==="unrecognized"?v.outcome.genotype:v.outcome.status}`)].join("\n")+"\n\n";
     const bytes=encoder.encode(text);for(let at=0;at<bytes.byteLength;at+=1048576)yield bytes.subarray(at,at+1048576);
    }
   }if(n!==reports)throw unavailable();await check(signal);
  }});
 }
 await check(options.signal);
 return {factories,check,records:allRecords,excludedHeldUploads:[...captured.values()].reduce((n,s)=>n+s.excludedHeldUploads,0),
  resultSources:allRecords().map(item=>{const row=accountPathBResultSchema.parse(JSON.parse(item.rowText));return {fileId:row.fileId,subjectId:row.subjectId,
   purpose:row.purpose,bindingRevision:row.bindingRevision,projection:"saved-path-b-results-v1" as const,
   rawSourceDisposition:"held-original-out-of-scope" as const,...row.source};})};
}
