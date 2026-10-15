import "server-only";
import {z} from "zod";
import {accountArchiveContextSchema} from "./bound-account-archive-worker";
import {ACCOUNT_HISTORY_KINDS,type AccountHistoryKind,type prepareAccountHistoryInventory} from "./account-history-inventory";
import {accountClassRowSchemas,type AccountProjectedClass,type prepareAccountClassInventory} from "./account-class-inventory";
import type {prepareAccountArchiveMetadata} from "./account-member-metadata";
import type {FuturePersonMemberFactory} from "./future-person-member-plan";

type History=Awaited<ReturnType<typeof prepareAccountHistoryInventory>>;
type Classes=Awaited<ReturnType<typeof prepareAccountClassInventory>>;
type Metadata=Awaited<ReturnType<typeof prepareAccountArchiveMetadata>>;
type Context=z.infer<typeof accountArchiveContextSchema>;
export const ACCOUNT_METADATA_MEMBERS=["subject","consents","legacy-consents","attestations","reports","portrait","embryos"] as const;
export type AccountMetadataMember=(typeof ACCOUNT_METADATA_MEMBERS)[number];
const historyMembers:Record<AccountHistoryKind,AccountMetadataMember>={subjects:"subject",demographics:"subject",principals:"subject",bindings:"subject",
 "account-consents":"consents",signatures:"consents",attestations:"attestations","recipient-grants":"consents","legacy-consents":"legacy-consents"};
const classMembers:Record<AccountProjectedClass,AccountMetadataMember>={attestation_contradictions:"attestations",directional_grants:"consents",
 family_sharing_pauses:"portrait",family_sharing_stops:"portrait",future_person_claim_objections:"embryos",future_person_claimant_principals:"embryos",
 future_person_claims:"embryos",subject_control_refusal_authorities:"subject",subject_relationships:"subject",suppressions:"reports"};
type Projected={kind:string;scope:"subject"|"requester-account-history";row:unknown};
const unavailable=()=>new Error("account_archive_partition_unavailable"),encoder=new TextEncoder();

/** Partition already-authorized, closed projections. A foreign/unrecorded
 * target in the requester's own action history is explicitly account history
 * under the actual self partition; it cannot create authority over that target.
 * No source row is omitted, inferred, copied to multiple subjects or retained
 * as an unbounded buffer. Every subsequent member rereads complete inventories. */
