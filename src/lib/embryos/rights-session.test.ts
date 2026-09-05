import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** The module under the given NODE_ENV; the cookie name is decided when the module loads. */
async function load(nodeEnv?: string) {
  vi.resetModules();
  if (nodeEnv !== undefined) vi.stubEnv("NODE_ENV", nodeEnv);
  return import("./rights-session");
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function attributesOf(cookie: string): string[] {
  return cookie.split("; ").slice(1);
}

const NOW = 1_800_000_000_000;

/**
 * The co-parent rights session (contract §5.2, §6.4; K.2): a 256-bit
 * secret that lives only in a host-only, HttpOnly, SameSite=Strict cookie,
 * stored as its sha256 alone, `__Host-` prefixed wherever a browser would
 * keep such a cookie.
 */
describe("rights session", () => {
  it("takes the __Host- name in production and a plain name elsewhere, because __Host- needs https", async () => {
    const production = await load("production");
    expect(production.RIGHTS_COOKIE_NAME).toBe("__Host-inherit-rights");
    const development = await load("development");
    expect(development.RIGHTS_COOKIE_NAME).toBe("inherit-rights");
    const test = await load("test");
    expect(test.RIGHTS_COOKIE_NAME).toBe("inherit-rights");
  });

  it("mints a 256-bit base64url secret that differs every time", async () => {
    const { newRightsSessionSecret } = await load();
    const first = newRightsSessionSecret();
    const second = newRightsSessionSecret();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });

  it("hashes the secret as sha256 hex, the only form the database sees", async () => {
    const { newRightsSessionSecret, rightsSessionHash } = await load();
    const secret = newRightsSessionSecret();
    const hash = rightsSessionHash(secret);
    expect(hash).toBe(sha256(secret));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(secret);
    expect(rightsSessionHash(secret)).toBe(hash);
    expect(rightsSessionHash(newRightsSessionSecret())).not.toBe(hash);
  });

  it("writes a host-only, HttpOnly, SameSite=Strict cookie whose Max-Age runs to the session's expiry", async () => {
    const { RIGHTS_COOKIE_NAME, newRightsSessionSecret, rightsCookie } = await load("development");
    const secret = newRightsSessionSecret();
    const cookie = rightsCookie(secret, new Date(NOW + 3600 * 1000), NOW);
    expect(cookie.startsWith(`${RIGHTS_COOKIE_NAME}=${secret}; `)).toBe(true);
    const attributes = attributesOf(cookie);
    expect(attributes).toContain("Path=/");
    expect(attributes).toContain("HttpOnly");
    expect(attributes).toContain("SameSite=Strict");
    expect(attributes).toContain("Max-Age=3600");
    expect(attributes).not.toContain("Secure");
    expect(attributes.some((attribute) => /^(Domain|Expires)=/i.test(attribute))).toBe(false);
    expect(attributes).toHaveLength(4);
  });

  it("adds Secure in production and never a Domain", async () => {
    const { RIGHTS_COOKIE_NAME, newRightsSessionSecret, rightsCookie } = await load("production");
    const secret = newRightsSessionSecret();
    const cookie = rightsCookie(secret, new Date(NOW + 24 * 3600 * 1000), NOW);
    expect(cookie.startsWith(`__Host-inherit-rights=${secret}; `)).toBe(true);
    expect(RIGHTS_COOKIE_NAME).toBe("__Host-inherit-rights");
    const attributes = attributesOf(cookie);
    expect(attributes).toContain("Secure");
    expect(attributes).toContain("Path=/");
    expect(attributes).toContain("HttpOnly");
    expect(attributes).toContain("SameSite=Strict");
    expect(attributes).toContain("Max-Age=86400");
    expect(attributes.some((attribute) => /^Domain=/i.test(attribute))).toBe(false);
  });

  it("rounds Max-Age down to whole seconds and never below zero", async () => {
    const { newRightsSessionSecret, rightsCookie } = await load();
    const secret = newRightsSessionSecret();
    expect(attributesOf(rightsCookie(secret, new Date(NOW + 1999), NOW))).toContain("Max-Age=1");
    expect(attributesOf(rightsCookie(secret, new Date(NOW - 1), NOW))).toContain("Max-Age=0");
  });

  it("reads the hash of exactly its own cookie from the Cookie header", async () => {
    const { RIGHTS_COOKIE_NAME, newRightsSessionSecret, readRightsSessionHash, rightsSessionHash } = await load();
    const secret = newRightsSessionSecret();
    const request = (cookie: string) =>
      new Request("https://www.inherit.bio/api/invitations/accept", { method: "POST", headers: { cookie } });
    expect(readRightsSessionHash(request(`${RIGHTS_COOKIE_NAME}=${secret}`))).toBe(rightsSessionHash(secret));
    expect(readRightsSessionHash(request(`a=1; ${RIGHTS_COOKIE_NAME}=${secret}; b=2`))).toBe(rightsSessionHash(secret));
    expect(readRightsSessionHash(request(`a=1;${RIGHTS_COOKIE_NAME}=${secret};b=2`))).toBe(rightsSessionHash(secret));
    // Another cookie whose name merely starts with ours is another cookie.
    expect(readRightsSessionHash(request(`${RIGHTS_COOKIE_NAME}-x=${secret}`))).toBeNull();
    expect(readRightsSessionHash(request(`x-${RIGHTS_COOKIE_NAME}=${secret}`))).toBeNull();
    // The first cookie of the exact name wins.
    const other = newRightsSessionSecret();
    expect(readRightsSessionHash(request(`${RIGHTS_COOKIE_NAME}=${secret}; ${RIGHTS_COOKIE_NAME}=${other}`))).toBe(
      rightsSessionHash(secret),
    );
  });

  it("reads nothing from a missing cookie or a value not shaped like a secret this deployment issued", async () => {
    const { RIGHTS_COOKIE_NAME, newRightsSessionSecret, readRightsSessionHash } = await load();
    const secret = newRightsSessionSecret();
    const request = (headers: Record<string, string>) =>
      new Request("https://www.inherit.bio/api/invitations/accept", { method: "POST", headers });
    expect(readRightsSessionHash(request({}))).toBeNull();
    expect(readRightsSessionHash(request({ cookie: "" }))).toBeNull();
    expect(readRightsSessionHash(request({ cookie: "a=1; b=2" }))).toBeNull();
    expect(readRightsSessionHash(request({ cookie: `${RIGHTS_COOKIE_NAME}=` }))).toBeNull();
    expect(readRightsSessionHash(request({ cookie: `${RIGHTS_COOKIE_NAME}=${secret.slice(1)}` }))).toBeNull();
    expect(readRightsSessionHash(request({ cookie: `${RIGHTS_COOKIE_NAME}=${secret}=` }))).toBeNull();
    expect(readRightsSessionHash(request({ cookie: `${RIGHTS_COOKIE_NAME}=${secret.slice(0, 42)}+` }))).toBeNull();
    expect(readRightsSessionHash(request({ cookie: RIGHTS_COOKIE_NAME }))).toBeNull();
  });

  it("hashes a well-formed invitation token and refuses any other shape", async () => {
    const { invitationTokenHash } = await load();
    const token = crypto.randomBytes(32).toString("base64url");
    expect(token).toHaveLength(43);
    expect(invitationTokenHash(token)).toBe(sha256(token));
    expect(invitationTokenHash(token.slice(1))).toBeNull();
    expect(invitationTokenHash(`${token}A`)).toBeNull();
    expect(invitationTokenHash(`${token.slice(0, 42)}+`)).toBeNull();
    expect(invitationTokenHash(`${token.slice(0, 42)} `)).toBeNull();
    expect(invitationTokenHash("")).toBeNull();
  });
});
