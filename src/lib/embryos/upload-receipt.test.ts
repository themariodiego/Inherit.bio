import { describe, expect, it } from "vitest";
import { cohortCreatedBody } from "./cohort-create";
import { readUploadReceipt } from "./upload-receipt";

const id = (n: string) => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
function issued() {
  return cohortCreatedBody({ cohort: { cohort_id: id("3"), embryo_count: 2, recipient_set_revision: 1, key_revision: 1,
    caller_state: "delivered_inline", cards: [0, 1].map(index => ({ embryo_id: id(String(index + 4)), display_label: `Embryo ${index + 1}`,
      record_key: index === 0 ? "0123456789ABCDEFGHJK" : "1123456789ABCDEFGHJK", closing_date_iso: "2028-09-30",
      closing_date_state: "provisional_until_terminal_ordinal_resolution", date_revision: 1 })) },
    ingest: { session: id("1"), uploadId: id("2"), cookieValue: "a".repeat(43), challenge: "b".repeat(43), revision: 1,
      sampleHandles: [{ ordinal: 0, handle: "c".repeat(43) }, { ordinal: 1, handle: "d".repeat(43) }], expiresAt: "2026-10-01T00:00:00Z" } },
  "synthetic-sealed-nonce", "https://inherit.bio");
}
describe("registered finalization receipt", () => {
  it("round trips the real producer's cards and same-session transport without its secret or raw challenge", () => {
    const body = issued();
    const restored = readUploadReceipt(JSON.parse(JSON.stringify(body)));
    expect(restored.cards).toEqual(body.record_key_cards);
    expect(restored.session.session).toBe(body.upload_session.session);
    expect(JSON.stringify(restored)).not.toContain('"cookieValue"');
    expect(JSON.stringify(restored)).not.toContain('"challenge"');
  });
  it("refuses a transplanted route, forbidden field, wrong count, duplicate card or changed deployment limit", () => {
    const base = issued();
    for (const body of [ { ...base, secret: "unregistered" }, { ...base, embryo_count: 3 },
      { ...base, upload_session: { ...base.upload_session, completeRoute: `/api/embryo-ingest/${id("9")}/complete` } },
      { ...base, upload_session: { ...base.upload_session, configureRoute: "https://foreign.example/configure" } },
      { ...base, upload_session: { ...base.upload_session, maximumChunks: base.upload_session.maximumChunks + 1 } },
      { ...base, record_key_cards: [base.record_key_cards[0], base.record_key_cards[0]] } ]) expect(() => readUploadReceipt(body)).toThrow();
  });
  it("accepts zero cards only for a non-recipient and refuses invented date words", () => {
    const base = issued();
    expect(readUploadReceipt({ ...base, record_key_delivery: { ...base.record_key_delivery, caller_state: "not_a_card_recipient" }, record_key_cards: [] }).cards).toEqual([]);
    expect(() => readUploadReceipt({ ...base, record_key_cards: [] })).toThrow();
    expect(() => readUploadReceipt({ ...base, record_key_cards: base.record_key_cards.map(card => ({ ...card, closing_date_words: "tomorrow" })) })).toThrow();
  });
});
