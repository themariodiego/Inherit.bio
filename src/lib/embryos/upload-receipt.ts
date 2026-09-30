import { z } from "zod";
import { EMBRYO_INGEST_SESSION_LIMITS as LIMITS, INGEST_CHUNK_MAXIMUM_BYTES } from "@/lib/genome/ingest-limits";
import { closingDateWords, RECORD_KEY_PATTERN } from "./record-key-cards";
import { readUploadSession } from "./upload-transport";

const card = z.object({ embryo_id: z.uuid(), display_label: z.string().regex(/^Embryo [1-9][0-9]?$/),
  record_key: z.string().regex(RECORD_KEY_PATTERN), claim_url: z.url(), closing_date_words: z.string(), closing_date_iso: z.iso.date(),
  closing_date_state: z.enum(["provisional_until_terminal_ordinal_resolution", "definitive_stored_or_unknown", "definitive_transferred_claim_window"]),
  date_revision: z.number().int().positive(),
}).strict().refine(value => value.closing_date_words === closingDateWords(value.closing_date_iso));
const receipt = z.object({
  cohort_id: z.uuid(), status: z.literal("upload_ready"), embryo_count: z.number().int().min(2).max(64),
  upload_session: z.object({ transport: z.literal("embryo-chunks"), uploadId: z.uuid(), session: z.uuid(),
    chunkBytes: z.literal(INGEST_CHUNK_MAXIMUM_BYTES), maximumChunks: z.literal(LIMITS.maximumChunks),
    maximumInputBytes: z.literal(LIMITS.maximumUncompressedInputBytes),
    sampleHandles: z.array(z.object({ ordinal: z.number().int().nonnegative(), handle: z.string() }).strict()),
    expiresAt: z.iso.datetime({ offset: true }), operationNonce: z.string().min(1), configureRoute: z.string(), chunkRoute: z.string(), completeRoute: z.string(),
  }).strict(),
  record_key_delivery: z.object({ recipient_set_revision: z.number().int().nonnegative(), caller_state: z.enum(["delivered_inline", "not_a_card_recipient"]) }).strict(),
  record_key_cards: z.array(card),
}).strict().superRefine((value, context) => {
  if (value.upload_session.sampleHandles.length !== value.embryo_count
    || (value.record_key_delivery.caller_state === "not_a_card_recipient" && value.record_key_cards.length !== 0)
    || (value.record_key_delivery.caller_state === "delivered_inline" && value.record_key_cards.length !== value.embryo_count)
    || new Set(value.record_key_cards.map(item => item.embryo_id)).size !== value.record_key_cards.length
    || new Set(value.record_key_cards.map(item => item.record_key)).size !== value.record_key_cards.length) context.addIssue({ code: "custom", message: "receipt binding" });
});

/** Registered cohort-created-v1 only. Raw keys stay in the single response lifecycle. */
export function readUploadReceipt(value: unknown) {
  const parsed = receipt.parse(value);
  return { cards: parsed.record_key_cards, session: readUploadSession(parsed.upload_session) };
}
