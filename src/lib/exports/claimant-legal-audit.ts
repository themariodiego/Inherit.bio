import "server-only";
import { z } from "zod";

/** Exact currently supported claimant action contracts. This reader neither
 * decodes an actor envelope nor infers an old event's subject. */
export const claimantAuditMetadata=z.object({attribution:z.enum(["assigned","unrecorded"]),
  attributionStartedAt:z.iso.datetime({offset:true}).nullable()}).strict()
  .refine(row=>(row.attribution==="assigned")===(row.attributionStartedAt!==null));
const common={seq:z.number().int().positive().safe(),occurred_at:z.iso.datetime({offset:true})};
const event=z.union([
 z.object({...common,event_code:z.literal("claimant.analysis_stopped"),route_id:z.literal("api.future-person-analysis-stop"),
  outcome_code:z.literal("accepted"),coded_context:z.object({}).strict()}).strict(),
 z.object({...common,event_code:z.literal("claimant.deletion_requested"),route_id:z.literal("api.future-person-delete"),
  outcome_code:z.literal("accepted"),coded_context:z.object({}).strict()}).strict(),
 z.object({...common,event_code:z.literal("claimant.deleted"),route_id:z.literal("api.future-person-delete"),
  outcome_code:z.literal("purged"),coded_context:z.object({}).strict()}).strict(),
 z.object({...common,event_code:z.literal("claim.resolved"),route_id:z.literal("api.future-person-claim-release"),
  outcome_code:z.literal("accepted"),coded_context:z.object({outcome:z.literal("approved")}).strict()}).strict(),
]);
export const claimantAuditMember=z.object({id:z.string().regex(/^[1-9][0-9]{0,18}$/u),event}).strict()
  .refine(row=>row.id===String(row.event.seq));
