import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RECORD_KEY_ALPHABET,
  RECORD_KEY_PATTERN,
  canonicalOrigin,
  claimUrl,
  closingDateWords,
  cohortCard,
  deliveryCard,
  isRecordKey,
  parseRpcCards,
  transferCard,
  type RpcCard,
} from "./record-key-cards";

afterEach(() => {
  vi.unstubAllEnvs();
});

const FIRST_RECORD = RECORD_KEY_ALPHABET.slice(0, 20);
const SECOND_RECORD = RECORD_KEY_ALPHABET.slice(12);

const CARD_ONE: RpcCard = {
  embryo_id: "11111111-1111-4111-8111-111111111111",
  display_label: "Embryo 1",
  record_key: FIRST_RECORD,
  closing_date_iso: "2028-09-05",
  closing_date_state: "provisional_until_terminal_ordinal_resolution",
  date_revision: 1,
};

const CARD_TWO: RpcCard = {
  embryo_id: "22222222-2222-4222-8222-222222222222",
  display_label: "Embryo 2",
  record_key: SECOND_RECORD,
  closing_date_iso: "2047-06-01",
  closing_date_state: "definitive_transferred_claim_window",
  date_revision: 2,
  delivery_kind: "transfer_replacement",
};

const COHORT_CARD_KEYS = [
  "embryo_id",
  "display_label",
  "record_key",
  "claim_url",
  "closing_date_words",
  "closing_date_iso",
  "closing_date_state",
  "date_revision",
];

/**
 * Record Key Cards (contract §5.5; register closedShapes and
 * futurePersonReadableKeyFormat; decision §11.2): the Crockford alphabet,
 * the printed date, the claim link, and the exact closed key sets of the
 * three card shapes.
 */
describe("record key format", () => {
  it("is Crockford base32: 32 distinct characters with I, L, O and U left out", () => {
    expect(RECORD_KEY_ALPHABET).toHaveLength(32);
    expect(new Set(RECORD_KEY_ALPHABET).size).toBe(32);
    expect(RECORD_KEY_ALPHABET).toMatch(/^[0-9A-Z]+$/);
    for (const glyph of "ILOU") expect(RECORD_KEY_ALPHABET).not.toContain(glyph);
    expect(RECORD_KEY_PATTERN.source).toBe("^[0-9A-HJKMNP-TV-Z]{20}$");
  });

  it("accepts exactly 20 characters of the alphabet and nothing else", () => {
    for (const glyph of RECORD_KEY_ALPHABET) expect(isRecordKey(glyph.repeat(20)), glyph).toBe(true);
    expect(isRecordKey(FIRST_RECORD)).toBe(true);
    expect(isRecordKey(SECOND_RECORD)).toBe(true);
    for (const glyph of "ILOU") expect(isRecordKey(glyph.repeat(20)), glyph).toBe(false);
    expect(isRecordKey(FIRST_RECORD.toLowerCase())).toBe(false);
    expect(isRecordKey(FIRST_RECORD.slice(1))).toBe(false);
    expect(isRecordKey(`${FIRST_RECORD}A`)).toBe(false);
    expect(isRecordKey(`${FIRST_RECORD.slice(0, 19)} `)).toBe(false);
    expect(isRecordKey("")).toBe(false);
  });
});

describe("closing date words", () => {
  it.each([
    ["2028-09-05", "5 September 2028"],
    ["2030-01-31", "31 January 2030"],
    ["2027-12-01", "1 December 2027"],
    ["2029-02-28", "28 February 2029"],
    ["2028-02-29", "29 February 2028"],
    ["2047-10-10", "10 October 2047"],
  ])("renders %s as %s", (iso, words) => {
    expect(closingDateWords(iso)).toBe(words);
  });

  it.each(["2028-02-30", "2029-02-29", "2028-13-01", "2028-00-10", "2028-09-00", "05/09/2028", "2028-9-5", "2028-09-05T00:00:00Z", "", "September 5 2028"])(
    "refuses %j rather than printing a wrong date",
    (value) => {
      expect(() => closingDateWords(value)).toThrow(RangeError);
    },
  );
});

describe("claim link", () => {
  it("uses the configured public origin, without a trailing slash, and the canonical one by default", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined);
    expect(canonicalOrigin()).toBe("https://www.inherit.bio");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(canonicalOrigin()).toBe("https://www.inherit.bio");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.example.test/");
    expect(canonicalOrigin()).toBe("https://staging.example.test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", " http://localhost:3000 ");
    expect(canonicalOrigin()).toBe("http://localhost:3000");
  });

  it("points at the future-person claim route on the given or canonical origin", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined);
    expect(claimUrl()).toBe("https://www.inherit.bio/future-person/claim");
    expect(claimUrl("https://staging.example.test")).toBe("https://staging.example.test/future-person/claim");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.example.test");
    expect(claimUrl()).toBe("https://staging.example.test/future-person/claim");
  });
});

