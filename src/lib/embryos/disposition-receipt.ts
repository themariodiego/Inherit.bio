import {z} from "zod";
import {calendarDate,closingDateWords,RECORD_KEY_PATTERN} from "./record-key-card-values";

const timestamp=z.iso.datetime({offset:true});
const card=z.object({recordKey:z.string().regex(RECORD_KEY_PATTERN),claimUrl:z.url().refine(value=>{
  const url=new URL(value);return ["https:","http:"].includes(url.protocol)&&url.pathname==="/future-person/claim"
    &&url.username===""&&url.password===""&&url.search===""&&url.hash==="";
}),
  closingDateWords:z.string(),closingDateIso:z.iso.date(),closingDateState:z.literal("definitive_transferred_claim_window")}).strict()
  .refine(value=>calendarDate(value.closingDateIso)!==null&&closingDateWords(value.closingDateIso)===value.closingDateWords);
const awaiting=z.object({status:z.literal("awaiting_other_parent"),proposalId:z.uuid(),expiresAt:timestamp}).strict();
const recorded=z.object({embryoId:z.uuid(),disposition:z.enum(["stored","donated","discarded"]),
  effectiveAt:timestamp,retentionExpiresAt:timestamp}).strict();
const transferred=z.object({embryoId:z.uuid(),disposition:z.literal("transferred"),effectiveAt:timestamp,retentionExpiresAt:timestamp,
  recordKeyDelivery:z.object({recipientSetRevision:z.number().int().positive(),
    callerState:z.enum(["delivered_inline","not_a_card_recipient"])}).strict(),recordKeyCard:card.nullable()}).strict()
  .refine(value=>(value.recordKeyDelivery.callerState==="delivered_inline")===(value.recordKeyCard!==null))
  .refine(value=>value.recordKeyCard===null||new Date(value.retentionExpiresAt).toISOString().slice(0,10)===value.recordKeyCard.closingDateIso);
export type EmbryoDispositionReceipt=z.infer<typeof awaiting>|z.infer<typeof recorded>|z.infer<typeof transferred>;
export type DispositionValue="stored"|"transferred"|"donated"|"discarded";

/** Require the actual complete registered receipt for the exact native action.
 * A crossed record/action, altered date or additional response field refuses. */
export function readEmbryoDispositionReceipt(status:number,value:unknown,expected:{embryoId:string;
  action:"propose"|"confirm"|"commit-single-authority";disposition:DispositionValue},now=Date.now()):EmbryoDispositionReceipt|null{
  if(status===202&&expected.action==="propose"){
    const parsed=awaiting.safeParse(value);return parsed.success&&Date.parse(parsed.data.expiresAt)>now?parsed.data:null;
  }
  if(status!==200||expected.action==="propose")return null;
  const parsed=z.union([recorded,transferred]).safeParse(value);
  return parsed.success&&parsed.data.embryoId===expected.embryoId&&parsed.data.disposition===expected.disposition?parsed.data:null;
}
