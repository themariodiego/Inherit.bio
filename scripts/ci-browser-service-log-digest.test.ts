import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DIGEST_LINE, digestPath, digestServiceLog } from "./ci-browser-service-log-digest";

// Credential-shaped values are assembled at run time, so this file never
// carries one for the repository's secret gate to find.
const jwt = ["ey", "JhbGciOiJFUzI1NiIsImtpZCI6Ik", ".", "ey", "JzdWIiOiIxMjM0NTY3ODkwIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ", ".", "c2lnbmF0dXJlc2lnbmF0dXJlc2ln"].join("");
const refresh = ["v2nn", "3jnx", "mqcy"].join("");
const platformKey = ["sb", "secret", "AbCdEfGhIjKlMnOpQrStUv"].join("_");
const password = ["e2e", "figures", "family-a", "pw"].join("-");
const email = ["figures-family-a-1-0b5c1e1e-2f7c-4d43-9a7a-4b8f0f6c2b11", "e2e.local"].join("@");
const userId = "7b04cb23-d8c3-4624-8228-d11853ab811d";
const PLANTED = [jwt, refresh, platformKey, password, email, userId, "Bearer", "172.18.0.1", "Mozilla", "too many clients", "127.0.0.1"];

const at = (n: number) => `2026-11-19T17:41:${String(n).padStart(2, "0")}.123456789Z`;
const auth = (n: number, record: Record<string, unknown>) => `${at(n)} ${JSON.stringify(record)}`;
const kong = (n: number, line: string) => `${at(n)} ${line}`;

const AUTH_RAW = [
  auth(1, { component: "api", duration: 3_200_000, level: "info", method: "GET", msg: "request completed", path: "/user",
    referer: "http://localhost:3100", remote_addr: "172.18.0.1", request_id: "1f2e", status: 200, time: "t" }),
  auth(2, { component: "api", duration: 12_400_000, error: "failed to connect to `host=db user=supabase_auth_admin`: server error (FATAL: sorry, too many clients already (SQLSTATE 53300))",
    error_code: "unexpected_failure", level: "error", method: "GET", msg: "request completed", path: "/user", status: 500, time: "t" }),
  auth(3, { component: "api", error: `session id (${userId}) doesn't exist`, error_code: "session_not_found", level: "warning",
    method: "GET", msg: "request completed", path: "/user", status: 403, user_id: userId, authorization: `Bearer ${jwt}` }),
  auth(4, { auth_audit_event: { action: "login", actor_id: userId, actor_username: email, ip_address: "172.18.0.1",
    user_agent: "Mozilla/5.0", traits: { provider: "email" } }, level: "info", msg: "audit_event", time: "t" }),
  auth(5, { component: "api", method: "DELETE", path: `/admin/users/${userId}`, status: 500, error_code: "unexpected_failure",
    error: `ERROR: update or delete on table "users" violates foreign key constraint; Key (email)=(${email})` }),
  auth(6, { component: "api", method: "GET", path: `/verify?token=${refresh}&type=recovery&redirect_to=/next&pw=${password}`, status: 303 }),
  auth(7, { level: "error", component: "api", msg: `refresh token ${refresh} reuse detected for ${email}` }),
  auth(8, { level: "info", msg: "GoTrue API started on: 0.0.0.0:9999" }),
  "not a docker-stamped line",
  `${at(9)} not json at all ${jwt}`,
].join("\n");

const KONG_RAW = [
  kong(1, `172.18.0.1 - - [19/Nov/2026:17:41:01 +0000] "GET /auth/v1/user HTTP/1.1" 200 986 "-" "node"`),
  kong(2, `172.18.0.1 - ${email} [19/Nov/2026:17:41:02 +0000] "GET /realtime/v1/websocket?apikey=${jwt}&vsn=1.0.0 HTTP/1.1" 101 0 "http://localhost:3100/?code=${refresh}" "Mozilla/5.0 Bearer ${jwt}"`),
  kong(3, `172.18.0.1 - - [19/Nov/2026:17:41:03 +0000] "GET /rest/v1/profiles?select=id&email=eq.${email} HTTP/1.1" 200 2 "-" "postgrest-js"`),
  kong(4, `172.18.0.1 - - [19/Nov/2026:17:41:04 +0000] "GET /storage/v1/object/sign/genome-uploads/${userId}/${jwt}/file.vcf HTTP/1.1" 400 12 "-" "-"`),
  kong(5, `2026/11/19 17:41:05 [error] 1101#0: *42 connect() failed (111: Connection refused) while connecting to upstream, client: 172.18.0.1, server: kong, request: "GET /auth/v1/user?apikey=${platformKey} HTTP/1.1", upstream: "http://172.18.0.4:9999/user", host: "127.0.0.1:54321"`),
  kong(6, "2026/11/19 17:41:06 [notice] 1#0: signal 1 (SIGHUP) received from 33, reconfiguring"),
  kong(7, "2026/11/19 17:41:07 [notice] 7014#0: gracefully shutting down"),
  kong(8, "2026/11/19 17:41:08 [notice] 1#0: start worker process 7108"),
  kong(9, `2026/11/19 17:41:09 [crit] 15332#0: *24735 [lua] targets.lua:248: could not reschedule DNS resolver timer: process exiting, context: ngx.timer, password=${password}`),
].join("\n");