describe("parseRpcCards", () => {
  it("returns the typed cards of a well-formed jsonb array, with or without a delivery kind", () => {
    expect(parseRpcCards([CARD_ONE, CARD_TWO])).toEqual([CARD_ONE, CARD_TWO]);
    expect(parseRpcCards([{ ...CARD_ONE, delivery_kind: "initial" }])).toEqual([{ ...CARD_ONE, delivery_kind: "initial" }]);
    expect(parseRpcCards([])).toEqual([]);
  });

  it("throws on an extra key, a missing key or a value that is not a card's", () => {
    expect(() => parseRpcCards([{ ...CARD_ONE, sample_label: "A" }])).toThrow();
    expect(() => parseRpcCards([{ ...CARD_ONE, sex: "unknown" }])).toThrow();
    const { record_key: _dropped, ...withoutKey } = CARD_ONE;
    void _dropped;
    expect(() => parseRpcCards([withoutKey])).toThrow();
    expect(() => parseRpcCards([{ ...CARD_ONE, record_key: FIRST_RECORD.toLowerCase() }])).toThrow();
    expect(() => parseRpcCards([{ ...CARD_ONE, record_key: `${FIRST_RECORD}A` }])).toThrow();
    expect(() => parseRpcCards([{ ...CARD_ONE, closing_date_state: "final" }])).toThrow();
    expect(() => parseRpcCards([{ ...CARD_ONE, closing_date_iso: "2028-02-30" }])).toThrow();
    expect(() => parseRpcCards([{ ...CARD_ONE, date_revision: 0 }])).toThrow();
    expect(() => parseRpcCards([{ ...CARD_ONE, date_revision: 1.5 }])).toThrow();
    expect(() => parseRpcCards([{ ...CARD_ONE, embryo_id: "embryo-1" }])).toThrow();
    expect(() => parseRpcCards([{ ...CARD_ONE, display_label: "Embryo 0" }])).toThrow();
    expect(() => parseRpcCards([{ ...CARD_ONE, display_label: "Embryo 100" }])).toThrow();
    expect(() => parseRpcCards([{ ...CARD_ONE, display_label: "Sample A" }])).toThrow();
    expect(() => parseRpcCards([{ ...CARD_ONE, delivery_kind: "replacement" }])).toThrow();
  });

  it("throws on anything that is not an array of cards", () => {
    expect(() => parseRpcCards(null)).toThrow();
    expect(() => parseRpcCards(undefined)).toThrow();
    expect(() => parseRpcCards("[]")).toThrow();
    expect(() => parseRpcCards(CARD_ONE)).toThrow();
    expect(() => parseRpcCards([null])).toThrow();
    expect(() => parseRpcCards([[CARD_ONE]])).toThrow();
  });
});

describe("card shapes", () => {
  it("cohortCard carries exactly the cohortRecordKeyCardSnake keys, in register order", () => {
    const card = cohortCard(CARD_ONE, "https://staging.example.test");
    expect(Object.keys(card)).toEqual(COHORT_CARD_KEYS);
    expect(card).toEqual({
      embryo_id: CARD_ONE.embryo_id,
      display_label: "Embryo 1",
      record_key: FIRST_RECORD,
      claim_url: "https://staging.example.test/future-person/claim",
      closing_date_words: "5 September 2028",
      closing_date_iso: "2028-09-05",
      closing_date_state: "provisional_until_terminal_ordinal_resolution",
      date_revision: 1,
    });
  });

  it("cohortCard drops a delivery kind the RPC may have added and uses the canonical origin by default", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined);
    const card = cohortCard(CARD_TWO);
    expect(Object.keys(card)).toEqual(COHORT_CARD_KEYS);
    expect(card.claim_url).toBe("https://www.inherit.bio/future-person/claim");
    expect(card.closing_date_words).toBe("1 June 2047");
  });

  it("deliveryCard carries exactly the deliveryRecordKeyCardSnake keys, delivery kind last", () => {
    const card = deliveryCard({ ...CARD_ONE, delivery_kind: "initial" }, "https://staging.example.test");
    expect(Object.keys(card)).toEqual([...COHORT_CARD_KEYS, "delivery_kind"]);
    expect(card.delivery_kind).toBe("initial");
    expect(deliveryCard(CARD_TWO as RpcCard & { delivery_kind: "transfer_replacement" }).delivery_kind).toBe(
      "transfer_replacement",
    );
  });

  it("transferCard carries exactly the transferRecordKeyCardCamel keys", () => {
    const card = transferCard(
      { record_key: SECOND_RECORD, closing_date_iso: "2047-06-01", closing_date_state: "definitive_transferred_claim_window" },
      "https://staging.example.test",
    );
    expect(Object.keys(card)).toEqual(["recordKey", "claimUrl", "closingDateWords", "closingDateIso", "closingDateState"]);
    expect(card).toEqual({
      recordKey: SECOND_RECORD,
      claimUrl: "https://staging.example.test/future-person/claim",
      closingDateWords: "1 June 2047",
      closingDateIso: "2047-06-01",
      closingDateState: "definitive_transferred_claim_window",
    });
  });

  it("refuses to shape a card whose date is not a calendar date", () => {
    expect(() => cohortCard({ ...CARD_ONE, closing_date_iso: "2028-02-30" })).toThrow(RangeError);
    expect(() =>
      transferCard({ record_key: FIRST_RECORD, closing_date_iso: "soon", closing_date_state: "definitive_stored_or_unknown" }),
    ).toThrow(RangeError);
  });
});
