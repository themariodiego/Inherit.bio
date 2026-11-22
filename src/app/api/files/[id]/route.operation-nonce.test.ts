import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * api.file-delete's one-time value and the order of its refusals (G8.5, 20
 * November 2026; owner decision of 19 November 2026, "where the register is
 * stricter, engineering codes to it"), through the real route handler and the
 * real one-time X-Inherit-CSRF gate. Only the auth read, the database and
 * Storage are doubles. The database double keeps the rules
 * supabase/tests/file_delete_operation_nonce.sql holds the real door to: the
 * door spends a value once, in the same transaction as the deletion's first
 * write, so a refused deletion spends nothing and a spent value is refused
 * before the deletion is touched.
 */

const ORIGIN = "https://inherit.test";
const OWNER = "8e1d0000-0000-4000-8000-0000000000a1";
const SESSION = "8e1d0000-0000-4000-8000-0000000000b1";
const OTHER_SESSION = "8e1d0000-0000-4000-8000-0000000000b2";
const FILE = "8e1d0000-0000-4000-8000-0000000000c1";
const OTHER_FILE = "8e1d0000-0000-4000-8000-0000000000c2";
const sha256 = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");

type FileState = "present" | "processing" | "deleting" | "gone";
const state = vi.hoisted(() => ({
  signedIn: true,
  /** Each read of the account context, by the gate or the handler. */
  contextReads: 0,
  csrfSpent: new Set<string>(),
  csrfCalls: 0,
  nonceSpent: new Set<string>(),
  files: new Map<string, string>(),
  /** Every database call other than the CSRF spend, in order. */
  calls: [] as { name: string; args: Record<string, unknown> }[],
  /** Each time the deletion itself was touched: a prepare that ran, or a finish. */
  writes: 0,
  removes: [] as string[][],
  doorAbsent: false,
  doorError: null as null | { code: string; message: string },
  drainCompletes: true,
}));

function prepare(args: Record<string, unknown>) {
  const file = state.files.get(String(args.p_file_id));
  if (args.p_account_id !== OWNER || !file || file === "gone") return { data: null, error: { code: "P0002", message: "file_delete_not_found" } };
  if (file === "processing") return { data: null, error: { code: "55000", message: "file_delete_processing" } };
  state.writes += 1;
  state.files.set(String(args.p_file_id), "deleting");
  const complete = state.drainCompletes;
  return { data: { version: "own-prepared-file-cleanup-v1", original: { token: "8e1d0000-0000-4000-8000-0000000000d1", bucket: "genomes",
    name: `${OWNER}/${args.p_file_id}` }, cleanupId: complete ? null : "8e1d0000-0000-4000-8000-0000000000e1", preparedComplete: complete }, error: null };
}

function answer(name: string, args: Record<string, unknown>): { data: unknown; error: unknown } {
  if (name === "consume_session_csrf_v1") {
    state.csrfCalls += 1;
    const fresh = !state.csrfSpent.has(String(args.p_token_hash));
    state.csrfSpent.add(String(args.p_token_hash));
    return { data: fresh, error: null };
  }
  state.calls.push({ name, args });
  if (name === "prepare_own_prepared_file_cleanup_with_nonce_v1") {
    if (state.doorAbsent) return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    if (state.doorError) return { data: null, error: state.doorError };
    const hash = String(args.p_nonce_hash);
    if (!/^[0-9a-f]{64}$/u.test(hash) || state.nonceSpent.has(hash)) {
      return { data: null, error: { code: "22023", message: "invalid_operation_nonce" } };
    }
    const prepared = prepare(args);
    // One transaction: the value is spent only with the deletion's first write.
    if (!prepared.error) state.nonceSpent.add(hash);
    return prepared;
  }
  if (name === "prepare_own_prepared_file_cleanup_v1") return prepare(args);
  if (name === "finish_genome_file_deletion_v1") {
    state.writes += 1;
    state.files.set(String(args.p_file_id), "gone");
    return { data: null, error: null };
  }
  return { data: null, error: { code: "XX000", message: "unexpected call" } };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      const result = Promise.resolve(answer(name, args));
      return Object.assign(result, { abortSignal: () => result });
    },
    storage: { from: () => ({ remove: async (names: string[]) => { state.removes.push(names); return { data: [], error: null }; } }) },
  }),
}));
vi.mock("@/lib/account-deletion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/account-deletion")>()),
  getSensitiveAccountContext: vi.fn(async () => {
    state.contextReads += 1;
    return state.signedIn ? { user: { id: OWNER }, sessionId: SESSION } : null;
  }),
}));
vi.mock("@/lib/genome/prepared-source/cleanup", () => ({
  drainOwnPreparedCleanup: async () => ({ completed: false, pending: true, processed: 1, failed: false, unresolved: false }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => undefined, delete: () => undefined, has: () => false }),
  headers: async () => new Headers(),
}));

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
afterAll(() => vi.unstubAllEnvs());
const { DELETE } = await import("./route");
const { mintSessionCsrf } = await import("@/lib/security/session-csrf-core");
const { mintPersonOperationNonce, verifyPersonOperationNonce, PERSON_OPERATION_NONCE_LIFETIME_MS } = await import("@/lib/person-operation-nonce-core");

