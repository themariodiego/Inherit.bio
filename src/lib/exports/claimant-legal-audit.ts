import "server-only";
import { z } from "zod";

/** Exact currently supported claimant action contracts. This reader neither
 * decodes an actor envelope nor infers an old event's subject. */
export const claimantAuditMetadata=z.object({attribution:z.enum(["assigned","unrecorded"]),
  attributionStartedAt:z.iso.datetime({offset:true}).nullable()}).strict()
  .refine(row=>(row.attribution==="assigned")===(row.attributionStartedAt!==null));
const event=z.object({seq:z.number().int().positive().safe(),occurred_at:z.iso.datetime({offset:true}),
  event_code:z.enum(["claimant.analysis_stopped","claimant.deletion_requested","claimant.deleted"]),
  route_id:z.enum(["api.future-person-analysis-stop","api.future-person-delete"]),
  outcome_code:z.enum(["accepted","purged"]),coded_context:z.object({}).strict()}).strict().refine(row=>
    row.event_code==="claimant.analysis_stopped"?row.route_id==="api.future-person-analysis-stop"&&row.outcome_code==="accepted":
    row.route_id==="api.future-person-delete"&&row.outcome_code===(row.event_code==="claimant.deleted"?"purged":"accepted"));
export const claimantAuditMember=z.object({id:z.string().regex(/^[1-9][0-9]{0,18}$/u),event}).strict()
  .refine(row=>row.id===String(row.event.seq));
