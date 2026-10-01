import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { decryptSecret } from "@/lib/crypto";
import { claimantAuditMetadata } from "./claimant-legal-audit";

const uuid=z.uuid(),hash=z.string().regex(/^[0-9a-f]{64}$/u),revision=z.number().int().positive().safe();
const date=z.string().datetime({offset:true});
const count=z.number().int().nonnegative().safe();
const id=z.string().regex(/^[1-9][0-9]{0,18}$/u).refine(value=>BigInt(value)<=BigInt("9223372036854775807"));
export const futurePersonExportSnapshot=z.object({
  authority:z.object({principalId:uuid,subjectId:uuid,originBinding:hash,authorityReceipt:hash,
    lifecycleRevision:revision,bindingRevision:revision,credentialRevision:revision,expiresAt:date}).strict(),
  source:z.object({fileId:uuid,subjectId:uuid,referenceBuild:z.enum(["GRCh37","GRCh38"]),sourceSha256:hash,
    membershipSha256:hash,publicationRevision:revision,variantCount:count,publishedAt:date}).strict(),
  membership:z.object({variants:count,qualityReports:count,scores:count,figures:count,reports:count,agreements:count,legalAuditEvents:count}).strict(),
  legalAudit:claimantAuditMetadata,
}).strict().refine(value=>value.authority.subjectId===value.source.subjectId&&value.source.variantCount===value.membership.variants)
  .refine(value=>value.legalAudit.attribution!=="unrecorded"||value.membership.legalAuditEvents===0);
export type FuturePersonExportSnapshot=z.infer<typeof futurePersonExportSnapshot>;
const attestation=z.object({kind:z.enum(["own_embryo","genetic_parent","parents_permission","jurisdiction",
  "single_parent_authority","adult_control","future_person_acknowledgement","disposition_rights"]),statementKeys:z.array(z.string().min(1)).min(1),
  affirmed:z.literal(true),revision,affirmedAt:date}).strict();
const agreement=z.object({version:z.literal("future-person-agreement-v2"),
  artifactKey:z.enum(["consent.upload-embryo","charter.future-person","attestation.embryo-parentage",
    "attestation.embryo-disposition-rights","attestation.embryo-single-parent-basis","disclosure.insurance-and-discrimination"]),artifactVersion:revision,
  bodySha256:hash,bodyMarkdown:z.string().min(1),recomputedBodySha256:hash,statementKeys:z.array(z.string().min(1)).min(1),
  signedAt:date,signaturePurpose:z.string().min(1),recordedRole:z.enum(["parent","uploader","owner"]),signingNameCiphertext:z.string().min(58).max(4096).regex(/^(?:[0-9a-f]{2})+$/u),
  signaturePrincipalPseudonym:hash,jurisdictionCode:z.string().regex(/^[A-Z]{2}$/u),jurisdictionRevision:revision,
  attestations:z.array(attestation),review:z.object({kind:z.enum(["approve-record-key","approve-keyless","approve-release"]),decidedAt:date,
    outcome:z.literal("approved"),reviewerPrincipalPseudonym:hash}).strict(),
}).strict();
const variant=z.object({id,chromosome:z.number().int().min(1).max(22),position:z.number().int().positive().safe(),
  referenceAllele:z.string().nullable(),alternateAllele:z.string().nullable(),genotype:z.string()}).strict();
const variantPage=z.object({rows:z.array(variant).max(500),nextAfterId:id.nullable(),count:z.number().int().min(0).max(500)}).strict();
const unavailable=()=>new Error("export unavailable");
export type FuturePersonExportRpc=(name:"future_person_export_source_v1",args:{p_operation:"capture"|"variants"|"agreements";
  p_session_hash:string;p_authority_receipt:string|null;p_after_variant_id:string|null},signal:AbortSignal)=>PromiseLike<{data:unknown;error:unknown}>;

/** Only genuine earlier signed ciphertext is decoded. No profile, document,
 * current parent permission or mutable claimant identity is accepted here. */
export function projectFuturePersonAgreements(value:unknown) {
  const parsed=z.array(agreement).min(2).safeParse(value);
  if(!parsed.success||!parsed.data.some(row=>row.artifactKey==="consent.upload-embryo")||!parsed.data.some(row=>row.artifactKey==="charter.future-person"))throw unavailable();
  return parsed.data.map(row=>{
    const roles:Record<string,string>={"embryo-upload-parent-class":"parent","embryo-upload-uploader-class":"uploader",
      "embryo-parentage-attestation":"parent","embryo-disposition-rights-attestation":"parent","embryo-single-parent-basis-attestation":"parent",
      "future-person-charter-acknowledgement":"owner","disclosure-acknowledgement":"owner"};
    const artifactPurposes:Record<string,readonly string[]>={"consent.upload-embryo":["embryo-upload-parent-class","embryo-upload-uploader-class"],
      "attestation.embryo-parentage":["embryo-parentage-attestation"],"attestation.embryo-disposition-rights":["embryo-disposition-rights-attestation"],
      "attestation.embryo-single-parent-basis":["embryo-single-parent-basis-attestation"],"charter.future-person":["future-person-charter-acknowledgement"],
      "disclosure.insurance-and-discrimination":["disclosure-acknowledgement"]};
    if(!artifactPurposes[row.artifactKey].includes(row.signaturePurpose)||roles[row.signaturePurpose]!==row.recordedRole||((row.artifactKey.startsWith("attestation.")||row.artifactKey==="charter.future-person")&&!row.attestations.length))throw unavailable();
    const bodyHash=createHash("sha256").update(row.bodyMarkdown,"utf8").digest("hex");
    if(bodyHash!==row.bodySha256||bodyHash!==row.recomputedBodySha256)throw unavailable();
    const cipher=Buffer.from(row.signingNameCiphertext,"hex");let signingName:string;
    try{signingName=decryptSecret(cipher);}catch{throw unavailable();}finally{cipher.fill(0);}
    if(!signingName.trim()||Buffer.byteLength(signingName,"utf8")>1024)throw unavailable();
    return {artifactKey:row.artifactKey,artifactVersion:row.artifactVersion,bodySha256:bodyHash,bodyMarkdown:row.bodyMarkdown,
      statementKeys:row.statementKeys,signedAt:row.signedAt,signingName,signaturePurpose:row.signaturePurpose,recordedRole:row.recordedRole,signaturePrincipalPseudonym:row.signaturePrincipalPseudonym,
      jurisdiction:{code:row.jurisdictionCode,revision:row.jurisdictionRevision},
      recordedRoleKinds:[...new Set(row.attestations.map(item=>item.kind))],attestations:row.attestations,review:row.review};
  });
}

