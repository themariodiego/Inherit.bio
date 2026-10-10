import "server-only";
import {z} from "zod";
import {newWrappedCaseKey,unwrapNewCaseKey,sealNewCaseBytes,openNewCaseBytes,newCaseHmac} from "./new-case-envelope-crypto";

/** Registered NEW appeal grammar. A parser never supplies ownership, a target,
 * a reviewer, a native source receipt, an original clock or an approval. */
export const appealIntakeKind=z.enum(["subject-objection","genetic-parent-objection","access-or-review-appeal","contradiction-suspension-appeal"]);
const controls=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
function prose(minimum:number,maximum:number){return z.string().max(maximum*4).transform(value=>value.normalize("NFC").trim())
 .refine(value=>[...value].length>=minimum&&[...value].length<=maximum&&!controls.test(value));}
const name=prose(2,120),reference=prose(0,120),statement=prose(20,4000);
const contact=z.string().max(1024).transform(value=>value.trim().toLowerCase()).pipe(z.email())
 .refine(value=>Buffer.byteLength(value,"utf8")<=254);
const common={claimantName:name,statement,affirmed:z.literal(true)};
export const appealIntakeBody=z.discriminatedUnion("kind",[
 z.object({...common,kind:z.literal("subject-objection"),contactEmail:contact,subjectReference:reference.optional()}).strict(),
 z.object({...common,kind:z.literal("genetic-parent-objection"),contactEmail:contact,cohortReference:reference.optional()}).strict(),
 z.object({...common,kind:z.literal("access-or-review-appeal"),contactEmail:contact,decisionReference:reference.optional()}).strict(),
 z.object({...common,kind:z.literal("contradiction-suspension-appeal"),
  suspensionNoticeReference:z.string().regex(/^[A-Za-z0-9_-]{16,256}$/u),nonce:z.string().min(1).max(2048)}).strict(),
]);
export type AppealIntakeBody=z.infer<typeof appealIntakeBody>;
const clock=z.iso.datetime({offset:true});
export const appealCaseScope=z.object({version:z.literal(1),caseKind:z.literal("appeal"),caseId:z.uuid(),originalAuthorPrincipalId:z.uuid(),
 initialStatementRevision:z.literal(1),originalSubmittedAt:clock,originalDeadline:clock,intakeKind:appealIntakeKind}).strict();
export type AppealCaseScope=z.infer<typeof appealCaseScope>;
export function appealStatementAad(raw:unknown){const scope=appealCaseScope.parse(raw);
 return JSON.stringify(["reviewer-only-case-statement-v1",scope.version,scope.caseKind,scope.intakeKind,scope.caseId,
  scope.originalAuthorPrincipalId,scope.initialStatementRevision,scope.originalSubmittedAt,scope.originalDeadline,null]);}
const packageAad=(scope:AppealCaseScope)=>JSON.stringify(["reviewer-only-appeal-working-package-v1",appealStatementAad(scope)]);
const contactAad=(scope:AppealCaseScope)=>JSON.stringify(["reviewer-only-appeal-delivery-contact-v1",appealStatementAad(scope)]);
// The server supplies the suspension branch's verified recipient. No request
// field can select it; the binding must be rechecked by the native commit.
const workingIntake=z.discriminatedUnion("kind",[appealIntakeBody.options[0],appealIntakeBody.options[1],appealIntakeBody.options[2],
 appealIntakeBody.options[3].omit({nonce:true})]);
const packageFields=z.object({version:z.literal(1),intake:workingIntake,recipient:contact}).strict();
const octets=z.string().regex(/^(?:[0-9a-f]{2})+$/u);
export const sealedAppealCase=z.object({format:z.literal("reviewer-only-case-statement-v1"),wrappedCaseKeyHex:octets.length(144),
 statementCiphertextHex:octets.min(96).max(32056),workingCiphertextHex:octets.min(96).max(41056),
 contactCiphertextHex:octets.min(58).max(564)}).strict();
export const sealedAppealOwnStatement=sealedAppealCase.pick({format:true,wrappedCaseKeyHex:true,statementCiphertextHex:true});
function sealHex(key:Buffer,aad:string,bytes:Uint8Array){const sealed=sealNewCaseBytes(key,aad,bytes);
 try{return sealed.toString("hex");}finally{sealed.fill(0);}}
function openHex(key:Buffer,aad:string,hex:string){const sealed=Buffer.from(hex,"hex");
 try{return openNewCaseBytes(key,aad,sealed);}finally{sealed.fill(0);}}

/** Scope and suspension recipient must originate from the exact native branch
 * prepare. This function encrypts them; it is not an authority issuer. */
