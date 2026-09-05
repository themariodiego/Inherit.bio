import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ingestCookie, ingestCookieName, readIngestCookieHash } from "./ingest-session";

const SESSION = "a0000000-0000-4000-8000-000000000001";
const OTHER = "a0000000-0000-4000-8000-000000000002";
const SECRET = "a".repeat(43);
const cookie = `${ingestCookieName(SESSION, true)}=${SECRET}`;
const request = (value: string) => new Request("https://inherit.example", { headers: { cookie: value } });

describe("ingest cookie boundary", () => {
  it("is host-only, secure, HttpOnly, Strict and fixed-expiry in production", () => {
    const value = ingestCookie(SESSION, SECRET, new Date("2026-09-06T10:00:00Z"), true);
    expect(value).toBe(`${cookie}; Path=/; Expires=Sun, 06 Sep 2026 10:00:00 GMT; HttpOnly; SameSite=Strict; Secure`);
    expect(value).not.toMatch(/Domain=|Max-Age=/);
  });
  it("keeps concurrent sessions separate and exposes only a digest to the RPC", () => {
    expect(readIngestCookieHash(request(`${cookie}; ${ingestCookieName(OTHER, true)}=${"b".repeat(43)}`), SESSION, true))
      .toBe(createHash("sha256").update(SECRET).digest("hex"));
    expect(readIngestCookieHash(request(cookie), OTHER, true)).toBeNull();
  });
  it.each(["", `${cookie}; ${cookie}`, `${cookie}; ${ingestCookieName(SESSION, true)}=invalid`, `${cookie}x`, cookie.replace(SECRET, `%61${SECRET.slice(1)}`)])(
    "fails closed for absent, ambiguous or malformed cookies", (value) => {
      expect(readIngestCookieHash(request(value), SESSION, true)).toBeNull();
    },
  );
  it("does not accept a local-development cookie in production", () => {
    expect(readIngestCookieHash(request(`${ingestCookieName(SESSION, false)}=${SECRET}`), SESSION, true)).toBeNull();
  });
  it("refuses cookie name/value injection and invalid dates", () => {
    expect(() => ingestCookie(`${SESSION}; x=y`, SECRET, new Date())).toThrow();
    expect(() => ingestCookie(SESSION, `${SECRET}; x=y`, new Date())).toThrow();
    expect(() => ingestCookie(SESSION, SECRET, new Date("invalid"))).toThrow();
  });
});