/** Read-only source prerequisite, not an export capability or complete archive.
 * Every page rechecks the exact source receipt and live claimant session. The
 * producer must still include every captured report/figure and prove ZIP EOF. */
export function futurePersonExportContent(rpc:FuturePersonExportRpc,sessionHash:string,options:{signal:AbortSignal;deadline:number}) {
  if(!/^[0-9a-f]{64}$/u.test(sessionHash)||!Number.isSafeInteger(options.deadline)||options.deadline<=Date.now())throw unavailable();
  let snapshot:FuturePersonExportSnapshot|null=null;
  function active(){if(options.signal.aborted||Date.now()>=options.deadline)throw unavailable();}
  async function call(operation:"capture"|"variants"|"agreements",after:string|null=null) {
    active();const controller=new AbortController();const signal=AbortSignal.any([options.signal,controller.signal]);
    let rejectAbort:()=>void=()=>{};
    const interrupted=new Promise<never>((_,reject)=>{rejectAbort=()=>reject(unavailable());signal.addEventListener("abort",rejectAbort,{once:true});});
    const timer=setTimeout(()=>controller.abort(),Math.min(30_000,options.deadline-Date.now()));timer.unref();
    try{
      const result=await Promise.race([Promise.resolve().then(()=>{
        active();if(signal.aborted)throw unavailable();
        return rpc("future_person_export_source_v1",{p_operation:operation,p_session_hash:sessionHash,
          p_authority_receipt:operation==="capture"?null:snapshot!.authority.authorityReceipt,p_after_variant_id:after},signal);
      }),interrupted]);
      active();if(signal.aborted||result.error)throw unavailable();return result.data;
    }catch{throw unavailable();}finally{clearTimeout(timer);signal.removeEventListener("abort",rejectAbort);controller.abort();}
  }
  async function check(){
    if(!snapshot)throw unavailable();const parsed=futurePersonExportSnapshot.safeParse(await call("capture"));
    if(!parsed.success||JSON.stringify(parsed.data)!==JSON.stringify(snapshot)||Date.parse(snapshot.authority.expiresAt)<=Date.now())throw unavailable();
  }
  return {
    async capture(){
      if(snapshot)throw unavailable();const parsed=futurePersonExportSnapshot.safeParse(await call("capture"));
      if(!parsed.success||Date.parse(parsed.data.authority.expiresAt)<=Date.now())throw unavailable();
      snapshot=parsed.data;return structuredClone(snapshot);
    },check,
    async agreements(){
      await check();const rows=projectFuturePersonAgreements(await call("agreements"));
      if(rows.length!==snapshot!.membership.agreements)throw unavailable();await check();return rows;
    },
    async *variants(){
      await check();let after:string|null=null;let rows=0;
      for(;;){
        const parsed=variantPage.safeParse(await call("variants",after));if(!parsed.success)throw unavailable();
        const page=parsed.data;
        if(page.count!==page.rows.length||page.nextAfterId!==(page.rows.at(-1)?.id??null))throw unavailable();
        let previous=after===null?BigInt(0):BigInt(after);
        for(const row of page.rows){if(BigInt(row.id)<=previous)throw unavailable();previous=BigInt(row.id);}
        rows+=page.count;if(rows>snapshot!.source.variantCount)throw unavailable();
        await check();
        if(!page.count){if(rows!==snapshot!.source.variantCount)throw unavailable();return;}
        yield page.rows;after=page.nextAfterId;
      }
    },
  };
}

/** Human and scientific formats share the same verified historical projection. */
export function renderFuturePersonAgreement(value:ReturnType<typeof projectFuturePersonAgreements>[number]) {
  return [`Agreement: ${value.artifactKey} version ${value.artifactVersion}`,`Signed by: ${value.signingName}`,
    `Signed at: ${value.signedAt}`,`Recorded role: ${value.recordedRole}`,`Recorded attestations: ${value.recordedRoleKinds.join(", ")}`,
    `Jurisdiction at signing: ${value.jurisdiction.code} revision ${value.jurisdiction.revision}`,
    `Signed body SHA-256: ${value.bodySha256}`,`Individually affirmed statements: ${value.statementKeys.join(", ")}`,
    ...value.attestations.map(row=>`Attestation: ${row.kind}; ${row.statementKeys.join(", ")}; affirmed at ${row.affirmedAt}; revision ${row.revision}`),
    `Recorded review: ${value.review.kind}; ${value.review.outcome}; ${value.review.decidedAt}`,"",value.bodyMarkdown].join("\n");
}
