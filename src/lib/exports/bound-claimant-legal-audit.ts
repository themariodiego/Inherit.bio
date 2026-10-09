import "server-only";
import {z} from "zod";
import {claimantAuditMember} from "./claimant-legal-audit";
/** A distinct exact newly issued binding action; original independent-rights
 * event schema remains closed and refuses this tuple. No legacy actor inference. */
const boundEvent=z.object({seq:z.number().int().positive().safe(),occurred_at:z.iso.datetime({offset:true}),
 event_code:z.literal("claimant.account_bound"),route_id:z.literal("api.future-person-claimant-bind"),
 outcome_code:z.literal("accepted"),coded_context:z.object({}).strict()}).strict();
const bindingMember=z.object({id:z.string().regex(/^[1-9][0-9]{0,18}$/u),event:boundEvent}).strict()
 .refine(row=>row.id===String(row.event.seq));
export const boundClaimantAuditMember=z.union([claimantAuditMember,bindingMember]);
