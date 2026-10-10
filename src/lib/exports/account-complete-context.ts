import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import {accountArchiveContextSchema} from "./bound-account-archive-worker";
import {ACCOUNT_CLASS_KINDS,accountClassInventorySchema} from "./account-class-inventory";
import {ACCOUNT_HISTORY_KINDS,accountHistoryInventorySchema} from "./account-history-inventory";
import {ACCOUNT_SUBJECT_MEMBERS} from "./account-subject-member-names";
import {publishedPreparedSourceSchema} from "@/lib/genome/prepared-source/published-source-reader";

const uuid=z.uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/u),count=z.number().int().nonnegative().safe();
const partition=z.object({subjectId:uuid,rows:count}).strict();
const membership=z.object({rows:count,membershipSha256:hash,partitions:z.array(partition)}).strict();
const completeClass=membership.extend({kind:z.enum(ACCOUNT_CLASS_KINDS),legacy:membership,routed:membership}).strict();
const scopePartition=z.object({subjectId:uuid,class:z.enum(["ordinary","claimed-bound","consent-covered"]),
 fileCount:count,fileIds:z.array(uuid)}).strict();
const reasons=["own-subject","claimed-bound","signed-report-export","separate-raw-export","requester-metadata",
 "outside-consent-scope","separate-raw-export-authority-required","export-recipient-consent-required"] as const;
const disposition=z.object({subjectId:uuid.nullable(),kind:z.enum(ACCOUNT_CLASS_KINDS),sourceRows:count,exportRows:count,
 status:z.enum(["permitted","excluded"]),reason:z.enum(reasons),authoritySha256:hash}).strict();
const member=z.object({subjectId:uuid,member:z.enum(ACCOUNT_SUBJECT_MEMBERS),sourceRows:count,rows:count,membershipSha256:hash,
 status:z.enum(["permitted","excluded"]),reason:z.enum(reasons),authoritySha256:hash}).strict();
const history=z.object({kind:z.enum(ACCOUNT_HISTORY_KINDS),legacy:z.object({rows:count,membershipSha256:hash}).strict(),
 routed:membership,rows:count,membershipSha256:hash}).strict();
export const ACCOUNT_COMPLETE_FILE_KINDS=["variants","observed","canonical"] as const;
const fileContent=z.discriminatedUnion("backend",[
 z.object({backend:z.literal("database-v1"),receipts:z.array(z.object({kind:z.enum(ACCOUNT_COMPLETE_FILE_KINDS),rows:count,
  membershipSha256:hash}).strict()).length(3)}).strict(),
 z.object({backend:z.literal("prepared-object-v1"),source:publishedPreparedSourceSchema}).strict(),
]);
export const accountCompleteFileSchema=z.object({fileId:uuid,subjectId:uuid,originalName:z.string(),fileType:z.string(),
 sourceRevision:count.positive(),sizeBytes:count.positive(),rawSha256:hash,decodedSha256:hash,rawAuthoritySha256:hash,
 originalRetired:z.boolean(),content:fileContent}).strict();
const receipt=z.object({version:z.literal("account-complete-capture-receipt-v1"),captureSha256:hash,
 subjectCount:count.positive(),fileCount:count,classes:z.array(completeClass).length(ACCOUNT_CLASS_KINDS.length),
 members:z.array(member),history:z.array(history).length(ACCOUNT_HISTORY_KINDS.length),files:z.array(accountCompleteFileSchema)}).strict();
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const digest=(text:string)=>createHash("sha256").update(text,"utf8").digest("hex");
function validMembership(value:z.infer<typeof membership>,subjects:Set<string>){
 return new Set(value.partitions.map(p=>p.subjectId)).size===value.partitions.length
  &&value.partitions.every(p=>subjects.has(p.subjectId))
  &&value.partitions.reduce((n,p)=>n+p.rows,0)<=value.rows;
}
/** A native, consumed-account full frame. Compatibility subframes are genuine
 * subset receipts; neither caller labels nor analysis consent authorize raw
 * exports. Every class and selected subject has an explicit scoped disposition. */