describe("service log digest: what survives", () => {
  it("keeps only time, method, a query-free path, status, an error code and a duration from the auth service", () => {
    const lines = digestServiceLog("auth", AUTH_RAW).trimEnd().split("\n");
    expect(lines).toEqual([
      "# digest auth read=10 kept=6 unparsed=1",
      `${at(1)} auth GET /user 200 ms=3`,
      `${at(2)} auth GET /user 500 error_code=unexpected_failure error_class=db_connections_exhausted ms=12`,
      `${at(3)} auth GET /user 403 error_code=session_not_found error_class=other`,
      `${at(5)} auth DELETE /admin/users/<id> 500 error_code=unexpected_failure error_class=other`,
      `${at(6)} auth GET /verify 303`,
      `${at(7)} auth level=error component=api error_class=other`,
    ]);
  });

  it("keeps only method, a query-free path and status from the gateway, and names its failures and reloads by enum", () => {
    const lines = digestServiceLog("kong", KONG_RAW).trimEnd().split("\n");
    expect(lines).toEqual([
      "# digest kong read=9 kept=8 unparsed=0",
      `${at(1)} kong GET /auth/v1/user 200`,
      `${at(2)} kong GET /realtime/v1/websocket 101`,
      `${at(3)} kong GET /rest/v1/profiles 200`,
      `${at(4)} kong GET /storage/v1/object/sign/genome-uploads/<id>/<seg>/<seg> 400`,
      `${at(5)} kong level=error gateway_class=upstream_connect_failed GET /auth/v1/user`,
      `${at(6)} kong level=notice gateway_event=reload`,
      `${at(7)} kong level=notice gateway_event=worker_shutdown`,
      `${at(9)} kong level=crit gateway_class=dns`,
    ]);
  });

  it("never lets a planted credential, address, email, id or error text through", () => {
    const digest = digestServiceLog("auth", AUTH_RAW) + digestServiceLog("kong", KONG_RAW);
    for (const planted of PLANTED) expect(digest, planted.slice(0, 12)).not.toContain(planted);
    expect(digest).not.toMatch(/eyJ|[?&=@]token|apikey|bearer|password/i);
    for (const line of digest.trimEnd().split("\n")) expect(line).toMatch(DIGEST_LINE);
  });

  it("orders lines by time and keeps the newest when bounded", () => {
    const raw = [auth(3, { method: "GET", path: "/user", status: 200 }), auth(1, { method: "GET", path: "/user", status: 500 }),
      auth(2, { method: "POST", path: "/token", status: 200 })].join("\n");
    expect(digestServiceLog("auth", raw, 2).trimEnd().split("\n")).toEqual([
      "# digest auth read=3 kept=3 unparsed=0", `${at(2)} auth POST /token 200`, `${at(3)} auth GET /user 200`]);
  });
});

describe("service log digest: paths", () => {
  it("drops queries and fragments and replaces anything that is not a short lowercase word", () => {
    expect(digestPath("/auth/v1/user")).toBe("/auth/v1/user");
    expect(digestPath(`/auth/v1/verify?token=${refresh}#x`)).toBe("/auth/v1/verify");
    expect(digestPath(`/rest/v1/rpc/claim_mail_outbox`)).toBe("/rest/v1/rpc/claim_mail_outbox");
    expect(digestPath(`/a/${email}/${jwt}/${refresh}/Upper/file.vcf/42`)).toBe("/a/<seg>/<seg>/<seg>/<seg>/<seg>/42");
    expect(digestPath(`/admin/users/${userId.toUpperCase()}`)).toBe("/admin/users/<id>");
    expect(digestPath("auth/v1/user")).toBeNull();
    expect(digestPath(`http://172.18.0.4:9999/user?apikey=${platformKey}`)).toBeNull();
  });

  it("the closed grammar refuses a line that carries a query, an email, a token or free text", () => {
    for (const line of [`${at(1)} auth GET /user?apikey=x 200`, `${at(1)} auth GET /user/${email} 200`,
      `${at(1)} kong GET /a/${jwt} 200`, `${at(1)} auth level=error msg=too many clients`, `${at(1)} auth GET /User 200`])
      expect(line).not.toMatch(DIGEST_LINE);
  });
});

describe("service log digest: the workflow keeps it only as failure evidence", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  it("runs the digest before each failure-only evidence upload, and uploads only the digests", () => {
    for (const upload of ["Keep the failing browser evidence", "Keep safe failing browser evidence"]) {
      const step = workflow.slice(workflow.indexOf(`- name: ${upload}`));
      const block = step.slice(0, step.indexOf("\n      - name:", 1));
      expect(block).toContain("if: failure()");
      expect(block).toContain("test-results/service-logs/*.txt");
      expect(block).not.toMatch(/docker logs|service-logs\/\*\*?\s*$|service-logs\/\s*$/m);
      const before = workflow.slice(0, workflow.indexOf(`- name: ${upload}`));
      const digest = before.slice(before.lastIndexOf("- name: Digest this job's auth and gateway logs for failure evidence"));
      expect(digest).toContain("if: always()");
      expect(digest).toContain("INHERIT_JOB_STATUS: ${{ job.status }}");
      expect(digest).toContain("run: pnpm exec tsx scripts/ci-browser-service-log-digest.run.mts");
      expect(digest.startsWith("- name: Digest"), `${upload} needs a digest step before it`).toBe(true);
      expect(digest.includes("\n      - name:"), `${upload} must directly follow its digest`).toBe(false);
    }
  });
});
