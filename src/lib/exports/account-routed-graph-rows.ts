import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import {accountArchiveContextSchema} from "./bound-account-archive-worker";
import {ACCOUNT_GRAPH_CLASSES,accountGraphIdentitySchemas,accountGraphRowSchemas,accountGraphProjectionDigest,type AccountGraphClass} from "./account-graph-projection";
const hash=z.string().regex(/^[a-f0-9]{64}$/u),count=z.number().int().nonnegative().safe();
const membership=z.object({rows:count,sha256:hash}).strict();
const page=z.object({version:z.literal("account-graph-page-v2"),kind:z.enum(ACCOUNT_GRAPH_CLASSES),authorityReceipt:hash,membership,
 rows:z.array(z.object({identity:z.string().max(512),subjectId:z.uuid(),scope:z.literal("requester-account-history"),rowText:z.string().max(8192)}).strict()).max(500),nextAfterKey:z.unknown()}).strict();
export type AccountRoutedGraphRpc=(name:"export_archive_account_graph_rows_v2",args:{p_export_id:string;p_attempt_id:string;p_authority_receipt:string;
 p_kind:AccountGraphClass;p_after_key:(string|number)[]|null},signal:AbortSignal)=>PromiseLike<{data:unknown;error:unknown}>;
const unavailable=()=>new Error("account_archive_graph_unavailable");
function compare(a:readonly(string|number)[],b:readonly(string|number)[]){for(let i=0;i<a.length;i++){
 if(typeof a[i]!==typeof b[i])throw unavailable();if(a[i]!==b[i])return a[i]<b[i]?-1:1;}return 0;}
/** Real consumed and server-routed metadata transport. Each row route is part
 * of the exact membership hash and must belong to the current captured subject
 * set. The closed scope describes the requester's own recorded action graph;
 * it cannot admit counterpart histories or scientific/raw source.
 * Consumed metadata transport only. No invocation supplies human/graph/source
 * authority; the real SQL capture admits only its exactly implemented own metadata/results classes; every unsupported whole graph remains refused. Completion is
 * exact source EOF, count, real composite identity and raw projected-content
 * receipt under independent current worker authority, never READY or delivery. */
export async function prepareAccountRoutedGraphRows(options:{kind:AccountGraphClass;context:z.infer<typeof accountArchiveContextSchema>;
 reference:{exportId:string;attemptId:string;authorityReceipt:string};rpc:AccountRoutedGraphRpc;check:(signal:AbortSignal)=>Promise<unknown>;signal:AbortSignal}){
 const kind=z.enum(ACCOUNT_GRAPH_CLASSES).parse(options.kind),context=accountArchiveContextSchema.parse(options.context);
 z.object({exportId:z.uuid(),attemptId:z.uuid(),authorityReceipt:hash}).strict().parse(options.reference);
 if(context.targetKind!=="account"||context.targetId!==context.actor.accountId||context.authorityReceipt!==options.reference.authorityReceipt)throw unavailable();
 let captured:z.infer<typeof membership>|null=null,complete=false;const subjects=new Set(context.partitions.map(p=>p.subjectId)),partitions=new Map<string,number>();
 const active=(signal:AbortSignal)=>{if(signal.aborted||options.signal.aborted||Date.now()>=Date.parse(context.deadline))throw unavailable();};
 async function bounded<T>(signal:AbortSignal,operation:(current:AbortSignal)=>PromiseLike<T>){
  active(signal);const stop=new AbortController(),current=AbortSignal.any([signal,options.signal,stop.signal]);let abort=()=>{};
  const timer=setTimeout(()=>stop.abort(),Math.min(30_000,Date.parse(context.deadline)-Date.now()));timer.unref();
  const canceled=new Promise<never>((_,reject)=>{abort=()=>reject(unavailable());current.addEventListener("abort",abort,{once:true});});
  try{if(current.aborted)throw unavailable();const result=await Promise.race([Promise.resolve().then(()=>operation(current)),canceled]);active(current);return result;
  }finally{clearTimeout(timer);current.removeEventListener("abort",abort);stop.abort();}
 }
 async function read(after:(string|number)[]|null,signal:AbortSignal){
  await bounded(signal,current=>options.check(current));const result=await bounded(signal,current=>options.rpc("export_archive_account_graph_rows_v2",{
   p_export_id:options.reference.exportId,p_attempt_id:options.reference.attemptId,p_authority_receipt:options.reference.authorityReceipt,
   p_kind:kind,p_after_key:after},current));if(result.error!==null)throw unavailable();
  const value=page.parse(result.data);if(value.kind!==kind||value.authorityReceipt!==options.reference.authorityReceipt)throw unavailable();
  if(captured&&JSON.stringify(value.membership)!==JSON.stringify(captured))throw unavailable();
  await bounded(signal,current=>options.check(current));active(signal);return value;
 }
 const initial=await read(null,options.signal);captured=initial.membership;
 const check=async(signal:AbortSignal)=>{await read(null,signal);};
 async function* records(signal:AbortSignal){
  complete=false;partitions.clear();let after:(string|number)[]|null=null,n=0,digest=createHash("sha256").update(`account-graph-routed-v2|${kind}`).digest();
  for(;;){const value=await read(after,signal);let last:(string|number)[]|null=null;
   for(const item of value.rows){active(signal);const tuple=accountGraphIdentitySchemas[kind].parse(JSON.parse(item.identity));
    if(JSON.stringify(tuple)!==item.identity||after&&compare(tuple,after)<=0||++n>captured!.rows
     ||!subjects.has(item.subjectId)||Buffer.byteLength(item.rowText,"utf8")>8192)throw unavailable();
    const row=accountGraphRowSchemas[kind].parse(JSON.parse(item.rowText));
    accountGraphProjectionDigest(kind,[{version:"account-graph-projection-v1",kind,identity:item.identity,row}]);
    digest=createHash("sha256").update(digest).update(`${item.identity}:${item.subjectId}:${item.scope}:${item.rowText}\n`).digest();after=tuple;last=tuple;partitions.set(item.subjectId,(partitions.get(item.subjectId)??0)+1);yield {subjectId:item.subjectId,scope:item.scope,row};
   }
   if(value.nextAfterKey!==null){const next=accountGraphIdentitySchemas[kind].parse(value.nextAfterKey);
    if(value.rows.length!==500||last===null||JSON.stringify(next)!==JSON.stringify(last))throw unavailable();
   }else{if(value.rows.length===500)throw unavailable();break;}
  }
  if(n!==captured!.rows||digest.toString("hex")!==captured!.sha256)throw unavailable();await check(signal);active(signal);complete=true;
 }
 return {kind,membership:captured,records,check,partitions:()=>{if(!complete)throw unavailable();return [...partitions].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([subjectId,rows])=>({subjectId,rows}));},assertComplete:async(signal:AbortSignal)=>{if(!complete)throw unavailable();await check(signal);active(signal);}};
}
