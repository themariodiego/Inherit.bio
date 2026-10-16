import "server-only";
import {z} from "zod";
import {accountArchiveContextSchema} from "./bound-account-archive-worker";
import {ACCOUNT_GRAPH_CLASSES} from "./account-graph-projection";
import {prepareAccountRoutedGraphRows,type AccountRoutedGraphRpc} from "./account-routed-graph-rows";
import type {FuturePersonMemberFactory} from "./future-person-member-plan";
const unavailable=()=>new Error("account_archive_graph_members_unavailable"),encoder=new TextEncoder();

/** All seven exact source receipts are consumed, including genuine zero EOF.
 * Server routing is hashed and never reconstructed from owner/FK presence.
 * Internal composite identities never enter the archive. Every nonempty row is
 * emitted once into the declared subject metadata member and reread at ZIP EOF. */
export async function prepareAccountGraphMembers(options:{context:z.infer<typeof accountArchiveContextSchema>;
 reference:{exportId:string;attemptId:string;authorityReceipt:string};rpc:AccountRoutedGraphRpc;
 signal:AbortSignal;check:(signal:AbortSignal)=>Promise<unknown>}){
 const context=accountArchiveContextSchema.parse(options.context),readers:Awaited<ReturnType<typeof prepareAccountRoutedGraphRows>>[]=[];
 for(const kind of ACCOUNT_GRAPH_CLASSES)readers.push(await prepareAccountRoutedGraphRows({...options,kind}));
 const counts=new Map<string,number>();
 for(const reader of readers){for await(const item of reader.records(options.signal)){
   const key=`${item.subjectId}/${reader.kind==="family_pairs"?"portrait":"embryos"}`;
   counts.set(key,(counts.get(key)??0)+1);
  }await reader.assertComplete(options.signal);
 }
 const receipts=readers.map(r=>({kind:r.kind,rows:r.membership.rows,membershipSha256:r.membership.sha256,partitions:r.partitions()}));
 const check=async(signal:AbortSignal)=>{await options.check(signal);for(const reader of readers)await reader.check(signal);};
 const factories:FuturePersonMemberFactory[]=[];
 for(const part of context.partitions)for(const member of ["portrait","embryos"] as const){
  const rows=counts.get(`${part.subjectId}/${member}`)??0;if(rows===0)continue;
  factories.push({name:`subjects/${part.subjectId}/${member}.json`,rows,chunks:async function*(signal){
   await check(signal);yield encoder.encode('{"schemaVersion":"subject-partitioned-archive-v1","rows":[');let n=0;
   for(const reader of readers)if((reader.kind==="family_pairs"?"portrait":"embryos")===member){
    for await(const item of reader.records(signal))if(item.subjectId===part.subjectId){
     if(++n>rows)throw unavailable();yield encoder.encode((n===1?"":",")+JSON.stringify({kind:reader.kind,scope:item.scope,row:item.row}));
    }await reader.assertComplete(signal);
   }
   if(n!==rows)throw unavailable();await check(signal);yield encoder.encode("]}\n");
  }});
 }
 await check(options.signal);return {factories,receipts,check};
}
