import { expect, it } from "vitest";
import { readRecordKeyCardReceipt } from "./record-key-card-receipt";
const C = "50000000-0000-4000-8000-000000000001", E = "50000000-0000-4000-8000-000000000002",
  OTHER = "50000000-0000-4000-8000-000000000003", url = "https://synthetic.example.invalid/future-person/claim";
const card = { embryo_id: E, display_label: "Embryo 1", record_key: "0123456789ABCDEFGHJK", claim_url: url,
  closing_date_words: "10 October 2028", closing_date_iso: "2028-10-10", closing_date_state: "provisional_until_terminal_ordinal_resolution",
  date_revision: 1, delivery_kind: "initial" };
const receipt = { cohort_id: C, recipient_set_revision: 1, key_revision: 1, record_key_cards: [card] };
const expected = { cohortId: C, cardCount: 1, claimUrl: url };
it("accepts the exact initial and transfer-subset deliveries with their actual dates", () => {
  expect(readRecordKeyCardReceipt(200, receipt, expected)).toEqual(receipt);
  const transferred = { ...receipt, record_key_cards: [{ ...card, delivery_kind: "transfer_replacement",
    closing_date_state: "definitive_transferred_claim_window" }] };
  expect(readRecordKeyCardReceipt(200, transferred, expected)).toEqual(transferred);
});
it("accepts the current complete native transfer subset when the previous page count changes", () => {
  const earlierPage = { ...expected, cardCount: 2 };
  expect(readRecordKeyCardReceipt(200, receipt, earlierPage)).toEqual(receipt);
});
it.each(["extra", "extra-card", "wrong-cohort", "empty", "duplicate-record", "duplicate-key", "bad-key", "wrong-url", "bad-label",
  "bad-date", "wrong-date-words", "bad-date-state", "zero-date-revision", "zero-recipient-revision", "zero-key-revision", "bad-delivery"])
  ("refuses %s without a renderable one-time receipt", kind => {
    const value = structuredClone(receipt), bound = { ...expected };
    if (kind === "extra") Object.assign(value, { parentId: OTHER });
    if (kind === "extra-card") Object.assign(value.record_key_cards[0], { key_hash: "protected" });
    if (kind === "wrong-cohort") value.cohort_id = OTHER;
    if (kind === "empty") value.record_key_cards = [];
    if (kind === "duplicate-record" || kind === "duplicate-key") {
      bound.cardCount = 2;
      value.record_key_cards.push({ ...card, embryo_id: kind === "duplicate-record" ? E : OTHER,
        record_key: kind === "duplicate-key" ? card.record_key : "123456789ABCDEFGHJKM" });
    }
    if (kind === "bad-key") value.record_key_cards[0].record_key = "I".repeat(20);
    if (kind === "wrong-url") value.record_key_cards[0].claim_url = "https://other.example.invalid/future-person/claim";
    if (kind === "bad-label") value.record_key_cards[0].display_label = "Real person";
    if (kind === "bad-date") value.record_key_cards[0].closing_date_iso = "2028-02-30";
    if (kind === "wrong-date-words") value.record_key_cards[0].closing_date_words = "11 October 2028";
    if (kind === "bad-date-state") value.record_key_cards[0].closing_date_state = "made-up";
    if (kind === "zero-date-revision") value.record_key_cards[0].date_revision = 0;
    if (kind === "zero-recipient-revision") value.recipient_set_revision = 0;
    if (kind === "zero-key-revision") value.key_revision = 0;
    if (kind === "bad-delivery") value.record_key_cards[0].delivery_kind = "someone-else";
    expect(readRecordKeyCardReceipt(200, value, bound)).toBeNull();
  });
it.each([202, 400, 401, 404, 503])("rejects HTTP %s instead of implying delivery succeeded", status => {
  expect(readRecordKeyCardReceipt(status, receipt, expected)).toBeNull();
});
