import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost");

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

const { POST } = await import("./route");
const { mintRecordKeyCardsRightsForm } = await import("@/lib/embryos/record-key-cards-rights");
const { RIGHTS_COOKIE_NAME, newRightsSessionSecret, rightsSessionHash } = await import("@/lib/embryos/rights-session");
const { mintPublicFormToken } = await import("@/lib/embryos/operation-token");
afterAll(() => vi.unstubAllEnvs());

const ORIGIN = "http://localhost";
const COHORT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EMBRYO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KEY = "0123456789ABCDEFGHJK";

let secret: string;

function call(options: {
  nonce?: string; header?: string | null; origin?: string | null; site?: string | null; cookie?: string | null;
  body?: unknown; url?: string;
} = {}) {
  const nonce = options.nonce ?? mintRecordKeyCardsRightsForm(rightsSessionHash(secret));
  const headers = new Headers({ "content-type": "application/json" });
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  const site = options.site === undefined ? "same-origin" : options.site;
  if (site !== null) headers.set("sec-fetch-site", site);
  const header = options.header === undefined ? nonce : options.header;
  if (header !== null) headers.set("x-inherit-csrf", header);
  const cookie = options.cookie === undefined ? `${RIGHTS_COOKIE_NAME}=${secret}` : options.cookie;
  if (cookie !== null) headers.set("cookie", cookie);
  return POST(new Request(options.url ?? `${ORIGIN}/api/rights/embryo-record-key-cards`, {
    method: "POST", headers, body: JSON.stringify(options.body ?? { nonce }),
  }));
}

const CARD = {
  embryo_id: EMBRYO, display_label: "Embryo 1", record_key: KEY, closing_date_iso: "2027-04-01",
  closing_date_state: "provisional_until_terminal_ordinal_resolution", date_revision: 1, delivery_kind: "initial",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
  secret = newRightsSessionSecret();
  mocks.rpc.mockResolvedValue({
    data: [{ cohort_id: COHORT, recipient_set_revision: 1, key_revision: 1, cards: [CARD] }], error: null,
  });
});

describe("POST /api/rights/embryo-record-key-cards", () => {
  it("delivers the session recipient's cards once, in record-key-card-delivery-v1's closed shape", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["cohort_id", "key_revision", "recipient_set_revision", "record_key_cards"]);
    expect(body.record_key_cards).toHaveLength(1);
    expect(Object.keys(body.record_key_cards[0]).sort()).toEqual([
      "claim_url", "closing_date_iso", "closing_date_state", "closing_date_words", "date_revision", "delivery_kind",
      "display_label", "embryo_id", "record_key",
    ]);
    expect(body.record_key_cards[0].record_key).toBe(KEY);
    expect(body.record_key_cards[0].claim_url).toBe(`${ORIGIN}/future-person/claim`);
  });

  it("hands the database only the session hash and the form's nonce, never a cohort or recipient", async () => {
    await call();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [name, args] = mocks.rpc.mock.calls[0];
    expect(name).toBe("deliver_embryo_record_key_cards_rights_v1");
    expect(Object.keys(args).sort()).toEqual(["p_nonce", "p_session_hash"]);
    expect(args.p_session_hash).toBe(rightsSessionHash(secret));
    expect(args.p_nonce).toMatch(/^[A-Za-z0-9_-]{16,256}$/);
  });

  it("is the same 404 outside the test jurisdiction, before anything is read", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
    const response = await call();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses every missing or mismatched signal with the same 404 and no database call", async () => {
    const otherSession = mintRecordKeyCardsRightsForm(rightsSessionHash(newRightsSessionSecret()));
    const otherForm = mintPublicFormToken("embryo-parent-withdraw", Date.now(), rightsSessionHash(secret));
    for (const options of [
      { origin: "https://elsewhere.example" }, { origin: null }, { site: "cross-site" }, { site: null },
      { header: null }, { header: "different-token-value" }, { cookie: null },
      { cookie: `${RIGHTS_COOKIE_NAME}=${secret}; ${RIGHTS_COOKIE_NAME}=${secret}` },
      { nonce: otherSession }, { nonce: otherForm }, { nonce: "forged-token-value-000" },
      { body: { nonce: "x".repeat(20), cohortId: COHORT } }, { body: { recordKey: KEY } },
      { url: `${ORIGIN}/api/rights/embryo-record-key-cards?cohort=${COHORT}` },
    ]) {
      const response = await call(options);
      expect(response.status, JSON.stringify(options)).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers 404 for every database refusal", async () => {
    for (const result of [
      { data: null, error: { code: "42501", message: "card delivery unavailable" } },
      { data: null, error: { code: "23505", message: "operation nonce already used" } },
      { data: [], error: null },
    ]) {
      mocks.rpc.mockResolvedValueOnce(result);
      const response = await call();
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
  });

  it("never serializes a card that does not fit the registered shape", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [{ cohort_id: COHORT, recipient_set_revision: 1, key_revision: 1, cards: [{ ...CARD, parent_id: COHORT }] }], error: null,
    });
    const response = await call();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(KEY);
  });
});
