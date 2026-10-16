import "server-only";
import {ACCOUNT_CLASS_KINDS} from "./account-class-inventory";
import {ACCOUNT_HISTORY_KINDS} from "./account-history-inventory";
import type {prepareAccountCompleteReader} from "./account-complete-reader";
import type {FuturePersonMemberFactory} from "./future-person-member-plan";

type Reader=Awaited<ReturnType<typeof prepareAccountCompleteReader>>;
type Records=ReturnType<Reader["records"]>;
const encoder=new TextEncoder(),unavailable=()=>new Error("account_complete_members_unavailable");
const exclusions={
 "outside-consent-scope":"These stored records are outside the scope of the signed consent for this export.",
 "separate-raw-export-authority-required":"Raw data requires a separate current raw-data export authorization for this recipient.",
 "export-recipient-consent-required":"The stored report has no current signed export authorization for this recipient.",
} as const;

/** Only native-selected rows become archive content. Source counts and explicit
 * exclusions are retained even when exportRows is zero. Compatibility readers
 * produce the ordinary/bound files; this producer never supplies empty stand-ins
 * for those files, or turns analysis consent into raw export authority. */
export function prepareAccountCompleteMembers(reader:Reader){
 const factories:FuturePersonMemberFactory[]=[];
 const json=(name:string,rows:number,metadata:unknown,records:(signal:AbortSignal)=>Records):FuturePersonMemberFactory=>({name,rows,
  chunks:async function*(signal){
   await reader.check(signal);yield encoder.encode(JSON.stringify({schemaVersion:"account-complete-members-v1",scope:metadata}).slice(0,-1)+',"rows":[');
   let n=0;
   for await(const record of records(signal)){
    if(++n>rows)throw unavailable();yield encoder.encode((n===1?"":",")+JSON.stringify({identity:record.identity,subjectId:record.subjectId}).slice(0,-1)+',"row":');
    yield* record.bytes(signal);yield encoder.encode("}");
   }
   if(n!==rows)throw unavailable();await reader.check(signal);yield encoder.encode("]}\n");
  }});
 for(const member of reader.context.completeReceipt.members){
  const name=`subjects/${member.subjectId}/${member.member}`;
  if(member.member!=="reports.txt"){
   factories.push(json(name,member.rows,member,signal=>reader.memberRecords(member.subjectId,member.member,signal)));continue;
  }
  const explanation=member.status==="excluded"?exclusions[member.reason as keyof typeof exclusions]:
   "This file contains only stored reports selected by the current signed export authorization.";
  if(typeof explanation!=="string")throw unavailable();
  factories.push({name,rows:member.rows,chunks:async function*(signal){
   await reader.check(signal);
   yield encoder.encode(`Stored reports\nScope: ${member.status}\nReason: ${member.reason}\nSource records: ${member.sourceRows}\nExported records: ${member.rows}\n${explanation}\n\n`);
   let n=0;for await(const record of reader.memberRecords(member.subjectId,"reports.txt",signal)){
    if(++n>member.rows)throw unavailable();yield* record.bytes(signal);yield encoder.encode("\n");
   }
   if(n!==member.rows)throw unavailable();await reader.check(signal);
  }});
 }
 for(const kind of ACCOUNT_CLASS_KINDS){
  const receipt=reader.context.completeReceipt.classes.find(c=>c.kind===kind)!;
  factories.push(json(`complete/classes/${kind}.json`,receipt.routed.rows,{receipt,
   dispositions:reader.context.dispositions.filter(d=>d.kind===kind)},signal=>reader.records(kind,signal)));
 }
 for(const kind of ACCOUNT_HISTORY_KINDS){
  const receipt=reader.context.completeReceipt.history.find(h=>h.kind===kind)!;
  factories.push(json(`complete/history/${kind}.json`,receipt.routed.rows,receipt,signal=>reader.historyRecords(kind,signal)));
 }
 return {factories,check:reader.check};
}