export function sealNewAppeal(rawScope:unknown,rawIntake:unknown,verifiedRecipient?:string){
 const scope=appealCaseScope.parse(rawScope),intake=appealIntakeBody.parse(rawIntake);
 if(scope.intakeKind!==intake.kind)throw new Error("appeal_unavailable");
 const recipient=intake.kind==="contradiction-suspension-appeal"?contact.parse(verifiedRecipient):intake.contactEmail;
 let wrapped:Buffer|undefined,key:Buffer|undefined,text:Buffer|undefined,working:Buffer|undefined,mail:Buffer|undefined;
 try{
  wrapped=newWrappedCaseKey();key=unwrapNewCaseKey(wrapped.toString("hex"));text=Buffer.from(intake.statement,"utf8");
  // A consumed operation nonce is never copied into durable working data.
  const reviewIntake=intake.kind==="contradiction-suspension-appeal"?{kind:intake.kind,claimantName:intake.claimantName,
   statement:intake.statement,affirmed:intake.affirmed,suspensionNoticeReference:intake.suspensionNoticeReference}:intake;
  working=Buffer.from(JSON.stringify(packageFields.parse({version:1,intake:reviewIntake,recipient})),"utf8");mail=Buffer.from(recipient,"utf8");
  return sealedAppealCase.parse({format:"reviewer-only-case-statement-v1",wrappedCaseKeyHex:wrapped.toString("hex"),
   statementCiphertextHex:sealHex(key,appealStatementAad(scope),text),workingCiphertextHex:sealHex(key,packageAad(scope),working),
   contactCiphertextHex:sealHex(key,contactAad(scope),mail)});
 }finally{wrapped?.fill(0);key?.fill(0);text?.fill(0);working?.fill(0);mail?.fill(0);}
}
function opened(scope:AppealCaseScope,envelope:z.infer<typeof sealedAppealCase>){
 let key:Buffer|undefined,text:Buffer|null=null,working:Buffer|null=null,mail:Buffer|null=null;
 try{
  key=unwrapNewCaseKey(envelope.wrappedCaseKeyHex);text=openHex(key,appealStatementAad(scope),envelope.statementCiphertextHex);
  working=openHex(key,packageAad(scope),envelope.workingCiphertextHex);mail=openHex(key,contactAad(scope),envelope.contactCiphertextHex);
  if(!text||!working||!mail)return null;const decode=new TextDecoder("utf8",{fatal:true});
  const rawStatement=decode.decode(text),rawWorking=decode.decode(working),rawMail=decode.decode(mail);
  const fields=packageFields.safeParse(JSON.parse(rawWorking));if(!fields.success||fields.data.intake.kind!==scope.intakeKind
   ||fields.data.intake.statement!==rawStatement||fields.data.recipient!==rawMail)return null;
  // Refuse normalization during opening: persisted input must already have the
  // exact producer representation, including the complete closed key set.
  if(JSON.stringify(fields.data)!==rawWorking)return null;return fields.data;
 }catch{return null;}finally{key?.fill(0);text?.fill(0);working?.fill(0);mail?.fill(0);}
}
/** Internal full package, only after the assigned own-JWT audited native read
 * and currentness check. No service, requester or public endpoint may call it
 * as an authority shortcut. Caller rechecks before serialization. */
export function openNewAppealForReviewer(rawScope:unknown,rawEnvelope:unknown){
 const scope=appealCaseScope.safeParse(rawScope),envelope=sealedAppealCase.safeParse(rawEnvelope);
 return scope.success&&envelope.success?opened(scope.data,envelope.data):null;
}
/** Own-statement DTO only after the exact current case-credential/account
 * ownership native door. Foreign data, delivery contact and notes are excluded.
 * Parsing valid ciphertext or a case ID alone never establishes ownership. */
export function openNewAppealOwnStatement(rawScope:unknown,rawEnvelope:unknown){
 const scope=appealCaseScope.safeParse(rawScope),envelope=sealedAppealOwnStatement.safeParse(rawEnvelope);
 if(!scope.success||!envelope.success)return null;let key:Buffer|undefined,text:Buffer|null=null;
 try{
  key=unwrapNewCaseKey(envelope.data.wrappedCaseKeyHex);text=openHex(key,appealStatementAad(scope.data),envelope.data.statementCiphertextHex);
  if(!text)return null;const raw=new TextDecoder("utf8",{fatal:true}).decode(text),valid=statement.safeParse(raw);
  return valid.success&&valid.data===raw?{appealId:scope.data.caseId,statement:valid.data}:null;
 }catch{return null;}finally{key?.fill(0);text?.fill(0);}
}
export function appealIntakeDigest(raw:unknown){const intake=appealIntakeBody.parse(raw);
 return newCaseHmac(JSON.stringify(intake),"new-appeal-intake-payload-v1");}

/** Dedicated delivery-contact projection, only after the owner worker's exact
 * current native claimed-outbox/attempt read. It cannot open review working
 * data or create account authority. All mutable key/contact copies are zeroed.
 * The caller must recheck native submission authority immediately before send. */
export function openNewAppealDeliveryContact(rawScope:unknown,wrappedHex:string,contactHex:string){
 const scope=appealCaseScope.parse(rawScope);
 if(scope.intakeKind==="contradiction-suspension-appeal"||!/^[0-9a-f]{144}$/u.test(wrappedHex)
  ||!/^(?:[0-9a-f]{2}){29,282}$/u.test(contactHex))throw new Error("appeal_mail_unavailable");
 let key:Buffer|undefined,bytes:Buffer|null=null;
 try{
  key=unwrapNewCaseKey(wrappedHex);bytes=openHex(key,contactAad(scope),contactHex);
  if(!bytes)throw new Error("appeal_mail_unavailable");
  const raw=new TextDecoder("utf8",{fatal:true}).decode(bytes),parsed=contact.parse(raw);
  if(parsed!==raw)throw new Error("appeal_mail_unavailable");return parsed;
 }finally{key?.fill(0);bytes?.fill(0);}
}
