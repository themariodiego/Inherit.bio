import "server-only";
import type {FuturePersonMemberFactory} from "./future-person-member-plan";
import {ACCOUNT_SUBJECT_MEMBERS} from "./account-archive-plan";
import type {RequesterStatementRuntime} from "./requester-statement-runtime";
const encoder=new TextEncoder(),unavailable=()=>new Error("account_archive_composition_unavailable");
/** Preserve each actual producer's complete document as a named JSON section.
 * No historical row is overwritten by current account metadata, no global
 * ledger is duplicated and no missing member is replaced by an empty value. */
export function composeAccountMemberFactories(groups:{kind:"account-metadata"|"ordinary-science"|"saved-chats"|"retained-custody"|"actor-audit"|"graph-metadata"|"path-b-results"|"requester-statements";
 factories:FuturePersonMemberFactory[]}[]){
 const byName=new Map<string,{kind:string;factory:FuturePersonMemberFactory}[]>();
 for(const group of groups){const seen=new Set<string>();for(const factory of group.factories){
  if(seen.has(factory.name)||!Number.isSafeInteger(factory.rows)||factory.rows<0)throw unavailable();seen.add(factory.name);
  const values=byName.get(factory.name)??[];values.push({kind:group.kind,factory});byName.set(factory.name,values);
 }}
 const factories:FuturePersonMemberFactory[]=[];
 for(const [name,sections]of byName){
  if(sections.length===1){factories.push(sections[0].factory);continue;}
  if(/^subjects\/[a-f0-9-]{36}\/reports\.txt$/u.test(name)&&sections.length===2
   &&sections.some(s=>s.kind==="ordinary-science")&&sections.some(s=>s.kind==="path-b-results")){
   const rows=sections.reduce((n,s)=>n+s.factory.rows,0);if(!Number.isSafeInteger(rows))throw unavailable();
   factories.push({name,rows,chunks:async function*(signal){for(const section of sections){
    if(signal.aborted)throw unavailable();yield* section.factory.chunks(signal);
   }if(signal.aborted)throw unavailable();}});continue;
  }
  if(!/^subjects\/[a-f0-9-]{36}\//u.test(name)||!ACCOUNT_SUBJECT_MEMBERS.includes(name.split("/").at(-1)! as (typeof ACCOUNT_SUBJECT_MEMBERS)[number])
   ||!name.endsWith(".json")||sections.some(s=>s.kind==="actor-audit")||new Set(sections.map(s=>s.kind)).size!==sections.length)throw unavailable();
  const rows=sections.reduce((n,s)=>n+s.factory.rows,0);if(!Number.isSafeInteger(rows))throw unavailable();
  factories.push({name,rows,chunks:async function*(signal){
   yield encoder.encode('{"schemaVersion":"subject-partitioned-archive-v1","sections":[');let comma=false;
   for(const section of sections){if(signal.aborted)throw unavailable();yield encoder.encode((comma?",":"")+JSON.stringify({kind:section.kind}).slice(0,-1)+',"content":');
    yield* section.factory.chunks(signal);yield encoder.encode("}");comma=true;
   }if(signal.aborted)throw unavailable();yield encoder.encode("]}\n");
  }});
 }
 return factories;
}

/** Coalesce owned output fragments to32KiB under consumer backpressure. Source
 * factories retain their exact row/EOF/current checks; the outer member plan
 * verifies complete byte identity and current authority before each emitted
 * block. This changes neither source bytes nor original provider-range reads. */
export function bufferAccountMemberFactories(factories:FuturePersonMemberFactory[],sensitive=false,runtime?:RequesterStatementRuntime){
 return factories.map(factory=>({...factory,chunks:async function*(signal:AbortSignal){
  let buffer=new Uint8Array(32_768),filled=0;if(sensitive)runtime?.own(buffer);if(signal.aborted)throw unavailable();
  try{for await(const bytes of factory.chunks(signal)){
   if(signal.aborted||!(bytes instanceof Uint8Array)||bytes.byteLength<1||bytes.byteLength>4_000_000)throw unavailable();
   for(let offset=0;offset<bytes.byteLength;){
    if(signal.aborted)throw unavailable();const length=Math.min(buffer.byteLength-filled,bytes.byteLength-offset);
    buffer.set(bytes.subarray(offset,offset+length),filled);filled+=length;offset+=length;
    if(filled===buffer.byteLength){yield buffer;if(sensitive){if(runtime)runtime.clear(buffer);else buffer.fill(0);}if(signal.aborted)throw unavailable();buffer=new Uint8Array(32_768);if(sensitive)runtime?.own(buffer);filled=0;}
   }
  }
  if(signal.aborted)throw unavailable();if(filled)yield buffer.subarray(0,filled);
  }finally{if(sensitive){if(runtime)runtime.clear(buffer);else buffer.fill(0);}}
 }}));
}
