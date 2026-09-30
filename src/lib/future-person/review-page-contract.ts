import {z} from "zod";

const refusal=z.array(z.enum(["reject","needs-more-information"])).min(1).max(2);
const caseBody=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("record_key"),recordSelector:z.object({matched:z.literal(true)}).strict(),
    recordedParentLink:z.object({evidencedParentRoles:z.array(z.enum(["genetic-parent","legal-parent","gestational-parent","intended-parent"])).min(1).max(4),
      recordedParentNames:z.array(z.string().min(1).max(120)).min(1).max(4)}).strict()}).strict(),
  z.object({kind:z.literal("claimant_recovery_key"),recoverySelector:z.object({matched:z.literal(true)}).strict(),
    claimantBinding:z.object({lifecycle:z.literal("claimed_unbound"),identityHmacComparison:z.literal("pending_human_verified_document_tuple")}).strict()}).strict(),
  z.object({kind:z.enum(["record_key_unmatched_or_ineligible","recovery_key_unmatched_or_ineligible"]),
    selectorOutcome:z.literal("non_enumerating_unmatched_or_ineligible"),allowedDecisions:refusal}).strict(),
  z.object({kind:z.enum(["keyless_none","keyless_ambiguous"]),selectorOutcome:z.literal("no_unique_candidate"),allowedDecisions:refusal}).strict(),
]);
export const reviewPageCase=z.object({claimId:z.uuid(),mode:z.enum(["record-key","claimant-recovery-key","keyless"]),
  state:z.enum(["document_review_pending","more_information_required"]),reviewRevision:z.number().int().positive(),deadline:z.iso.datetime(),
  claimant:z.object({fullName:z.string().min(2).max(480),dateOfBirth:z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)}).strict(),
  evidence:z.object({photoIdentityDocumentId:z.uuid(),birthRecordDocumentId:z.uuid()}).strict(),case:caseBody,
  notice:z.object({state:z.literal("not_applicable"),noticeRevision:z.null()}).strict(),
}).strict().superRefine((value,context)=>{
  const expected=value.case.kind.startsWith("record_key")?"record-key":
    value.case.kind==="claimant_recovery_key"||value.case.kind==="recovery_key_unmatched_or_ineligible"?"claimant-recovery-key":"keyless";
  if(value.mode!==expected||value.evidence.photoIdentityDocumentId===value.evidence.birthRecordDocumentId)
    context.addIssue({code:"custom",message:"claim review unavailable"});
});
export type ReviewPageCase=z.infer<typeof reviewPageCase>;
export type ReviewDecision="reject"|"needs-more-information"|"approve-record-key";
/** Only the actually implemented attested release branch is offered. */
export function reviewPageDecisions(value:ReviewPageCase):ReviewDecision[] {
  return value.case.kind==="record_key"?["reject","needs-more-information","approve-record-key"]:["reject","needs-more-information"];
}
