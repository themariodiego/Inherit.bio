import "server-only";
import crypto from "node:crypto";
import {z} from "zod";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {networkBucketDigests} from "@/lib/rate-limit-keys";
import {appealIntakeJson,appealIntakeNotFound as notFound} from "./appeal-intake-response";
import {testAppealIntakeOpen} from "./appeals-open";
import {readAppealForm} from "./appeal-form";
import {readAppealIntakeJson} from "./appeal-intake-json";
import {createAppealIntakeRuntime,type AppealIntakeRuntime} from "./appeal-intake-runtime";
import {appealIntakeBody,appealCaseScope,appealIntakeDigest,sealNewAppeal} from "./appeal-case-envelope";
import {appealKeyedDigests} from "./appeal-keyed-digests";
const digest=z.string().regex(/^[0-9a-f]{64}$/u),digests=z.record(z.string().regex(/^[1-9][0-9]{0,5}$/u),digest);
const prepared=z.object({frame:z.object({version:z.literal("new-appeal-public-intake-native-v1"),scope:appealCaseScope,
 reviewer:z.object({principalId:z.uuid(),principalRevision:z.number().int().positive().safe(),purposeRevision:z.number().int().positive().safe()}).strict(),
 assignmentRevision:z.literal(1),prepareExpiresAt:z.iso.datetime({offset:true}),caseContactId:z.uuid(),payloadDigest:digest,formNonceHash:digest,
 contactDigests:digests,identifierDigests:digests,networkDigests:digests,underlyingDecision:z.object({decisionId:z.uuid(),sourceCaseId:z.uuid(),decisionRevision:z.number().int().positive().safe(),
  evidenceRevision:z.number().int().positive().safe(),sourceReviewerPrincipalId:z.uuid(),decisionReferenceHash:digest,requiredAuthorityKind:z.enum(["appeal-subject-source-control","appeal-genetic-parent-authority"]),
  decisionKind:z.enum(["subject-source-control-review-rejection","genetic-parent-authority-review-rejection"]),sourceDeadline:z.iso.datetime({offset:true})}).strict().optional()}).strict(),signature:digest}).strict();
const generic=()=>appealIntakeJson({status:"received"},202);
/** Runtime qualification must prove the whole public timing envelope. The
 * minimum suppresses a quick local lookup distinction but is not that proof. */