type Mint = Partial<{ accountId: string; sessionId: string; operation: "file_delete" | "consent_revoke"; targetId: string; now: number }>;
/** A value as the Files page mints it, for this account, session and file unless told otherwise. */
const value = (mint: Mint = {}) => mintPersonOperationNonce({ accountId: mint.accountId ?? OWNER, sessionId: mint.sessionId ?? SESSION,
  operation: mint.operation ?? "file_delete", targetId: mint.targetId ?? FILE }, mint.now ?? Date.now());
const csrf = () => mintSessionCsrf({ kind: "authenticated", accountId: OWNER, sessionId: SESSION }, "api.file-delete");

interface Sent { file?: string; origin?: string | null; site?: string | null; csrf?: string | null; nonce?: string | null }
async function send(sent: Sent = {}): Promise<Response> {
  const headers = new Headers();
  const origin = sent.origin === undefined ? ORIGIN : sent.origin;
  if (origin !== null) headers.set("origin", origin);
  const site = sent.site === undefined ? "same-origin" : sent.site;
  if (site !== null) headers.set("sec-fetch-site", site);
  const token = sent.csrf === undefined ? csrf() : sent.csrf;
  if (token !== null) headers.set("x-inherit-csrf", token);
  const nonce = sent.nonce === undefined ? value({ targetId: sent.file ?? FILE }) : sent.nonce;
  if (nonce !== null) headers.set("x-inherit-operation-nonce", nonce);
  const file = sent.file ?? FILE;
  return DELETE(new Request(`${ORIGIN}/api/files/${file}`, { method: "DELETE", headers }), { params: Promise.resolve({ id: file }) });
}
async function expectForbidden(response: Response) {
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "request_forbidden" });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
}
const deletionCalls = () => state.calls.filter(call => call.name !== "consume_session_csrf_v1");

beforeEach(() => {
  state.signedIn = true;
  state.contextReads = 0;
  state.csrfSpent.clear();
  state.csrfCalls = 0;
  state.nonceSpent.clear();
  state.files = new Map<string, FileState>([[FILE, "present"], [OTHER_FILE, "present"]]);
  state.calls.length = 0;
  state.writes = 0;
  state.removes.length = 0;
  state.doorAbsent = false;
  state.doorError = null;
  state.drainCompletes = true;
});

describe("the order of api.file-delete's refusals", () => {
  it("refuses another origin before the account context is read or the session's token is spent (policy.sameOriginRequired)", async () => {
    for (const sent of [{ origin: "https://example.invalid" }, { origin: "http://inherit.test" },
      { origin: null, site: "cross-site" }, { origin: null, site: null }] as Sent[]) {
      await expectForbidden(await send(sent));
    }
    expect(state.contextReads, "no account context read").toBe(0);
    expect(state.csrfCalls, "no session token spent").toBe(0);
    expect(deletionCalls()).toEqual([]);
    // Signed out, the origin refusal still comes first.
    state.signedIn = false;
    await expectForbidden(await send({ origin: "https://example.invalid" }));
    expect(state.contextReads).toBe(0);
  });

  it("then the session's token, then the route id, the account and the one-time value, each before the database is asked", async () => {
    await expectForbidden(await send({ csrf: null }));
    expect(deletionCalls()).toEqual([]);
    state.signedIn = false;
    const signedOut = await send();
    expect([signedOut.status, await signedOut.json()]).toEqual([401, { error: "unauthenticated" }]);
    state.signedIn = true;
    await expectForbidden(await send({ nonce: null }));
    expect(state.csrfCalls, "the value is checked after the token is admitted").toBe(1);
    expect(deletionCalls(), "nothing reached the deletion").toEqual([]);
    expect(state.files.get(FILE)).toBe("present");
  });
});

