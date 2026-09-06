import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mintPublicFormToken } from "./operation-token";
import { mintRightsActivationCandidate, readRightsActivationCandidate, RIGHTS_CANDIDATE_COOKIE } from "./rights-activation";

const NOW = 1_800_000_000_000;
beforeEach(() => vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64")));
afterEach(() => vi.unstubAllEnvs());

function activation(cookie: string, overrides: Record<string, string | null> = {}) {
  const headers = new Headers({
    origin: "https://inherit.bio",
    "sec-fetch-site": "same-origin",
    "content-type": "application/json",
    cookie,
  });
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) headers.delete(name);
    else headers.set(name, value);
  }
  return new Request("https://inherit.bio/api/rights/activate", { method: "POST", headers });
}

describe("non-authorizing rights activation candidate", () => {
  it("issues a fresh HttpOnly browser cookie and a form bound only to its hash", () => {
    const first = mintRightsActivationCandidate(NOW);
    const second = mintRightsActivationCandidate(NOW);
    expect(first.setCookie).not.toBe(second.setCookie);
    expect(first.setCookie).toContain("HttpOnly; SameSite=Strict");
    expect(first.setCookie).toContain("Path=/; Max-Age=600");
    expect(first.setCookie).not.toContain("Domain=");
    const secret = first.setCookie.split(";")[0].split("=")[1];
    const payload = JSON.parse(Buffer.from(first.formToken.split(".")[0], "base64url").toString("utf8"));
    expect(payload.candidateHash).toBe(crypto.createHash("sha256").update(secret).digest("hex"));
    expect(JSON.stringify(payload)).not.toContain(secret);
    expect(Object.keys(payload).sort()).toEqual(["candidateHash", "expiresAt", "form", "nonce"]);
  });

  it("accepts only the corresponding browser/form pair, without consuming anything", () => {
    const first = mintRightsActivationCandidate(NOW);
    const second = mintRightsActivationCandidate(NOW);
    const request = activation(first.setCookie.split(";")[0]);
    const result = readRightsActivationCandidate(request, first.formToken, NOW);
    expect(result?.nonce).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    expect(readRightsActivationCandidate(request, first.formToken, NOW)).toEqual(result);
    expect(readRightsActivationCandidate(request, second.formToken, NOW)).toBeNull();
    expect(readRightsActivationCandidate(request, mintPublicFormToken("rights-activate", NOW), NOW)).toBeNull();
  });

  for (const [name, value] of [
    ["origin", null], ["origin", "https://elsewhere.example"],
    ["sec-fetch-site", null], ["sec-fetch-site", "cross-site"], ["sec-fetch-site", "same-site"],
    ["content-type", null], ["content-type", "text/plain"], ["cookie", null],
  ] as const) {
    it(`rejects ${name}=${String(value)} even with a valid form`, () => {
      const candidate = mintRightsActivationCandidate(NOW);
      expect(readRightsActivationCandidate(
        activation(candidate.setCookie.split(";")[0], { [name]: value }), candidate.formToken, NOW,
      )).toBeNull();
    });
  }

  it("rejects duplicate, malformed, prefixed and expired candidates", () => {
    const candidate = mintRightsActivationCandidate(NOW);
    const cookie = candidate.setCookie.split(";")[0];
    for (const invalid of [`${cookie}; ${cookie}`, `${RIGHTS_CANDIDATE_COOKIE}=short`, `prefix-${cookie}`]) {
      expect(readRightsActivationCandidate(activation(invalid), candidate.formToken, NOW)).toBeNull();
    }
    expect(readRightsActivationCandidate(activation(cookie), candidate.formToken, NOW + 600_000)).toBeNull();
    expect(readRightsActivationCandidate(activation(cookie), candidate.formToken + "x", NOW)).toBeNull();
  });

  it("does not treat an ordinary GET or a prefetch as activation", () => {
    const candidate = mintRightsActivationCandidate(NOW);
    const post = activation(candidate.setCookie.split(";")[0]);
    const get = new Request(post.url, { headers: post.headers });
    expect(readRightsActivationCandidate(get, candidate.formToken, NOW)).toBeNull();
  });

  it("uses the host-prefixed Secure cookie for the production build", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const production = await import("./rights-activation");
    const candidate = production.mintRightsActivationCandidate(NOW);
    expect(candidate.setCookie).toMatch(/^__Host-inherit-rights-candidate=/u);
    expect(candidate.setCookie).toContain("; Secure");
    expect(candidate.setCookie).not.toContain("Domain=");
    expect(production.readRightsActivationCandidate(
      activation(candidate.setCookie.split(";")[0]), candidate.formToken, NOW,
    )).not.toBeNull();
  });
});
