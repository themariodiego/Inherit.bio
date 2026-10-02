import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
const { getSensitiveAccountContextFromClient } = await import("../../src/lib/account-deletion");
const { mintAccountOperationNonce, hashOperationNonce } = {
  ...await import("../../src/lib/account-operation-nonce"), ...await import("../../src/lib/account-deletion"),
};
const { verifyHistoricalAccountAuthority, historicalAccountCreationSql } = await import("./historical-account-authority");
const { decryptSecret, hmacSecret } = await import("../../src/lib/crypto");
afterEach(() => vi.restoreAllMocks());
afterAll(() => vi.unstubAllEnvs());

const accountId = "10000000-0000-4000-8000-000000000001";
const sessionId = "10000000-0000-4000-8000-000000000002";
const otherId = "10000000-0000-4000-8000-000000000003";
const now = 1_800_000_000_000;
type Client = Parameters<typeof getSensitiveAccountContextFromClient>[0];
function sdk(change: { account?: string; session?: string; claimsAccount?: string; claimsSession?: string;
  role?: string; noUser?: boolean; noSession?: boolean; claimsError?: boolean } = {}): Client {
  const user = change.noUser ? null : { id: change.account ?? accountId, email: " Synthetic-Parent@example.invalid " };
  const token = `header.${Buffer.from(JSON.stringify({ session_id: change.session ?? sessionId })).toString("base64url")}.signature`;
  const client = { auth: {
    async getUser() { expect(this).toBe(client.auth); return { data: { user }, error: null }; },
    async getSession() { expect(this).toBe(client.auth); return { data: { session: change.noSession ? null : { access_token: token } }, error: null }; },
    async getClaims() { expect(this).toBe(client.auth); return { data: { claims: {
      sub: change.claimsAccount ?? change.account ?? accountId, session_id: change.claimsSession ?? change.session ?? sessionId,
      role: change.role ?? "authenticated" } }, error: change.claimsError ? new Error("Synthetic SDK refusal") : null }; },
  } };
  return client as unknown as Client;
}
function observation(nonce = mintAccountOperationNonce({ accountId, sessionId, operation: "account_delete" }, now)) {
  return { accountId, observation: { method: "POST", url: "http://127.0.0.1:3105/api/account/delete",
    headers: { origin: "http://127.0.0.1:3105", fetchSite: "same-origin", contentType: "application/json" },
    body: { confirmation: "account.delete.confirmation", nonce }, outcome: "observed-aborted-before-dispatch" },
  cookies: [{ name: "synthetic-cookie", value: "unit-fixture-only" }] };
}