describe("api.file-delete's one-time value", () => {
  it("refuses a missing, malformed, expired, cross-file, cross-session or cross-operation value before any deletion", async () => {
    const refused: [string, string | null][] = [
      ["missing", null],
      ["malformed", "not-a-value"],
      ["expired", value({ now: Date.now() - PERSON_OPERATION_NONCE_LIFETIME_MS - 1_000 })],
      ["minted for another file", value({ targetId: OTHER_FILE })],
      ["minted for the account's other session", value({ sessionId: OTHER_SESSION })],
      ["minted for another operation on this id", value({ operation: "consent_revoke" })],
    ];
    for (const [label, nonce] of refused) {
      const response = await send({ nonce });
      expect(response.status, label).toBe(403);
      expect(await response.json(), label).toEqual({ error: "request_forbidden" });
    }
    expect(deletionCalls(), "the database was never asked").toEqual([]);
    expect(state.writes).toBe(0);
    expect(state.removes).toEqual([]);
    expect([...state.files.values()]).toEqual(["present", "present"]);
  });

  it("deletes with the genuine value, spent by the door that starts the deletion, in its first call", async () => {
    const nonce = value();
    const response = await send({ nonce });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(deletionCalls().map(call => call.name)).toEqual(["prepare_own_prepared_file_cleanup_with_nonce_v1", "finish_genome_file_deletion_v1"]);
    const [door] = deletionCalls();
    expect(door!.args).toEqual({ p_account_id: OWNER, p_session_id: SESSION, p_file_id: FILE, p_nonce_hash: sha256(nonce),
      p_nonce_expires_at: new Date(Number(nonce.split(".")[0])).toISOString() });
    expect(JSON.stringify(state.calls)).not.toContain(nonce);
    expect(state.removes).toEqual([[`${OWNER}/${FILE}`]]);
    expect(state.files.get(FILE)).toBe("gone");
    expect(state.files.get(OTHER_FILE)).toBe("present");
    expect([...state.nonceSpent]).toEqual([sha256(nonce)]);
  });

  it("refuses a spent value, for the same file or another, before the deletion is touched", async () => {
    state.drainCompletes = false;
    const nonce = value();
    const pending = await send({ nonce });
    expect(pending.status).toBe(202);
    expect(await pending.json()).toEqual({ error: "file_delete_pending" });
    const writes = state.writes;
    await expectForbidden(await send({ nonce }));
    expect(state.writes, "the replay touched nothing").toBe(writes);
    expect(state.removes).toEqual([]);
    // The same value for another file: its MAC binds this file, so the route
    // refuses it before the database (the door refuses the spent hash for
    // another file too: supabase/tests/file_delete_operation_nonce.sql).
    state.calls.length = 0;
    await expectForbidden(await send({ file: OTHER_FILE, nonce }));
    expect(deletionCalls(), "the MAC binds the file: the route refuses before the database").toEqual([]);
    expect(state.files.get(OTHER_FILE)).toBe("present");
  });

  it("issues the next value with a pending answer, which the repeat spends and the deletion finishes with", async () => {
    state.drainCompletes = false;
    const first = value();
    const pending = await send({ nonce: first });
    expect(pending.status).toBe(202);
    const next = pending.headers.get("x-inherit-operation-nonce");
    expect(next).not.toBeNull();
    expect(next).not.toBe(first);
    expect(verifyPersonOperationNonce(next, { accountId: OWNER, sessionId: SESSION, operation: "file_delete", targetId: FILE })).not.toBeNull();
    expect(verifyPersonOperationNonce(next, { accountId: OWNER, sessionId: SESSION, operation: "file_delete", targetId: OTHER_FILE })).toBeNull();
    state.drainCompletes = true;
    const finished = await send({ nonce: next });
    expect(finished.status).toBe(204);
    expect([...state.nonceSpent]).toEqual([sha256(first), sha256(next!)]);
    // Only a pending answer issues one.
    expect(finished.headers.get("x-inherit-operation-nonce")).toBeNull();
  });

  it("spends nothing when the deletion is refused, so the same value works once the refusal clears", async () => {
    state.files.set(FILE, "processing");
    const nonce = value();
    const refused = await send({ nonce });
    expect([refused.status, await refused.json()]).toEqual([409, { error: "file_delete_processing" }]);
    expect(state.nonceSpent.size).toBe(0);
    state.files.set(FILE, "present");
    expect((await send({ nonce })).status).toBe(204);
  });

  it("before 20261120110000 is applied, falls back to the unchanged door only when the door is absent", async () => {
    state.doorAbsent = true;
    const nonce = value();
    expect((await send({ nonce })).status).toBe(204);
    expect(deletionCalls().map(call => call.name)).toEqual(["prepare_own_prepared_file_cleanup_with_nonce_v1",
      "prepare_own_prepared_file_cleanup_v1", "finish_genome_file_deletion_v1"]);
    expect(deletionCalls()[1]!.args).toEqual({ p_account_id: OWNER, p_session_id: SESSION, p_file_id: FILE });
    // The value is still verified first: a foreign one never reaches either door.
    state.calls.length = 0;
    state.files.set(FILE, "present");
    await expectForbidden(await send({ nonce: value({ targetId: OTHER_FILE }) }));
    expect(deletionCalls()).toEqual([]);
    // Any other error refuses; nothing falls back.
    state.doorAbsent = false;
    for (const error of [{ code: "XX000", message: "connection lost" }, { code: "42501", message: "permission denied for function" }]) {
      state.calls.length = 0;
      state.doorError = error;
      const response = await send();
      expect(response.status).toBe(503);
      expect(deletionCalls().map(call => call.name)).toEqual(["prepare_own_prepared_file_cleanup_with_nonce_v1"]);
    }
    expect(state.files.get(FILE)).toBe("present");
  });
});
