import "server-only";
import {z} from "zod";
import {correctionScope,sealedCorrection,openNewCorrection} from "@/lib/future-person/correction-case-envelope";
import {ownStatementDownload,requesterStatementsOpen} from "@/lib/future-person/requester-statement";
import type {FuturePersonMemberFactory} from "./future-person-member-plan";
import type {RequesterStatementRuntime} from "./requester-statement-runtime";
const count=z.number().int().nonnegative().safe(),revision=count.positive(),hash=z.string().regex(/^[0-9a-f]{64}$/u);
export const accountOwnStatementCapture=z.object({version:z.literal("test-account-own-statements-v1"),corrections:count,appeals:z.literal(0),
 membershipSha256:hash,originalDeadline:z.iso.datetime({offset:true}).nullable(),
 partitions:z.array(z.object({subjectId:z.uuid(),rows:count.positive()}).strict())}).strict()
 .refine(v=>(v.corrections===0)===(v.originalDeadline===null)&&v.partitions.reduce((n,p)=>n+p.rows,0)===v.corrections
  &&new Set(v.partitions.map(p=>p.subjectId)).size===v.partitions.length);
export const nativeAccountStatement=z.object({scope:correctionScope,envelope:sealedCorrection,binding:z.object({accountId:z.uuid(),sessionId:z.uuid(),
 bindingId:z.uuid(),principalId:z.uuid(),subjectId:z.uuid(),accountAuthSessionRevision:revision,sessionRevision:revision,
 principalRevision:revision,lifecycleRevision:revision,bindingRevision:revision,sourceReceipt:hash,caseHash:hash}).strict()}).strict();
const page=z.object({rows:z.array(z.object({id:z.uuid(),frame:nativeAccountStatement}).strict()).max(32),count:count.max(32),nextAfterId:z.uuid().nullable()}).strict();
const unavailable=()=>new Error("account_statement_archive_unavailable"),encoder=new TextEncoder();
/** Actual native account/session/bound-author proof precedes every unwrap.
 * All partition counts and EOF are checked before the ZIP starts and again at
 * materialization. Only the requester's literal statement reaches the member. */
export async function prepareAccountRequesterStatementMembers(options:{capture:unknown;accountId:string;sessionId:string;
 sensitiveRuntime?:RequesterStatementRuntime;
 subjects:string[];signal:AbortSignal;check:(signal:AbortSignal)=>Promise<unknown>;
 call:(subject:string,after:string|null,signal:AbortSignal)=>Promise<unknown>}){
 if(!requesterStatementsOpen())throw unavailable();const captured=accountOwnStatementCapture.parse(options.capture);
 if(captured.partitions.some(p=>!options.subjects.includes(p.subjectId)))throw unavailable();
 const factories:FuturePersonMemberFactory[]=[];
 for(const partition of captured.partitions){
  async function* rows(signal:AbortSignal){let after:string|null=null,n=0;
   for(;;){if(signal.aborted)throw unavailable();await options.check(signal);
    const value=page.parse(await options.call(partition.subjectId,after,signal));
    if(value.count!==value.rows.length||value.nextAfterId!==(value.rows.at(-1)?.id??null))throw unavailable();
    if(!value.count){if(n!==partition.rows)throw unavailable();await options.check(signal);return;}
    for(const item of value.rows){const frame=item.frame;
     if(after!==null&&item.id<=after||frame.scope.caseId!==item.id||frame.binding.accountId!==options.accountId
      ||frame.binding.sessionId!==options.sessionId||frame.binding.subjectId!==partition.subjectId
      ||frame.scope.originalAuthorPrincipalId!==frame.binding.principalId
      ||frame.scope.originalSubjectId!==partition.subjectId||++n>partition.rows)throw unavailable();
     await options.check(signal);const statement=openNewCorrection(frame.scope,frame.envelope);
     if(statement===null)throw unavailable();await options.check(signal);after=item.id;
     const bytes=encoder.encode(JSON.stringify(ownStatementDownload.parse({correctionId:item.id,statement})));options.sensitiveRuntime?.own(bytes);
     try{yield bytes;}finally{if(options.sensitiveRuntime)options.sensitiveRuntime.clear(bytes);else bytes.fill(0);}
    }
   }
  }
  for await(const bytes of rows(options.signal))bytes.fill(0);
  factories.push({name:`subjects/${partition.subjectId}/my-correction-statements.json`,rows:partition.rows,
   chunks:async function*(signal){await options.check(signal);yield encoder.encode('{"schemaVersion":"test-requester-own-statements-v1","rows":[');let comma=false;
    for await(const bytes of rows(signal)){try{await options.check(signal);if(comma)yield encoder.encode(",");yield bytes;await options.check(signal);comma=true;}finally{bytes.fill(0);}}
    await options.check(signal);yield encoder.encode("]}\n");await options.check(signal);
   }});
 }
 return {captured,factories};
}