describe("historical fixture verifier unit proofs do not claim SDK network or native execution", () => {
  it("uses the actual nonce MAC verifier and protected contact after matching SDK results", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const input = observation();
    const authority = await verifyHistoricalAccountAuthority(input, sdk());
    expect(Object.keys(authority).sort()).toEqual(["accountId", "sessionId", "nonceHash", "nonceExpiresAt", "ciphertextHex", "contactHmac", "idempotencyKey"].sort());
    expect(authority.accountId).toBe(accountId); expect(authority.sessionId).toBe(sessionId);
    expect(authority.nonceHash).toBe(hashOperationNonce(input.observation.body.nonce));
    expect(Date.parse(authority.nonceExpiresAt)).toBe(now + 600_000);
    expect(decryptSecret(Buffer.from(authority.ciphertextHex, "hex"))).toBe("synthetic-parent@example.invalid");
    expect(authority.contactHmac).toBe(hmacSecret("synthetic-parent@example.invalid", "contact-email-v1"));
    expect(JSON.stringify(authority).includes(input.observation.body.nonce)).toBe(false);
    expect(JSON.stringify(authority).includes(input.cookies[0].value)).toBe(false);
  });
  it("refuses mismatching actual SDK account/session/claims and network errors", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    for (const changed of [{ account: otherId }, { session: otherId }, { claimsAccount: otherId },
      { claimsSession: otherId }, { role: "service_role" }, { noUser: true }, { noSession: true }, { claimsError: true }])
      await expect(verifyHistoricalAccountAuthority(observation(), sdk(changed))).rejects.toThrow("Historical request unavailable");
  });
  it("rejects an expired, altered, crossed-account/session or cancel-operation signed nonce", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const valid = observation().observation.body.nonce;
    const changed = `${valid.slice(0, -1)}${valid.endsWith("a") ? "b" : "a"}`;
    expect(changed === valid).toBe(false);
    for (const nonce of [changed,
      mintAccountOperationNonce({ accountId, sessionId, operation: "account_delete" }, now - 600_000),
      mintAccountOperationNonce({ accountId: otherId, sessionId, operation: "account_delete" }, now),
      mintAccountOperationNonce({ accountId, sessionId: otherId, operation: "account_delete" }, now),
      mintAccountOperationNonce({ accountId, sessionId, operation: "account_delete_cancel" }, now)])
      await expect(verifyHistoricalAccountAuthority(observation(nonce), sdk())).rejects.toThrow("Historical request unavailable");
  });
  it("refuses extra clocks/authority, altered native body and cross-origin CSRF", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const input = observation();
    for (const changed of [{ ...input, requestedAt: "2000-01-01T00:00:00Z" },
      { ...input, observation: { ...input.observation, outcome: "HTTP202" } },
      { ...input, observation: { ...input.observation, headers: { ...input.observation.headers, origin: "https://example.invalid" } } },
      { ...input, observation: { ...input.observation, headers: { ...input.observation.headers, origin: null, fetchSite: "cross-site" } } },
      { ...input, observation: { ...input.observation, body: { ...input.observation.body, accountId } } },
      { ...input, observation: { ...input.observation, body: { ...input.observation.body, confirmation: "yes" } } }])
      await expect(verifyHistoricalAccountAuthority(changed, sdk())).rejects.toThrow();
  });
  it("preserves parallel getUser/getSession calls and original result/error semantics with their receivers", async () => {
    let releaseUser: (value: unknown) => void = () => undefined;
    let releaseSession: (value: unknown) => void = () => undefined;
    const calls: string[] = [];
    const client = { auth: {
      getUser() { expect(this).toBe(client.auth); calls.push("user"); return new Promise(resolve => { releaseUser = resolve; }); },
      getSession() { expect(this).toBe(client.auth); calls.push("session"); return new Promise(resolve => { releaseSession = resolve; }); },
    } };
    const pending = getSensitiveAccountContextFromClient(client as unknown as Client);
    expect(calls).toEqual(["user", "session"]);
    releaseUser({ data: { user: { id: accountId } }, error: null });
    releaseSession({ data: { session: { access_token: `header.${Buffer.from(JSON.stringify({ session_id: sessionId })).toString("base64url")}.signature` } }, error: null });
    expect(await pending).toEqual({ user: { id: accountId }, sessionId });
    expect(await getSensitiveAccountContextFromClient(sdk({ noUser: true }))).toBeNull();
    expect(await getSensitiveAccountContextFromClient(sdk({ noSession: true }))).toBeNull();
    const networkError = new Error("Synthetic network error");
    const refusal = { auth: { getUser() { return Promise.reject(networkError); }, getSession() { return Promise.resolve({ data: { session: null } }); } } };
    await expect(getSensitiveAccountContextFromClient(refusal as unknown as Client)).rejects.toBe(networkError);
  });
  it("mechanically reconstructs the exact ordinary source and keeps the HTTP route unchanged", () => {
    const frozen = "59c9715263c37d36e3be28f1b4557b01efdbb09e";
    const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
    const original = (path: string) => execFileSync("git", ["show", `${frozen}:${path}`], { cwd: new URL("../..", import.meta.url), encoding: "utf8" });
    const current = read("src/lib/account-deletion.ts");
    const start = current.indexOf('  return getSensitiveAccountContextFromClient(supabase);');
    const end = current.indexOf("  const [userResult, sessionResult] = await Promise.all([", start);
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
    expect(current.slice(0, start) + current.slice(end)).toBe(original("src/lib/account-deletion.ts"));
    for (const path of ["src/app/api/account/delete/route.ts", "e2e/helpers/claimed-provenance-native-request.ts",
      "scripts/tools/claimed-provenance-fixture.ts", "scripts/claimed-provenance-independent-sessions.mjs"])
      expect(read(path)).toBe(original(path));
  });
  it("captures the database time once, consumes only verified hash/expiry and keeps current security clocks in SQL", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const authority = await verifyHistoricalAccountAuthority(observation(), sdk());
    const sql = historicalAccountCreationSql(authority);
    expect(sql.match(/select clock_timestamp\(\) actual_at/gu)).toHaveLength(1);
    expect(sql.match(/private\.request_account_deletion_at_v1\(/gu)).toHaveLength(1);
    expect(sql).toContain("actual_at-interval '7 days 10 minutes'");
    expect(sql).toContain("d.created_at>=captured.actual_at");
    expect(sql).toContain("private.assert_account_affected_notice_receipt_v1(");
    expect(sql).toContain("set constraints all immediate");
    expect(sql).not.toMatch(/update public\.|set_config|grant |session_replication_role|disable trigger/iu);
    expect(() => historicalAccountCreationSql({ ...authority, now: 0 } as typeof authority)).toThrow();
  });
});