async function genericAfter(owner:AppealIntakeRuntime){await owner.minimumResponseDelay();return generic();}
export async function postNewAppeal(request:Request){
 if(!testAppealIntakeOpen())return notFound();
 const form=readAppealForm(request);if(!form)return notFound();
 const owner=createAppealIntakeRuntime(request.signal);
 try{return await postOwnedAppeal(request,form.nonceHash,owner);}finally{await owner.finish();}
}
async function postOwnedAppeal(request:Request,nonceHash:string,owner:AppealIntakeRuntime){
 let body:unknown;
 try{body=await readAppealIntakeJson(request,owner);}catch{return notFound();}
 const parsed=appealIntakeBody.safeParse(body);if(!parsed.success)return appealIntakeJson({error:"invalid_request",issues:["request"]},422);
 const intake=parsed.data;
 if(intake.kind==="contradiction-suspension-appeal"){
  // Use the caller's own JWT. Never call the authenticated native branch with
  // an admin client or accept an account/contact/contradiction ID from JSON.
  try{const own=await owner.wait(owner.read(()=>createClient()));
   const {error}=await owner.wait(owner.rpc("suspension-prepare",()=>own.rpc("prepare_new_suspension_appeal_v1",{
   p_notice_hash:crypto.createHash("sha256").update(intake.suspensionNoticeReference,"utf8").digest("hex"),
   p_nonce:intake.nonce,p_payload_digest:appealIntakeDigest(intake)}).retry(false).abortSignal(owner.signal)));if(error)return notFound();}
  catch{return notFound();}
  // No origin was bound by this source packet. Never silently route this body
  // through the three public branches or create a generic suspension case.
  return notFound();
 }
 let wrapped:Buffer|undefined,statement:Buffer|undefined,working:Buffer|undefined,contact:Buffer|undefined;
 try{
  owner.assertOpen();
  const client=createAdminClient(),payloadDigest=appealIntakeDigest(intake),contactSet=appealKeyedDigests("contact",intake.contactEmail);
  const identifierSet=appealKeyedDigests("rate-limit",`api.subject-access-request|normalized-identifier|${intake.contactEmail}`);
  const networkSet=networkBucketDigests("api.subject-access-request",request.headers);
  const {data,error}=await owner.wait(owner.rpc("public-prepare",()=>client.rpc("prepare_new_public_appeal_v1",{p_kind:intake.kind,p_payload_digest:payloadDigest,
   p_form_nonce_hash:nonceHash,p_contact_digests:contactSet,p_identifier_digests:identifierSet,p_network_digests:networkSet,
   ...(intake.kind==="access-or-review-appeal"?{p_decision_reference_hash:intake.decisionReference?crypto.createHash("sha256").update(intake.decisionReference,"utf8").digest("hex"):null}:{})}).retry(false).abortSignal(owner.signal)));
  const preparation=prepared.safeParse(data);if(error||!preparation.success)return genericAfter(owner);
  const frame=preparation.data;if(frame.frame.scope.intakeKind!==intake.kind||frame.frame.payloadDigest!==payloadDigest
   ||frame.frame.formNonceHash!==nonceHash
   ||(intake.kind==="access-or-review-appeal")!==Boolean(frame.frame.underlyingDecision))return genericAfter(owner);
  const underlying=frame.frame.underlyingDecision;
  if(underlying && (intake.kind!=="access-or-review-appeal" || !intake.decisionReference
   || underlying.decisionReferenceHash!==crypto.createHash("sha256").update(intake.decisionReference,"utf8").digest("hex")
   || underlying.sourceReviewerPrincipalId===frame.frame.reviewer.principalId
   || Date.parse(underlying.sourceDeadline)<=Date.now()
   || (underlying.requiredAuthorityKind==="appeal-subject-source-control")!==(underlying.decisionKind==="subject-source-control-review-rejection")))return genericAfter(owner);
  owner.assertOpen();
  const envelope=sealNewAppeal(frame.frame.scope,intake);
  wrapped=owner.own(Buffer.from(envelope.wrappedCaseKeyHex,"hex"));statement=owner.own(Buffer.from(envelope.statementCiphertextHex,"hex"));
  working=owner.own(Buffer.from(envelope.workingCiphertextHex,"hex"));contact=owner.own(Buffer.from(envelope.contactCiphertextHex,"hex"));
  const keys:Record<string,Record<string,string>>={};const global=crypto.createHash("sha256").update("api.subject-access-request|global-capacity","utf8").digest("hex");
  for(const revision of Object.keys(frame.frame.identifierDigests))keys[revision]={"normalized-identifier":frame.frame.identifierDigests[revision]!,
   "source-network":frame.frame.networkDigests[revision]!,"global-capacity":global};
  await owner.wait(owner.rpc("public-commit",()=>client.rpc("commit_new_public_appeal_v1",{p_expected:frame,p_payload_digest:payloadDigest,p_nonce_hash:nonceHash,
   p_wrapped_key:`\\x${wrapped!.toString("hex")}`,p_statement:`\\x${statement!.toString("hex")}`,
   p_working:`\\x${working!.toString("hex")}`,p_contact:`\\x${contact!.toString("hex")}`,p_quota_keys:keys}).retry(false).abortSignal(owner.signal)));
  // The return/error/capacity state is not public observability. No diagnostics,
  // logger, third-party error capture, target or case ID receives this content.
 }catch{}finally{for(const bytes of [wrapped,statement,working,contact])if(bytes)owner.clear(bytes);}
 return genericAfter(owner);
}
