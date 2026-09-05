import { z } from "zod";

/**
 * Record Key Cards (E0 contract §5.5; register closedShapes
 * `cohortRecordKeyCardSnake`, `deliveryRecordKeyCardSnake`,
 * `transferRecordKeyCardCamel`; decision §11.2). The database generates the
 * key and the dates; this module renders the words and the claim link a
 * printed card carries and shapes the RPC's jsonb into exactly the closed
 * key sets the register publishes. It reads nothing but one environment
 * variable, so every branch is provable without a database.
 *
 * A Record Key is 20 characters of Crockford base32 (100 bits): the
 * alphabet drops I, L, O and U so a card read aloud or typed from paper is
 * never ambiguous. Keys are one-time deliveries; nothing here stores one.
 */

export const RECORD_KEY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const RECORD_KEY_PATTERN = /^[0-9A-HJKMNP-TV-Z]{20}$/;

export function isRecordKey(value: string): boolean {
  return RECORD_KEY_PATTERN.test(value);
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The parts of a calendar date written as `YYYY-MM-DD`, or null when it is not one. */
function calendarDate(iso: string): { year: number; month: number; day: number } | null {
  const match = ISO_DATE_PATTERN.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? { year, month, day } : null;
}

/**
 * The closing date as the card prints it: "5 September 2028". The day has
 * no leading zero, the month is its English name and the year has four
 * digits. Rendered by hand rather than by a locale so every runtime prints
 * the same words. A value that is not a calendar date is a defect upstream
 * and throws rather than printing the wrong date on a card.
 */
export function closingDateWords(iso: string): string {
  const date = calendarDate(iso);
  if (!date) throw new RangeError("closing date is not a calendar date");
  return `${date.day} ${MONTHS[date.month - 1]} ${String(date.year).padStart(4, "0")}`;
}

/** The deployment's public origin, with no trailing slash. */
export function canonicalOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  const origin = configured && configured.trim().length > 0 ? configured.trim() : "https://www.inherit.bio";
  return origin.replace(/\/+$/, "");
}

/** The absolute address a printed card carries: `rights.future-person-claim`. */
export function claimUrl(origin = canonicalOrigin()): string {
  return `${origin}/future-person/claim`;
}

export type ClosingDateState =
  | "provisional_until_terminal_ordinal_resolution"
  | "definitive_stored_or_unknown"
  | "definitive_transferred_claim_window";

export interface RpcCard {
  embryo_id: string;
  display_label: string;
  record_key: string;
  closing_date_iso: string;
  closing_date_state: ClosingDateState;
  date_revision: number;
  delivery_kind?: "initial" | "transfer_replacement";
}

const CLOSING_DATE_STATES = [
  "provisional_until_terminal_ordinal_resolution",
  "definitive_stored_or_unknown",
  "definitive_transferred_claim_window",
] as const;

/** The label the database generates from the ordinal; nothing else may stand in for it. */
const DISPLAY_LABEL_PATTERN = /^Embryo [1-9][0-9]?$/;

const rpcCardSchema = z
  .object({
    embryo_id: z.uuid(),
    display_label: z.string().regex(DISPLAY_LABEL_PATTERN),
    record_key: z.string().regex(RECORD_KEY_PATTERN),
    closing_date_iso: z.string().refine((value) => calendarDate(value) !== null, "not a calendar date"),
    closing_date_state: z.enum(CLOSING_DATE_STATES),
    date_revision: z.number().int().positive(),
    delivery_kind: z.enum(["initial", "transfer_replacement"]).optional(),
  })
  .strict();

const rpcCardsSchema = z.array(rpcCardSchema);

/**
 * The RPC's `cards` jsonb as typed cards. Throws on anything that is not an
 * array of exactly the six or seven expected keys with well-formed values,
 * so a database that ever returned more than a card should carry never
 * reaches a response.
 */
export function parseRpcCards(value: unknown): RpcCard[] {
  return rpcCardsSchema.parse(value);
}

/** `cohortRecordKeyCardSnake`: the card of `api.embryo-cohorts`. */
export interface CohortCard {
  embryo_id: string;
  display_label: string;
  record_key: string;
  claim_url: string;
  closing_date_words: string;
  closing_date_iso: string;
  closing_date_state: ClosingDateState;
  date_revision: number;
}

/** `deliveryRecordKeyCardSnake`: the card of `api.embryo-record-key-cards`. */
export interface DeliveryCard extends CohortCard {
  delivery_kind: "initial" | "transfer_replacement";
}

/** `transferRecordKeyCardCamel`: the replacement card of a transfer disposition. */
export interface TransferCard {
  recordKey: string;
  claimUrl: string;
  closingDateWords: string;
  closingDateIso: string;
  closingDateState: ClosingDateState;
}

export function cohortCard(card: RpcCard, origin?: string): CohortCard {
  return {
    embryo_id: card.embryo_id,
    display_label: card.display_label,
    record_key: card.record_key,
    claim_url: claimUrl(origin),
    closing_date_words: closingDateWords(card.closing_date_iso),
    closing_date_iso: card.closing_date_iso,
    closing_date_state: card.closing_date_state,
    date_revision: card.date_revision,
  };
}

export function deliveryCard(
  card: RpcCard & { delivery_kind: "initial" | "transfer_replacement" },
  origin?: string,
): DeliveryCard {
  return { ...cohortCard(card, origin), delivery_kind: card.delivery_kind };
}

export function transferCard(
  card: { record_key: string; closing_date_iso: string; closing_date_state: ClosingDateState },
  origin?: string,
): TransferCard {
  return {
    recordKey: card.record_key,
    claimUrl: claimUrl(origin),
    closingDateWords: closingDateWords(card.closing_date_iso),
    closingDateIso: card.closing_date_iso,
    closingDateState: card.closing_date_state,
  };
}
