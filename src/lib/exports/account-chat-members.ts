import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import {ownChatCitationSchema} from "@/lib/copilot/own-chat-content";
import type {createAccountContentReader} from "./account-content-reader";
import type {FuturePersonMemberFactory} from "./future-person-member-plan";
const uuid=z.uuid(),count=z.number().int().nonnegative().safe(),date=z.iso.datetime({offset:true});
const header=z.object({id:uuid,subject_id:uuid,scope_kind:z.literal("self"),created_at:date,message_count:count.positive()}).strict();
const headers=z.object({chats:z.array(header).max(100),nextAfterChatId:uuid.nullable()}).strict();
const message=z.object({id:uuid,role:z.enum(["user","assistant"]),content:z.string(),citations:z.array(ownChatCitationSchema).max(100),
 embryoFindings:z.tuple([]),createdAt:date}).strict();
const messages=z.object({messages:z.array(message).max(200),nextAfterOrdinal:count.positive().nullable()}).strict();
type Reader=Awaited<ReturnType<typeof createAccountContentReader>>;
const unavailable=()=>new Error("account_archive_chat_unavailable"),encoder=new TextEncoder();
function* bytes(value:string){const data=encoder.encode(value);for(let i=0;i<data.byteLength;i+=1_048_576)yield data.subarray(i,i+1_048_576);}
/** The existing job reader alone selects canonical own chats and their current
 * grants/projection prefix. No provider client, model call or human credential
 * is used. Capture complete header/message EOF count and rolling content hash;
 * each later member repeats the exact current read before ZIP completion. */
export async function prepareAccountChatMembers(options:{reader:Reader;signal:AbortSignal;check:(signal:AbortSignal)=>Promise<unknown>}){
 const context=options.reader.context,subjects=new Set(context.partitions.map(p=>p.subjectId));
 async function check(signal:AbortSignal){
  const remaining=Date.parse(context.deadline)-Date.now();
  if(options.signal.aborted||signal.aborted||remaining<=0)throw unavailable();
  const stop=new AbortController(),current=AbortSignal.any([options.signal,signal,stop.signal]);let abort=()=>{};
  const timer=setTimeout(()=>stop.abort(),Math.min(30_000,remaining));timer.unref();
  const canceled=new Promise<never>((_,reject)=>{abort=()=>reject(unavailable());current.addEventListener("abort",abort,{once:true});});
  try{if(current.aborted)throw unavailable();await Promise.race([Promise.resolve().then(async()=>{
    await options.check(current);if(current.aborted)throw unavailable();await options.reader.check(current);
   }),canceled]);if(current.aborted||Date.now()>=Date.parse(context.deadline))throw unavailable();
  }finally{clearTimeout(timer);current.removeEventListener("abort",abort);stop.abort();}
 }
 async function* chats(signal:AbortSignal){
  let after:string|null=null;
  for(;;){await check(signal);const page=headers.parse(await options.reader.content("chats",{afterChatId:after},signal));
   if(page.nextAfterChatId!==(page.chats.length===100?page.chats.at(-1)!.id:null))throw unavailable();
   for(const row of page.chats){if(row.id<=(after??"")||!subjects.has(row.subject_id))throw unavailable();after=row.id;yield row;}
   if(page.nextAfterChatId===null)break;
  }await check(signal);
 }
 const selected:z.infer<typeof header>[]=[],captured=new Map<string,{count:number;sha256:string}>();
 const headerDigest=(rows:z.infer<typeof header>[])=>createHash("sha256").update(JSON.stringify(rows)).digest("hex");
 async function* turns(row:z.infer<typeof header>,signal:AbortSignal){
  let after=0,total=0;const digest=createHash("sha256"),identities=new Set<string>();
  for(;;){await check(signal);const page=messages.parse(await options.reader.content("chat-messages",{chatId:row.id,afterOrdinal:after},signal));
   if(new Set(page.messages.map(m=>m.id)).size!==page.messages.length||page.nextAfterOrdinal!==null
    &&(page.nextAfterOrdinal<=after||page.nextAfterOrdinal>after+100))throw unavailable();
   for(const value of page.messages){if(identities.has(value.id)||++total>row.message_count)throw unavailable();identities.add(value.id);digest.update(JSON.stringify(value)+"\n");yield value;}
   if(page.nextAfterOrdinal===null)break;after=page.nextAfterOrdinal;
  }
  const actual={count:total,sha256:digest.digest("hex")};
  if(total!==row.message_count||captured.has(row.id)&&JSON.stringify(actual)!==JSON.stringify(captured.get(row.id)))throw unavailable();
  await check(signal);captured.set(row.id,actual);
 }
 for await(const row of chats(options.signal)){selected.push(row);for await(const value of turns(row,options.signal))void value;}
 const fingerprint=headerDigest(selected);
 async function current(signal:AbortSignal){const rows=[];for await(const row of chats(signal))rows.push(row);
  if(headerDigest(rows)!==fingerprint)throw unavailable();await check(signal);}
 const factories:FuturePersonMemberFactory[]=context.partitions.map(partition=>({name:`subjects/${partition.subjectId}/chats.json`,
  rows:selected.filter(row=>row.subject_id===partition.subjectId).length,chunks:async function*(signal){
   await current(signal);yield* bytes('{"schemaVersion":"subject-partitioned-archive-v1","rows":[');let comma=false;
   for(const row of selected.filter(chat=>chat.subject_id===partition.subjectId)){
    // Only the registered saved-history fields enter this subject member.
    yield* bytes((comma?",":"")+JSON.stringify({id:row.id,subject_id:row.subject_id,scope_kind:row.scope_kind,created_at:row.created_at}).slice(0,-1)+',"messages":[');
    let messageComma=false;for await(const value of turns(row,signal)){yield* bytes((messageComma?",":"")+JSON.stringify(value));messageComma=true;}
    yield* bytes("]}");comma=true;
   }await current(signal);yield* bytes("]}\n");
  }}));
 return {factories,check:current};
}
