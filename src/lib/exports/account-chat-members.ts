import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import {ownChatCitationSchema} from "@/lib/copilot/own-chat-content";
import type {createAccountContentReader} from "./account-content-reader";
import type {FuturePersonMemberFactory} from "./future-person-member-plan";
import {accountArchiveScope} from "./account-archive-scope";
import {anySignal} from "./abort-signals";
const uuid=z.uuid(),count=z.number().int().nonnegative().safe(),date=z.iso.datetime({offset:true}),hash=z.string().regex(/^[a-f0-9]{64}$/u);
const header=z.object({id:uuid,subject_id:uuid,scope_kind:z.literal("self"),created_at:date,message_count:count.positive()}).strict();
const headers=z.object({chats:z.array(header).max(100),nextAfterChatId:uuid.nullable()}).strict();
const message=z.object({id:uuid,role:z.enum(["user","assistant"]),content:z.string(),citations:z.array(ownChatCitationSchema).max(100),
 embryoFindings:z.tuple([]),createdAt:date}).strict();
const messages=z.object({messages:z.array(message).max(200),nextAfterOrdinal:count.positive().nullable()}).strict();
/** A one-record export's family group conversation turn, as
 * private.export_subject_family_turn_rows_v1 projects it (20261023110000):
 * written text and citations without a record's id or link. The ordinal and
 * role order stay in the transport key. */
const familyCitation=z.object({label:z.string().min(1).max(1000),id:z.string().min(1).max(2000).optional(),
 href:z.string().min(1).max(4000).optional()}).strict()
 .refine(c=>![c.label,c.id??"",c.href??""].some(v=>/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu.test(v)));
const familyTurn=z.object({chat_id:uuid,chat_created_at:date,id:uuid,role:z.enum(["user","assistant"]),content:z.string(),
 citations:z.array(familyCitation).max(100),created_at:date}).strict();
const familyKey=z.tuple([uuid,count.positive(),z.union([z.literal(0),z.literal(1)])]);
const familyMembership=z.object({version:z.literal("account-family-turns-v1"),rows:count,membershipSha256:hash}).strict();
const familyPage=z.object({version:z.literal("account-family-turns-page-v1"),membership:familyMembership,
 rows:z.array(z.object({identity:z.string().max(256),rowText:z.string().max(1_048_576)}).strict()).max(25),
 nextAfterKey:familyKey.nullable()}).strict();
type FamilyKey=z.infer<typeof familyKey>;
const compareKey=(a:FamilyKey,b:FamilyKey)=>a[0]!==b[0]?(a[0]<b[0]?-1:1):a[1]!==b[1]?a[1]-b[1]:a[2]-b[2];
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
  const stop=new AbortController(),current=anySignal([options.signal,signal,stop.signal]);let abort=()=>{};
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
 // A one-record export also carries the record's family group conversation
 // turns that are still current (owner decision, 23 October 2026). The
 // server's membership is bound into the job's receipt; every read here must
 // reach exactly that count and digest, so a grant that ends mid-job fails it.
 const subject=accountArchiveScope(context)==="subject";
 let family:z.infer<typeof familyMembership>|null=null;
 async function* familyTurns(signal:AbortSignal){
  let after:FamilyKey|null=null,n=0,digest=createHash("sha256").update("account-family-turns-v1").digest(),membership:z.infer<typeof familyMembership>|null=null;
  for(;;){await check(signal);const page=familyPage.parse(await options.reader.content("family-turns",{afterKey:after},signal));
   if(membership&&JSON.stringify(page.membership)!==JSON.stringify(membership)||family&&JSON.stringify(page.membership)!==JSON.stringify(family))throw unavailable();
   membership??=page.membership;let last:FamilyKey|null=null;
   for(const item of page.rows){const key=familyKey.parse(JSON.parse(item.identity));
    if(after&&compareKey(key,after)<=0||++n>membership.rows||Buffer.byteLength(item.rowText,"utf8")>1_048_576)throw unavailable();
    const row=familyTurn.parse(JSON.parse(item.rowText));if(row.chat_id!==key[0]||(row.role==="user")!==(key[2]===0))throw unavailable();
    digest=createHash("sha256").update(digest).update(`${item.identity}:${item.rowText}\n`).digest();after=key;last=key;yield row;
   }
   if(page.nextAfterKey!==null){if(page.rows.length!==25||last===null||compareKey(page.nextAfterKey,last)!==0)throw unavailable();}
   else{if(page.rows.length===25)throw unavailable();break;}
  }
  if(!membership||n!==membership.rows||digest.toString("hex")!==membership.membershipSha256)throw unavailable();
  await check(signal);family??=membership;
 }
 const familyChats:{id:string;created_at:string}[]=[];
 if(subject)for await(const row of familyTurns(options.signal))if(familyChats.at(-1)?.id!==row.chat_id){
  if(familyChats.some(chat=>chat.id===row.chat_id))throw unavailable();familyChats.push({id:row.chat_id,created_at:row.chat_created_at});}
 const factories:FuturePersonMemberFactory[]=context.partitions.map(partition=>({name:`subjects/${partition.subjectId}/chats.json`,
  rows:selected.filter(row=>row.subject_id===partition.subjectId).length+(subject?familyChats.length:0),chunks:async function*(signal){
   await current(signal);yield* bytes('{"schemaVersion":"subject-partitioned-archive-v1","rows":[');let comma=false;
   for(const row of selected.filter(chat=>chat.subject_id===partition.subjectId)){
    // Only the registered saved-history fields enter this subject member.
    yield* bytes((comma?",":"")+JSON.stringify({id:row.id,subject_id:row.subject_id,scope_kind:row.scope_kind,created_at:row.created_at}).slice(0,-1)+',"messages":[');
    let messageComma=false;for await(const value of turns(row,signal)){yield* bytes((messageComma?",":"")+JSON.stringify(value));messageComma=true;}
    yield* bytes("]}");comma=true;
   }
   if(subject){let open:string|null=null,messageComma=false,seen=0;
    for await(const turn of familyTurns(signal)){
     if(turn.chat_id!==open){if(open!==null)yield* bytes("]}");const chat=familyChats[seen++];
      if(!chat||chat.id!==turn.chat_id||chat.created_at!==turn.chat_created_at)throw unavailable();open=turn.chat_id;messageComma=false;
      // A group conversation is anchored on no single record.
      yield* bytes((comma?",":"")+JSON.stringify({id:chat.id,subject_id:null,scope_kind:"family",created_at:chat.created_at}).slice(0,-1)+',"messages":[');comma=true;}
     yield* bytes((messageComma?",":"")+JSON.stringify({id:turn.id,role:turn.role,content:turn.content,citations:turn.citations,createdAt:turn.created_at}));messageComma=true;
    }
    if(open!==null)yield* bytes("]}");if(seen!==familyChats.length)throw unavailable();
   }
   await current(signal);yield* bytes("]}\n");
  }}));
 return {factories,check:current};
}
