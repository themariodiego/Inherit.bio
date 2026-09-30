import crypto from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));

const {
  CLAIM_CSRF_HEADER,
  CLAIM_FORM_COOKIE,
  CLAIM_SESSION_COOKIE,
  mintClaimForm,
  newClaimSession,
  readClaimForm,
  sha256Hex,
} = await import("./claim-session");
const { mintPublicFormToken } = await import("@/lib/embryos/operation-token");

afterAll(() => {
  vi.unstubAllEnvs();
});

const NOW = 1_800_000_000_000;
const ORIGIN = "https://inherit.bio";
const URL_PATH = `${ORIGIN}/api/future-person/claim`;

function cookieValue(setCookie: string): string {
  return setCookie.slice(setCookie.indexOf("=") + 1, setCookie.indexOf(";"));
}

function post(
  form: { formToken: string; setCookie: string },
  overrides: { url?: string; method?: string; headers?: Record<string, string | null> } = {},
): Request {
  const headers: Record<string, string | null> = {
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
    "content-type": "application/json",
    [CLAIM_CSRF_HEADER]: form.formToken,
    cookie: `${CLAIM_FORM_COOKIE}=${cookieValue(form.setCookie)}`,
    ...overrides.headers,
  };
  const present = Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== null));
  const method = overrides.method ?? "POST";
  return new Request(overrides.url ?? URL_PATH, { method, headers: present, body: method === "POST" ? "{}" : undefined });
}

describe("the claim form pair (api.future-person-claim.requestContract)", () => {
  it("mints a ten-minute HttpOnly, SameSite=Strict cookie and a token bound to it", () => {
    const form = mintClaimForm(NOW);
    expect(form.setCookie).toMatch(/^inherit-claim-form=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=600; HttpOnly; SameSite=Strict$/);
    expect(readClaimForm(post(form), NOW)).toEqual({ nonce: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/) });
  });

  it("gives every page a different pair and nonce", () => {
    const first = mintClaimForm(NOW);
    const second = mintClaimForm(NOW);
    expect(cookieValue(first.setCookie)).not.toBe(cookieValue(second.setCookie));
    expect(readClaimForm(post(first), NOW)?.nonce).not.toBe(readClaimForm(post(second), NOW)?.nonce);
  });

  it("keeps a browser's cookie when the page renders again, with a new one-time token each time", () => {
    const first = mintClaimForm(NOW);
    const secret = cookieValue(first.setCookie);
    const again = mintClaimForm(NOW + 1000, secret);
    expect(again.setCookie).toBe(first.setCookie);
    expect(again.formToken).not.toBe(first.formToken);
    const firstNonce = readClaimForm(post(first), NOW + 2000)?.nonce;
    const againNonce = readClaimForm(post(again), NOW + 2000)?.nonce;
    expect(firstNonce, "the token the browser already shows still posts").toBeTruthy();
    expect(againNonce).toBeTruthy();
    expect(againNonce).not.toBe(firstNonce);
  });

  it("mints a new cookie when the one presented is malformed", () => {
    const form = mintClaimForm(NOW, "not-a-secret");
    expect(cookieValue(form.setCookie)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookieValue(form.setCookie)).not.toBe("not-a-secret");
  });

  it("refuses a token with another browser's cookie", () => {
    const first = mintClaimForm(NOW);
    const second = mintClaimForm(NOW);
    expect(readClaimForm(post({ formToken: first.formToken, setCookie: second.setCookie }), NOW)).toBeNull();
  });

  it("refuses the pair once ten minutes have passed", () => {
    const form = mintClaimForm(NOW);
    expect(readClaimForm(post(form), NOW + 10 * 60 * 1000 - 1)).not.toBeNull();
    expect(readClaimForm(post(form), NOW + 10 * 60 * 1000)).toBeNull();
  });

  it("refuses a token minted for another public form", () => {
    const form = mintClaimForm(NOW);
    const secret = cookieValue(form.setCookie);
    const other = mintPublicFormToken("rights-activate", NOW, sha256Hex(secret));
    expect(readClaimForm(post({ formToken: other, setCookie: form.setCookie }), NOW)).toBeNull();
  });

  it("refuses a token that binds no cookie", () => {
    const form = mintClaimForm(NOW);
    const unbound = mintPublicFormToken("future-person-claim", NOW);
    expect(readClaimForm(post({ formToken: unbound, setCookie: form.setCookie }), NOW)).toBeNull();
  });

  it.each([
    ["another origin", { headers: { origin: "https://evil.invalid" } }],
    ["no origin", { headers: { origin: null } }],
    ["cross-site fetch metadata", { headers: { "sec-fetch-site": "cross-site" } }],
    ["no fetch metadata", { headers: { "sec-fetch-site": null } }],
    ["a form post", { headers: { "content-type": "application/x-www-form-urlencoded" } }],
    ["no token header", { headers: { [CLAIM_CSRF_HEADER]: null } }],
    ["an oversized token", { headers: { [CLAIM_CSRF_HEADER]: "a".repeat(2049) } }],
    ["no cookie", { headers: { cookie: null } }],
    ["a query string", { url: `${URL_PATH}?mode=record-key` }],
    ["another method", { method: "PUT" }],
  ])("refuses a request with %s", (_label, overrides) => {
    const form = mintClaimForm(NOW);
    expect(readClaimForm(post(form, overrides as Parameters<typeof post>[1]), NOW)).toBeNull();
  });

  it("refuses a repeated or malformed form cookie", () => {
    const form = mintClaimForm(NOW);
    const value = cookieValue(form.setCookie);
    const repeated = `${CLAIM_FORM_COOKIE}=${value}; ${CLAIM_FORM_COOKIE}=${value}`;
    expect(readClaimForm(post(form, { headers: { cookie: repeated } }), NOW)).toBeNull();
    expect(readClaimForm(post(form, { headers: { cookie: `${CLAIM_FORM_COOKIE}=${value}x` } }), NOW)).toBeNull();
    expect(readClaimForm(post(form, { headers: { cookie: `other=1; ${CLAIM_FORM_COOKIE}=${value}` } }), NOW)).not.toBeNull();
  });

  it("accepts a JSON content type with parameters", () => {
    const form = mintClaimForm(NOW);
    expect(readClaimForm(post(form, { headers: { "content-type": "Application/JSON; charset=utf-8" } }), NOW)).not.toBeNull();
  });
});

describe("the claim session (claim-session-api-v1)", () => {
  it("keeps only the SHA-256 of a 256-bit secret, and spends the form pair", () => {
    const session = newClaimSession();
    const [sessionCookie, spentForm] = session.setCookies;
    expect(sessionCookie).toMatch(new RegExp(`^${CLAIM_SESSION_COOKIE}=[A-Za-z0-9_-]{43}; Path=/; Max-Age=86400; HttpOnly; SameSite=Strict$`));
    const secret = cookieValue(sessionCookie!);
    expect(Buffer.from(secret, "base64url")).toHaveLength(32);
    expect(session.sessionHash).toBe(crypto.createHash("sha256").update(secret).digest("hex"));
    expect(session.sessionHash).not.toContain(secret);
    expect(spentForm).toBe(`${CLAIM_FORM_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`);
  });

  it("never repeats a session", () => {
    expect(newClaimSession().sessionHash).not.toBe(newClaimSession().sessionHash);
  });
});