export async function prepareAccountPartitionMembers(options:{context:Context;history:History;classes:Classes;metadata:Metadata;
 signal:AbortSignal;check:(signal:AbortSignal)=>Promise<unknown>}){
 const context=accountArchiveContextSchema.parse(options.context);
 if(context.targetKind!=="account"||context.targetId!==context.actor.accountId)throw unavailable();
 const selected=new Set(context.partitions.map(p=>p.subjectId));
 const subjects=new Map<string,{id:string;subject_class:string}>();
 async function currentAuthority(signal:AbortSignal){
  const remaining=Date.parse(context.deadline)-Date.now();if(signal.aborted||remaining<=0)throw unavailable();
  const stop=new AbortController(),current=AbortSignal.any([options.signal,signal,stop.signal]);let abort=()=>{};
  const timer=setTimeout(()=>stop.abort(),Math.min(30_000,remaining));timer.unref();
  const canceled=new Promise<never>((_,reject)=>{abort=()=>reject(unavailable());current.addEventListener("abort",abort,{once:true});});
  try{if(current.aborted)throw unavailable();await Promise.race([Promise.resolve().then(()=>options.check(current)),canceled]);
   if(current.aborted||Date.now()>=Date.parse(context.deadline))throw unavailable();
  }finally{clearTimeout(timer);current.removeEventListener("abort",abort);stop.abort();}
 }
 async function check(signal:AbortSignal){
  if(signal.aborted||Date.now()>=Date.parse(context.deadline))throw unavailable();
  await currentAuthority(signal);await options.history.check(signal);await options.classes.check(signal);await options.metadata.check(signal);
  if(signal.aborted||Date.now()>=Date.parse(context.deadline))throw unavailable();
 }
 await check(options.signal);
 for await(const row of options.history.records("subjects",options.signal)){
  if(!selected.has(row.id)||subjects.has(row.id))throw unavailable();subjects.set(row.id,row);
 }
 if(subjects.size!==selected.size)throw unavailable();
 const self=[...subjects.values()].filter(row=>row.subject_class==="self");
 if(self.length!==1||!context.partitions.some(p=>p.subjectId===self[0].id&&p.class==="ordinary"))throw unavailable();
 const anchor=self[0].id;
 const location=(subject:string|null|undefined)=>subject&&selected.has(subject)?{subjectId:subject,scope:"subject" as const}:
  {subjectId:anchor,scope:"requester-account-history" as const};
 function historyLocation(kind:AccountHistoryKind,value:unknown){
  const row=value as Record<string,unknown>;
  const target=kind==="subjects"?row.id:kind==="demographics"||kind==="principals"||kind==="bindings"||kind==="account-consents"?row.subject_id:
   (kind==="signatures"||kind==="attestations")&&row.target_kind==="subject"?row.target_id:null;
  return location(typeof target==="string"?target:null);
 }
 async function* records(signal:AbortSignal,member?:AccountMetadataMember):AsyncGenerator<{subjectId:string;member:AccountMetadataMember;value:Projected}>{
  for(const kind of ACCOUNT_HISTORY_KINDS)if(member===undefined||historyMembers[kind]===member)for await(const row of options.history.records(kind,signal)){
   const at=historyLocation(kind,row);yield {subjectId:at.subjectId,member:historyMembers[kind],value:{kind,scope:at.scope,row}};
  }
  for(const kind of Object.keys(accountClassRowSchemas) as AccountProjectedClass[])if(member===undefined||classMembers[kind]===member)
   for await(const item of options.classes.records(kind,signal)){
    const at=location(item.subjectId);yield {subjectId:at.subjectId,member:classMembers[kind],value:{kind,scope:at.scope,row:item.row}};
   }
  if(options.metadata.profiles.length!==1||options.metadata.profiles[0].id!==context.actor.accountId)throw unavailable();
  if(member===undefined||member==="subject")for(const row of options.metadata.profiles)yield {subjectId:anchor,member:"subject",value:{kind:"profile",scope:"requester-account-history",row}};
  if(member===undefined||member==="consents")for(const row of options.metadata.purposeGrants){
   if(!selected.has(row.target_id))throw unavailable();
   yield {subjectId:row.target_id,member:"consents",value:{kind:"purpose-grants",scope:"subject",row}};
  }
 }
 const counts=new Map<string,number>();
 for await(const item of records(options.signal)){
  const key=`${item.subjectId}/${item.member}`,count=(counts.get(key)??0)+1;if(!Number.isSafeInteger(count))throw unavailable();counts.set(key,count);
 }
 await check(options.signal);
 const factories:FuturePersonMemberFactory[]=[];
 for(const partition of context.partitions)for(const member of ACCOUNT_METADATA_MEMBERS){
  const rows=counts.get(`${partition.subjectId}/${member}`)??0;
  factories.push({name:`subjects/${partition.subjectId}/${member}.json`,rows,chunks:async function*(signal){
   await check(signal);yield encoder.encode('{"schemaVersion":"subject-partitioned-archive-v1","rows":[');let count=0;
   for await(const item of records(signal,member))if(item.subjectId===partition.subjectId){
    if(++count>rows)throw unavailable();yield encoder.encode((count===1?"":",")+JSON.stringify(item.value));
   }
   if(count!==rows)throw unavailable();await check(signal);yield encoder.encode("]}\n");
  }});
 }
 return {factories,anchorSubjectId:anchor,check};
}
