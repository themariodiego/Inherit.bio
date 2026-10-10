import { z } from "zod";
import { calendarDate, closingDateWords, RECORD_KEY_PATTERN } from "./record-key-card-values";

const card = z.object({
  embryo_id: z.uuid(), display_label: z.string().regex(/^Embryo [1-9][0-9]?$/),
  record_key: z.string().regex(RECORD_KEY_PATTERN), claim_url: z.url(),
  closing_date_words: z.string(), closing_date_iso: z.iso.date(),
  closing_date_state: z.enum(["provisional_until_terminal_ordinal_resolution", "definitive_stored_or_unknown", "definitive_transferred_claim_window"]),
  date_revision: z.number().int().positive(), delivery_kind: z.enum(["initial", "transfer_replacement"]),
}).strict().refine(value => calendarDate(value.closing_date_iso) !== null
  && closingDateWords(value.closing_date_iso) === value.closing_date_words);
const receipt = z.object({
  cohort_id: z.uuid(), recipient_set_revision: z.number().int().positive(), key_revision: z.number().int().positive(),
  record_key_cards: z.array(card).min(1).max(64),
}).strict();

export type RecordKeyCardReceipt = z.infer<typeof receipt>;

/** No server-only code or exception diagnostics carrying a raw key enter the
 * browser. Accept only the registered own-cohort receipt and canonical claim link. */
export function readRecordKeyCardReceipt(status: number, value: unknown,
  expected: { cohortId: string; claimUrl: string }): RecordKeyCardReceipt | null {
  if (status !== 200) return null;
  const parsed = receipt.safeParse(value);
  if (!parsed.success || parsed.data.cohort_id !== expected.cohortId) return null;
  const cards = parsed.data.record_key_cards;
  // Page counts are read-only hints. A valid intervening transfer can change
  // the complete current set before the native transaction delivers it.
  if (cards.some(row => row.claim_url !== expected.claimUrl)
    || new Set(cards.map(row => row.embryo_id)).size !== cards.length
    || new Set(cards.map(row => row.record_key)).size !== cards.length) return null;
  return parsed.data;
}