export const accountCompleteContextSchema=z.object({version:z.literal("account-complete-members-v1"),targetKind:z.literal("account"),
 targetId:uuid,authorityReceipt:hash,deadline:z.iso.datetime({offset:true}),capturedAt:z.iso.datetime({offset:true}),
 actor:accountArchiveContextSchema.shape.actor,fileCount:count,partitions:z.array(scopePartition).min(1),
 legacyCapture:z.object({context:accountArchiveContextSchema,classes:accountClassInventorySchema,
  inventory:accountHistoryInventorySchema}).strict(),completeReceipt:receipt,dispositions:z.array(disposition)}).strict().superRefine((value,ctx)=>{
 const refuse=()=>ctx.addIssue({code:"custom",message:"account_complete_scope_unavailable"});
 const subjects=new Set(value.partitions.map(p=>p.subjectId)),files=value.partitions.flatMap(p=>p.fileIds);
 if(value.targetId!==value.actor.accountId||subjects.size!==value.partitions.length||new Set(files).size!==files.length
  ||files.length!==value.fileCount||value.partitions.some(p=>p.fileCount!==p.fileIds.length)
  ||value.completeReceipt.subjectCount!==subjects.size||value.completeReceipt.fileCount!==value.fileCount)refuse();
 const legacy=value.legacyCapture.context,expected=value.partitions.filter(p=>p.class!=="consent-covered");
 if(legacy.targetKind!=="account"||legacy.targetId!==value.targetId||!equal(legacy.actor,value.actor)
  ||legacy.authorityReceipt!==value.authorityReceipt||legacy.deadline!==value.deadline||legacy.capturedAt!==value.capturedAt
  ||!equal(legacy.partitions,expected)||legacy.fileCount!==expected.reduce((n,p)=>n+p.fileCount,0)
  ||value.legacyCapture.classes.authorityReceipt!==value.authorityReceipt
  ||value.legacyCapture.inventory.authorityReceipt!==value.authorityReceipt)refuse();
 const kinds=new Set(value.completeReceipt.classes.map(c=>c.kind));
 if(kinds.size!==ACCOUNT_CLASS_KINDS.length)refuse();
 const added=new Set(value.partitions.filter(p=>p.class==="consent-covered").map(p=>p.subjectId)),seenMembers=new Set<string>();
 const expectedFiles=new Map(value.partitions.filter(p=>p.class==="consent-covered").flatMap(p=>p.fileIds.map(id=>[id,p.subjectId] as const)));
 if(value.completeReceipt.files.length!==expectedFiles.size||new Set(value.completeReceipt.files.map(f=>f.fileId)).size!==expectedFiles.size)refuse();
 for(const file of value.completeReceipt.files){
  if(expectedFiles.get(file.fileId)!==file.subjectId)refuse();
  if(file.content.backend==="database-v1"){
   if(new Set(file.content.receipts.map(r=>r.kind)).size!==3)refuse();
   if(file.originalRetired||file.content.receipts.find(r=>r.kind==="canonical")?.rows!==0)refuse();
   for(const item of file.content.receipts)if(item.rows===0&&item.membershipSha256!==digest(`account-complete-file-v1|${file.fileId}|${item.kind}`))refuse();
  }else{
   const source=file.content.source;
   if(source.fileId!==file.fileId||source.subjectId!==file.subjectId||source.sourceRevision!==file.sourceRevision
    ||source.rawSha256!==file.rawSha256||source.decodedSha256!==file.decodedSha256)refuse();
  }
 }
 for(const item of value.completeReceipt.members){
  const key=`${item.subjectId}:${item.member}`;
  if(!added.has(item.subjectId)||seenMembers.has(key)||item.rows>item.sourceRows)refuse();seenMembers.add(key);
  if(item.status==="excluded"&&(item.rows!==0||!["outside-consent-scope","separate-raw-export-authority-required","export-recipient-consent-required"].includes(item.reason)))refuse();
  if(item.status==="permitted"&&!["signed-report-export","separate-raw-export","requester-metadata"].includes(item.reason))refuse();
  if(item.rows===0&&item.membershipSha256!==digest(`account-complete-member-v1|${item.subjectId}|${item.member}`))refuse();
 }
 if(seenMembers.size!==added.size*ACCOUNT_SUBJECT_MEMBERS.length)refuse();
 for(const subject of added)for(const name of ACCOUNT_SUBJECT_MEMBERS)if(!seenMembers.has(`${subject}:${name}`))refuse();
 if(new Set(value.completeReceipt.history.map(h=>h.kind)).size!==ACCOUNT_HISTORY_KINDS.length)refuse();
 for(const item of value.completeReceipt.history){
  const old=value.legacyCapture.inventory.classes.find(c=>c.kind===item.kind);
  if(!old||!equal(item.legacy,{rows:old.rows,membershipSha256:old.membershipSha256})
   ||item.rows!==item.legacy.rows+item.routed.rows||!validMembership(item.routed,subjects)
   ||item.routed.partitions.reduce((n,p)=>n+p.rows,0)!==item.routed.rows
   ||item.membershipSha256!==digest(`account-complete-history-v1|${item.kind}\n${item.legacy.rows}:${item.legacy.membershipSha256}\n${item.routed.rows}:${item.routed.membershipSha256}\n`)
   ||item.routed.rows===0&&item.routed.membershipSha256!==digest(`account-complete-history-routed-v1|${item.kind}`))refuse();
 }
 const seen=new Set<string>();
 for(const row of value.dispositions){
  const key=`${row.subjectId??"account"}:${row.kind}`;
  if(seen.has(key)||row.subjectId!==null&&!subjects.has(row.subjectId)||row.exportRows>row.sourceRows)refuse();seen.add(key);
  if(row.status==="excluded"&&(row.exportRows!==0||!["outside-consent-scope","separate-raw-export-authority-required","export-recipient-consent-required"].includes(row.reason)))refuse();
  if(row.status==="permitted"&&!["own-subject","claimed-bound","signed-report-export","separate-raw-export","requester-metadata"].includes(row.reason))refuse();
  if(row.kind==="embryo_variants"&&row.status==="permitted"
   &&!["own-subject","claimed-bound","separate-raw-export"].includes(row.reason))refuse();
 }
 for(const subject of subjects)for(const kind of ACCOUNT_CLASS_KINDS)if(!seen.has(`${subject}:${kind}`))refuse();
 for(const valueClass of value.completeReceipt.classes){
  const old=value.legacyCapture.classes.classes.find(c=>c.kind===valueClass.kind);
  // The retained excluded legacy receipt counts withheld sources, not payload
  // rows. Its complete hash still binds that census; export counts stay zero.
  const emittedLegacy=old?.mode==="excluded"?{rows:0,partitions:[]}:valueClass.legacy;
  if(!old||old.rows!==valueClass.legacy.rows||old.membershipSha256!==valueClass.legacy.membershipSha256
   ||!equal(old.partitions,valueClass.legacy.partitions)||valueClass.rows!==emittedLegacy.rows+valueClass.routed.rows
   ||![valueClass,valueClass.legacy,valueClass.routed].every(v=>validMembership(v,subjects)))refuse();
  const expectedHash=digest(`account-complete-class-v1|${valueClass.kind}\n${valueClass.legacy.rows}:${valueClass.legacy.membershipSha256}\n${valueClass.routed.rows}:${valueClass.routed.membershipSha256}\n`);
  if(valueClass.membershipSha256!==expectedHash)refuse();
  const total=value.dispositions.filter(d=>d.kind===valueClass.kind).reduce((n,d)=>n+d.exportRows,0);
  if(total!==valueClass.rows)refuse();
  const expectedSubjects=new Set([...emittedLegacy.partitions,...valueClass.routed.partitions].map(p=>p.subjectId));
  if(valueClass.partitions.length!==expectedSubjects.size||valueClass.partitions.some(p=>p.rows
   !==[...emittedLegacy.partitions,...valueClass.routed.partitions].filter(v=>v.subjectId===p.subjectId).reduce((n,v)=>n+v.rows,0)
   ||value.dispositions.find(d=>d.kind===valueClass.kind&&d.subjectId===p.subjectId)?.exportRows!==p.rows))refuse();
  if(valueClass.routed.rows===0&&valueClass.routed.membershipSha256!==digest(`account-complete-routed-v1|${valueClass.kind}`))refuse();
 }
});
export type AccountCompleteContext=z.infer<typeof accountCompleteContextSchema>;
export type AccountCompleteFile=z.infer<typeof accountCompleteFileSchema>;
