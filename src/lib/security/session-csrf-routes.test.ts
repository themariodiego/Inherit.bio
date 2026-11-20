import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { csrfHeaderRequired as csrfHeaderRequiredOf } from "../../../scripts/form-contract-census";
import { SESSION_CSRF_ROUTES, SESSION_CSRF_STREAM_ROUTES, mintSessionCsrf, verifySessionCsrf, type CsrfRoute, type CsrfSession,
  type CsrfSessionKind } from "./session-csrf-core";

/**
 * Every route the one-time `X-Inherit-CSRF` token guards
 * (`SESSION_CSRF_ROUTES`), driven through its real route handler: a request
 * with no token, with a token already spent, with a token of another session
 * and with a token of another purpose is refused with the register's answer
 * (403 `request_forbidden` for an authenticated route, `authenticated-mutation-v1`;
 * 404 `not_found` for a purpose-session route, `token-api-v1` and
 * `token-candidate-api-v1`) before the handler runs, and the same request
 * with a fresh token reaches the handler and comes back carrying the next
 * token. The database's one spend (`public.consume_session_csrf_v1`) is
 * played by an in-memory double that keeps the same two rules: one spend per
 * hash, and an authenticated token only while its auth session is live.
 * `supabase/tests/session_csrf_tokens.sql` holds the real function to them.
 */

const KEY = Buffer.alloc(32, 11).toString("base64");
const ORIGIN = "https://inherit.test";
const ACCOUNT = "5a000000-0000-4000-8000-000000000001";
const SESSION = "5a000000-0000-4000-8000-000000000011";
const OTHER_SESSION = "5a000000-0000-4000-8000-000000000012";
const ID = "5a000000-0000-4000-8000-0000000000aa";
const RIGHTS_COOKIE_VALUE = "R".repeat(43);
const CANDIDATE_COOKIE_VALUE = "C".repeat(43);
// 2026-11-19 (G8.5, the migration stage): the four cookie kinds' cookies.
const CLAIM_COOKIE_VALUE = "L".repeat(43);
const RESET_COOKIE_VALUE = "S".repeat(43);
const INGEST_COOKIE_VALUE = "I".repeat(43);
const EVIDENCE_COOKIE_VALUE = "E".repeat(43);
const OTHER_COOKIE_VALUE = "O".repeat(43);
const sha256 = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");

const state = vi.hoisted(() => ({
  signedIn: true,
  spent: new Set<string>(),
  liveSessions: new Set<string>(),
  consumeCalls: [] as Record<string, unknown>[],
  consumeResults: [] as boolean[],
  /** Each time a handler reads the request body or reaches a database or auth client: the gate does neither. */
  touches: 0,
}));

/**
 * An inert query or RPC, so a handler that gets past the gate stops early: an
 * RPC chain resolves to a refusal, a table read to nothing found.
 */
function inert(kind: "rpc" | "read" = "rpc"): unknown {
  const result = kind === "rpc"
    ? { data: null, error: { code: "XX000", message: "inert test double" }, count: null, status: 500 }
    : { data: null, error: null, count: 0, status: 200 };
  const proxy: unknown = new Proxy(function () {}, {
    get: (_target, property) => property === "then"
      ? (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
      : () => proxy,
    apply: () => proxy,
  });
  return proxy;
}

/** The routes whose admitted response issues no successor: each ends the session the next token would be bound to. */
const NO_SUCCESSOR = new Set<CsrfRoute>(["auth.sign-out", "api.rights-activate"]);

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      // v1 for the three kinds of 20261024220000, v2 for the five later ones;
      // the same table, so the same one spend per hash.
      if (name !== "consume_session_csrf_v1" && name !== "consume_session_csrf_v2") { state.touches += 1; return inert(); }
      state.consumeCalls.push({ ...args, function: name });
      const account = args.p_session_kind === "authenticated" || args.p_session_kind === "reviewer";
      const live = !account || state.liveSessions.has(`${args.p_account_id}|${args.p_session_id}`);
      const hash = String(args.p_token_hash);
      const fresh = live && !state.spent.has(hash);
      if (fresh) state.spent.add(hash);
      state.consumeResults.push(fresh);
      return Promise.resolve({ data: fresh, error: null });
    },
    from: () => { state.touches += 1; return inert("read"); },
    get storage() { state.touches += 1; return inert(); },
    get auth() { state.touches += 1; return inert(); },
  }),
}));

vi.mock("@/lib/account-deletion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/account-deletion")>()),
  getSensitiveAccountContext: vi.fn(async () => state.signedIn
    ? { user: { id: ACCOUNT, email: "csrf-routes@example.invalid", email_confirmed_at: "2026-10-01T00:00:00Z" }, sessionId: SESSION }
    : null),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => (state.touches += 1, {
    auth: {
      getUser: async () => ({ data: { user: state.signedIn ? { id: ACCOUNT, email: "csrf-routes@example.invalid" } : null }, error: null }),
      getClaims: async () => ({ data: state.signedIn ? { claims: { sub: ACCOUNT, session_id: SESSION } } : null, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      signOut: async () => ({ error: null }),
    },
    from: () => inert("read"),
    rpc: () => inert(),
  }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => undefined, delete: () => undefined, has: () => false }),
  headers: async () => new Headers(),
}));

type Kind = CsrfSessionKind;
interface Case {
  /** The route whose token the request carries. */
  route: CsrfRoute;
  /** The kind of session the request carries, where the route takes a second one (SESSION_CSRF_SECOND_KINDS). */
  kind?: Kind;
  label?: string;
  method: "POST" | "PUT" | "DELETE";
  path: string;
  load: () => Promise<Record<string, unknown>>;
  params?: Record<string, string>;
  body?: string | null;
}

const CASES: Case[] = [
  { route: "auth.sign-out", method: "POST", path: "/auth/sign-out", load: () => import("@/app/auth/sign-out/route"), body: null },
  { route: "api.account-delete", method: "POST", path: "/api/account/delete", load: () => import("@/app/api/account/delete/route") },
  { route: "api.account-delete-cancel", method: "POST", path: "/api/account/delete/cancel", load: () => import("@/app/api/account/delete/cancel/route") },
  { route: "api.chat", method: "POST", path: "/api/chat", load: () => import("@/app/api/chat/route") },
  { route: "api.browse-region", method: "POST", path: "/api/browse/region", load: () => import("@/app/api/browse/region/route") },
  { route: "api.file-process", method: "POST", path: `/api/files/${ID}/process`, params: { id: ID }, load: () => import("@/app/api/files/[id]/process/route"), body: null },
  { route: "api.file-upload-session", method: "POST", path: "/api/files/upload-session", load: () => import("@/app/api/files/upload-session/route") },
  { route: "api.subject-upload-issue", method: "POST", path: "/api/uploads", load: () => import("@/app/api/uploads/route") },
  { route: "api.subject-upload-complete", method: "POST", path: `/api/uploads/${ID}/complete`, params: { id: ID }, load: () => import("@/app/api/uploads/[id]/complete/route"), body: null },
  { route: "api.file-delete", method: "DELETE", path: `/api/files/${ID}`, params: { id: ID }, load: () => import("@/app/api/files/[id]/route"), body: null },
  { route: "api.file-finalize", method: "POST", path: `/api/files/${ID}/finalize`, params: { id: ID }, load: () => import("@/app/api/files/[id]/finalize/route"), body: null },
  { route: "api.llm-settings", method: "POST", path: "/api/llm/settings", load: () => import("@/app/api/llm/settings/route") },
  { route: "api.llm-settings", method: "DELETE", path: "/api/llm/settings", load: () => import("@/app/api/llm/settings/route"), body: null },
  // 2026-11-19 (G8.5): every body is gated before it is read (it was the Path A body alone).
  { route: "api.subject-drafts", label: "api.subject-drafts (every body)", method: "POST", path: "/api/subject-drafts", load: () => import("@/app/api/subject-drafts/route") },
  { route: "api.subject-transfer", method: "POST", path: `/api/subjects/${ID}/transfer`, params: { id: ID }, load: () => import("@/app/api/subjects/[id]/transfer/route") },
  { route: "api.subject-delete", method: "DELETE", path: `/api/subjects/${ID}`, params: { id: ID }, load: () => import("@/app/api/subjects/[id]/route"), body: null },
  { route: "api.subject-sharing", method: "POST", path: `/api/subjects/${ID}/sharing`, params: { id: ID }, load: () => import("@/app/api/subjects/[id]/sharing/route") },
  { route: "api.chromosomal-sex", method: "POST", path: "/api/chromosomal-sex", load: () => import("@/app/api/chromosomal-sex/route") },
  { route: "api.family-acknowledge", method: "POST", path: "/api/family/acknowledge", load: () => import("@/app/api/family/acknowledge/route") },
  { route: "api.embryo-acknowledge", method: "POST", path: "/api/embryos/acknowledge", load: () => import("@/app/api/embryos/acknowledge/route") },
  { route: "api.family-sharing", method: "POST", path: "/api/family/s-person/sharing", params: { person: "s-person" }, load: () => import("@/app/api/family/[person]/sharing/route") },
  // 2026-11-19 (G8.5): every body is gated before it is read (it was the adult grant body alone).
  { route: "api.consents", label: "api.consents (every body)", method: "POST", path: "/api/consents", load: () => import("@/app/api/consents/route") },
  { route: "api.consent-reaffirm", method: "POST", path: "/api/consents/reaffirm", load: () => import("@/app/api/consents/reaffirm/route") },
  { route: "api.consent-revoke", method: "POST", path: `/api/consents/${ID}/revoke`, params: { id: ID }, load: () => import("@/app/api/consents/[id]/revoke/route"), body: null },
  { route: "api.consents-revoke-all", method: "POST", path: "/api/consents/revoke-all", load: () => import("@/app/api/consents/revoke-all/route") },
  { route: "api.invitation-accept", method: "POST", path: "/api/invitations/accept", load: () => import("@/app/api/invitations/accept/route") },
  { route: "api.adult-subject-bind", method: "POST", path: "/api/subjects/bind/session", load: () => import("@/app/api/subjects/bind/session/route") },
  { route: "api.embryo-cohorts", method: "POST", path: "/api/embryo-cohorts", load: () => import("@/app/api/embryo-cohorts/route") },
  { route: "api.embryo-record-key-cards", method: "POST", path: `/api/embryo-cohorts/${ID}/record-key-cards`, params: { id: ID }, load: () => import("@/app/api/embryo-cohorts/[id]/record-key-cards/route") },
  { route: "api.embryo-disposition", method: "POST", path: `/api/embryos/${ID}/disposition`, params: { id: ID }, load: () => import("@/app/api/embryos/[id]/disposition/route") },
  { route: "api.cohort-restrict", method: "POST", path: `/api/cohorts/${ID}/restrict`, params: { id: ID }, load: () => import("@/app/api/cohorts/[id]/restrict/route"), body: null },
  { route: "api.cohort-restrict", label: "api.embryo-withdraw (policy.aliasOf api.cohort-restrict)", method: "POST", path: `/api/embryo-cohorts/${ID}/withdraw`, params: { id: ID }, load: () => import("@/app/api/embryo-cohorts/[id]/withdraw/route"), body: null },
  { route: "api.claimed-subject-correction", method: "POST", path: `/api/subjects/${ID}/corrections`, params: { id: ID }, load: () => import("@/app/api/subjects/[id]/corrections/route") },
  { route: "api.claimed-subject-analysis-stop", method: "DELETE", path: `/api/subjects/${ID}/analysis`, params: { id: ID }, load: () => import("@/app/api/subjects/[id]/analysis/route"), body: null },
  { route: "api.jurisdiction", method: "PUT", path: "/api/settings/jurisdiction", load: () => import("@/app/api/settings/jurisdiction/route") },
  // 2026-11-19 (G8.5 stage one): four csrfOwnDesign rows moved onto the token.
  { route: "api.subjects", method: "POST", path: "/api/subjects", load: () => import("@/app/api/subjects/route") },
  { route: "api.future-person-claimant-bind", method: "POST", path: "/api/future-person/claim/session/account", load: () => import("@/app/api/future-person/claim/session/account/route") },
  // 2026-11-19 (G8.5 stage two): fourteen more whole csrfOwnDesign rows moved onto the token, with
  // api.consents' and api.subject-drafts' branch rows (above).
  { route: "api.account-completion", method: "POST", path: "/api/account/completion", load: () => import("@/app/api/account/completion/route") },
  { route: "api.invitations", method: "POST", path: "/api/invitations", load: () => import("@/app/api/invitations/route") },
  { route: "api.embryo-cohort-drafts", method: "POST", path: "/api/embryo-cohort-drafts", load: () => import("@/app/api/embryo-cohort-drafts/route") },
  { route: "api.legal-evidence-upload-session", method: "POST", path: "/api/legal-evidence/upload-session", load: () => import("@/app/api/legal-evidence/upload-session/route") },
  { route: "api.export", method: "POST", path: "/api/export", load: () => import("@/app/api/export/route") },
  { route: "api.subject-export", method: "POST", path: `/api/subjects/${ID}/export`, params: { id: ID }, load: () => import("@/app/api/subjects/[id]/export/route") },
  { route: "api.future-person-identity-profile", method: "PUT", path: `/api/embryos/${ID}/future-person-identity`, params: { id: ID }, load: () => import("@/app/api/embryos/[id]/future-person-identity/route") },
  { route: "api.future-person-identity-profile", method: "DELETE", path: `/api/embryos/${ID}/future-person-identity`, params: { id: ID }, load: () => import("@/app/api/embryos/[id]/future-person-identity/route"), body: null },
  { route: "api.embryo-record-key-cards-rights", method: "POST", path: "/api/rights/embryo-record-key-cards", load: () => import("@/app/api/rights/embryo-record-key-cards/route") },
  { route: "api.future-person-export", method: "POST", path: "/api/future-person/claim/session/export", load: () => import("@/app/api/future-person/claim/session/export/route") },
  { route: "api.future-person-recovery-key", method: "POST", path: "/api/future-person/claim/session/recovery-key", load: () => import("@/app/api/future-person/claim/session/recovery-key/route") },
  { route: "api.future-person-analysis-stop", method: "DELETE", path: "/api/future-person/claim/session/analysis", load: () => import("@/app/api/future-person/claim/session/analysis/route"), body: null },
  { route: "api.future-person-delete", method: "DELETE", path: "/api/future-person/claim/session", load: () => import("@/app/api/future-person/claim/session/route"), body: null },
  { route: "api.appeal-document-session", method: "POST", path: "/api/appeals/session/documents", load: () => import("@/app/api/appeals/session/documents/route") },
  { route: "api.third-party-subject-export", method: "POST", path: "/api/withdraw/session/export", load: () => import("@/app/api/withdraw/session/export/route") },
  { route: "api.withdraw", method: "POST", path: "/api/withdraw/session", load: () => import("@/app/api/withdraw/session/route") },
  { route: "api.consent-reaffirm-rights", method: "POST", path: "/api/consents/reaffirm/session", load: () => import("@/app/api/consents/reaffirm/session/route") },
  { route: "api.consent-grant-rights", method: "POST", path: "/api/consents/grant/session", load: () => import("@/app/api/consents/grant/session/route") },
  { route: "api.consent-revoke-rights", method: "POST", path: "/api/consents/revoke/session", load: () => import("@/app/api/consents/revoke/session/route") },
  { route: "api.future-person-correction", method: "POST", path: "/api/future-person/claim/session/corrections", load: () => import("@/app/api/future-person/claim/session/corrections/route") },
  { route: "api.appeal-complete", method: "POST", path: "/api/appeals/session/complete", load: () => import("@/app/api/appeals/session/complete/route") },
  { route: "api.rights-activate", method: "POST", path: "/api/rights/activate", load: () => import("@/app/api/rights/activate/route") },
  // 2026-11-19 (G8.5, the migration stage): the seventeen csrfOwnDesign rows
  // that needed a new session kind, and api.future-person-claim-objection,
  // which takes either of two kinds (owner decision of the same day), once
  // per kind.
  { route: "api.legal-evidence-review", method: "POST", path: `/api/legal-evidence/${ID}/review`, params: { id: ID }, load: () => import("@/app/api/legal-evidence/[id]/review/route") },
  { route: "api.appeal-review", method: "POST", path: `/api/reviews/appeals/${ID}`, params: { id: ID }, load: () => import("@/app/api/reviews/appeals/[id]/route") },
  { route: "api.future-person-documentary-verification", method: "POST", path: `/api/reviews/future-person/claims/${ID}/verify-documents`, params: { id: ID }, load: () => import("@/app/api/reviews/future-person/claims/[id]/verify-documents/route") },
  { route: "api.future-person-claim-review", method: "POST", path: `/api/reviews/future-person/claims/${ID}`, params: { id: ID }, load: () => import("@/app/api/reviews/future-person/claims/[id]/route") },
  { route: "api.future-person-claim-release", method: "POST", path: `/api/reviews/future-person/claims/${ID}/release`, params: { id: ID }, load: () => import("@/app/api/reviews/future-person/claims/[id]/release/route") },
  { route: "api.future-person-claim-objection-review", method: "POST", path: `/api/reviews/future-person/claim-objections/${ID}`, params: { id: ID }, load: () => import("@/app/api/reviews/future-person/claim-objections/[id]/route") },
  { route: "api.future-person-correction-review", method: "POST", path: `/api/reviews/future-person/corrections/${ID}`, params: { id: ID }, load: () => import("@/app/api/reviews/future-person/corrections/[id]/route") },
  { route: "api.claim-review-receipt", method: "POST", path: `/api/downloads/${ID}/receipt`, params: { session: ID }, load: () => import("@/app/api/downloads/[session]/receipt/route") },
  { route: "api.claim-review-chunk-acknowledgement", method: "POST", path: `/api/downloads/${ID}/chunks/0/acknowledge`, params: { session: ID, sequence: "0" }, load: () => import("@/app/api/downloads/[session]/chunks/[sequence]/acknowledge/route") },
  { route: "api.embryo-ingest-configure", method: "POST", path: `/api/embryo-ingest/${ID}/configure`, params: { session: ID }, load: () => import("@/app/api/embryo-ingest/[session]/configure/route") },
  { route: "api.embryo-ingest-mapping", method: "POST", path: `/api/embryo-ingest/${ID}/mapping`, params: { session: ID }, load: () => import("@/app/api/embryo-ingest/[session]/mapping/route") },
  { route: "api.embryo-ingest-mapping", method: "PUT", path: `/api/embryo-ingest/${ID}/mapping`, params: { session: ID }, load: () => import("@/app/api/embryo-ingest/[session]/mapping/route") },
  { route: "api.embryo-ingest-complete", method: "POST", path: `/api/embryo-ingest/${ID}/complete`, params: { session: ID }, load: () => import("@/app/api/embryo-ingest/[session]/complete/route") },
  { route: "api.future-person-claim-document-session", method: "POST", path: "/api/future-person/claim/session/documents", load: () => import("@/app/api/future-person/claim/session/documents/route") },
  { route: "api.future-person-claim-complete", method: "POST", path: "/api/future-person/claim/session/complete", load: () => import("@/app/api/future-person/claim/session/complete/route") },
  { route: "api.evidence-chunk", method: "PUT", path: `/api/evidence/${ID}/chunks/0`, params: { session: ID, sequence: "0" }, load: () => import("@/app/api/evidence/[session]/chunks/[sequence]/route") },
  { route: "api.evidence-complete", method: "POST", path: `/api/evidence/${ID}/complete`, params: { session: ID }, load: () => import("@/app/api/evidence/[session]/complete/route") },
  { route: "auth.reset-password-submit", method: "POST", path: "/api/auth/reset-password", load: () => import("@/app/api/auth/reset-password/route") },
  { route: "api.future-person-claim-objection", label: "api.future-person-claim-objection (the emailed link's rights session)", method: "POST", path: "/api/future-person/claim/session/objection", load: () => import("@/app/api/future-person/claim/session/objection/route") },
  { route: "api.future-person-claim-objection", kind: "authenticated", label: "api.future-person-claim-objection (the signed-in account, from Settings)", method: "POST", path: "/api/future-person/claim/session/objection", load: () => import("@/app/api/future-person/claim/session/objection/route") },
];

const kindOf = (route: CsrfRoute): Kind => SESSION_CSRF_ROUTES[route];
/** The kind of session the case's request carries. */
const entryKind = (entry: Case): Kind => entry.kind ?? kindOf(entry.route);
const COOKIE_OF: Partial<Record<Kind, string>> = {
  "token": RIGHTS_COOKIE_VALUE, "token-candidate": CANDIDATE_COOKIE_VALUE, "claim-session": CLAIM_COOKIE_VALUE,
  "reset-session": RESET_COOKIE_VALUE, "upload-session": INGEST_COOKIE_VALUE, "evidence-session": EVIDENCE_COOKIE_VALUE,
};
const sessionFor = (kind: Kind, cookie = COOKIE_OF[kind]!): CsrfSession => {
  if (kind === "authenticated" || kind === "reviewer") return { kind, accountId: ACCOUNT, sessionId: SESSION };
  if (kind === "upload-session" || kind === "evidence-session") return { kind, sessionHash: sha256(cookie), sessionId: ID };
  return { kind, sessionHash: sha256(cookie) };
};
/** A token of the same kind of session, for the same account or cookie holder, but not this session. */
const otherSessionFor = (kind: Kind): CsrfSession => kind === "authenticated" || kind === "reviewer"
  ? { kind, accountId: ACCOUNT, sessionId: OTHER_SESSION }
  : kind === "token" ? sessionFor(kind, CANDIDATE_COOKIE_VALUE)
    : kind === "token-candidate" ? sessionFor(kind, RIGHTS_COOKIE_VALUE) : sessionFor(kind, OTHER_COOKIE_VALUE);
/** Two routes of each later kind: the "another purpose" token is the one that is not the case's route. */
const SIBLINGS: Partial<Record<Kind, readonly [CsrfRoute, CsrfRoute]>> = {
  "reviewer": ["api.appeal-review", "api.future-person-claim-review"],
  "upload-session": ["api.embryo-ingest-configure", "api.embryo-ingest-complete"],
  "claim-session": ["api.future-person-claim-document-session", "api.future-person-claim-complete"],
  "evidence-session": ["api.evidence-chunk", "api.evidence-complete"],
};
/** The same session's token for another route, or for this cookie under another kind of session. */
function otherPurposeToken(entry: Case): string {
  const kind = entryKind(entry), route = entry.route;
  if (kind === "authenticated") return mintSessionCsrf(sessionFor(kind), route === "api.chat" ? "api.jurisdiction" : "api.chat");
  if (kind === "token") return mintSessionCsrf(sessionFor(kind), route === "api.withdraw" ? "api.consent-revoke-rights" : "api.withdraw");
  if (kind === "token-candidate" || kind === "reset-session") {
    // The same cookie's hash under the rights session's kind.
    return mintSessionCsrf({ kind: "token", sessionHash: sha256(COOKIE_OF[kind]!) }, "api.withdraw");
  }
  const [first, second] = SIBLINGS[kind]!;
  return mintSessionCsrf(sessionFor(kind), route === first ? second : first);
}

function request(entry: Case, token: string | null): Request {
  const headers = new Headers({ origin: ORIGIN, "sec-fetch-site": "same-origin" });
  const kind = entryKind(entry);
  if (kind === "token") headers.set("cookie", `inherit-rights=${RIGHTS_COOKIE_VALUE}`);
  if (kind === "token-candidate") headers.set("cookie", `inherit-rights-candidate=${CANDIDATE_COOKIE_VALUE}`);
  if (kind === "claim-session") headers.set("cookie", `inherit-claim=${CLAIM_COOKIE_VALUE}`);
  if (kind === "reset-session") headers.set("cookie", `inherit-reset=${RESET_COOKIE_VALUE}`);
  if (kind === "upload-session") headers.set("cookie", `inherit-ingest-${ID}=${INGEST_COOKIE_VALUE}`);
  if (kind === "evidence-session") headers.set("cookie", `inherit-evidence=${EVIDENCE_COOKIE_VALUE}`);
  const body = entry.body === null ? undefined : entry.body ?? "{}";
  if (body !== undefined) headers.set("content-type", "application/json");
  if (token !== null) headers.set("x-inherit-csrf", token);
  const sent = new Request(`${ORIGIN}${entry.path}`, { method: entry.method, headers, body });
  // Reading the body is the handler's work too: the gate reads headers only.
  for (const name of ["json", "text", "arrayBuffer", "formData", "blob", "bytes", "clone"] as const) {
    if (typeof sent[name] !== "function") continue;
    const read = (sent[name] as (...args: unknown[]) => unknown).bind(sent);
    Object.defineProperty(sent, name, { value: (...args: unknown[]) => { state.touches += 1; return read(...args); } });
  }
  const stream = Object.getOwnPropertyDescriptor(Request.prototype, "body")!.get!.bind(sent);
  Object.defineProperty(sent, "body", { get: () => { state.touches += 1; return stream(); } });
  return sent;
}

async function send(entry: Case, token: string | null): Promise<Response> {
  const loaded = await entry.load();
  const handler = loaded[entry.method] as (request: Request, context?: unknown) => Promise<Response>;
  expect(typeof handler, `${entry.path} exports ${entry.method}`).toBe("function");
  return handler(request(entry, token), { params: Promise.resolve(entry.params ?? {}) });
}

async function expectRefused(entry: Case, response: Response) {
  expect(response.headers.get("x-inherit-csrf"), "a refusal issues no successor").toBeNull();
  if (kindOf(entry.route) === "authenticated") {
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "request_forbidden" });
  } else {
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  }
}

/** The two branches that spend the token inside the handler, after reading their own request. */
const INLINE = new Set<CsrfRoute>(["api.consents", "api.subject-drafts", "api.claim-review-chunk-acknowledgement"]);
/** The kinds 20261024220000's door spends; the five later ones go to public.consume_session_csrf_v2. */
const V1_KINDS = new Set<Kind>(["authenticated", "token", "token-candidate"]);

/**
 * Sends `token` and requires the register's refusal before the handler ran:
 * no database or auth client reached at all, or, for an inline branch, no
 * more than the same request without a token reaches. A handler whose own
 * answer looks like the refusal still fails this.
 */
async function expectRefusedBeforeHandler(entry: Case, token: string | null) {
  state.touches = 0;
  await expectRefused(entry, await send(entry, token));
  const touches = state.touches;
  let baseline = 0;
  if (INLINE.has(entry.route)) {
    state.touches = 0;
    await expectRefused(entry, await send(entry, null));
    baseline = state.touches;
  }
  expect(touches, "the handler did not run").toBe(baseline);
}

beforeEach(() => {
  vi.stubEnv("BYOK_ENCRYPTION_KEY", KEY);
  state.signedIn = true;
  state.spent.clear();
  state.consumeCalls.length = 0;
  state.consumeResults.length = 0;
  state.touches = 0;
  state.liveSessions.clear();
  state.liveSessions.add(`${ACCOUNT}|${SESSION}`);
  state.liveSessions.add(`${ACCOUNT}|${OTHER_SESSION}`);
});
afterEach(() => vi.unstubAllEnvs());

describe("every bound route requires and spends its one-time X-Inherit-CSRF token", () => {
  it("drives every route the token guards, and only those", () => {
    expect([...new Set(CASES.map((entry) => entry.route))].sort()).toEqual(Object.keys(SESSION_CSRF_ROUTES).sort());
  });

  describe.each(CASES.map((entry) => [entry.label ?? `${entry.route} ${entry.method}`, entry] as const))("%s", (_name, entry) => {
    const session = () => sessionFor(entryKind(entry));
    const stream = SESSION_CSRF_STREAM_ROUTES.has(entry.route);

    it("refuses a request without the token before the handler runs", async () => {
      await expectRefusedBeforeHandler(entry, null);
      expect(state.consumeCalls).toHaveLength(0);
    });

    if (stream) {
      // Principle 3 (G8.5, 19 November 2026): a chunk stream keeps one
      // session-bound value; each chunk's own reservation is its replay guard.
      it("admits the stream's one value on every chunk, spends nothing and issues no successor", async () => {
        const token = mintSessionCsrf(session(), entry.route);
        for (let chunk = 0; chunk < 3; chunk++) {
          const response = await send(entry, token);
          expect(response.headers.get("x-inherit-csrf"), "no successor").toBeNull();
          // The handler's own answer: every one it gives is no-referrer, and
          // the gate's refusal is not (the evidence routes are closed here, so
          // it answers 404 at once).
          expect(response.headers.get("referrer-policy"), "the handler ran").toBe("no-referrer");
        }
        expect(state.consumeCalls).toHaveLength(0);
        const refused = await send(entry, mintSessionCsrf(otherSessionFor(entryKind(entry)), entry.route));
        expect(refused.headers.get("referrer-policy"), "the gate refused").toBe("same-origin");
      });
    } else {
      it("refuses a token that was already spent", async () => {
        const token = mintSessionCsrf(session(), entry.route);
        const first = await send(entry, token);
        if (!NO_SUCCESSOR.has(entry.route)) expect(first.headers.get("x-inherit-csrf"), "the first use is admitted").not.toBeNull();
        await expectRefusedBeforeHandler(entry, token);
        expect(state.consumeResults, "spent the first time, refused the second").toEqual([true, false]);
      });
    }

    it("refuses a token of another session", async () => {
      await expectRefusedBeforeHandler(entry, mintSessionCsrf(otherSessionFor(entryKind(entry)), entry.route));
      expect(state.consumeCalls).toHaveLength(0);
    });

    it("refuses a token of another purpose", async () => {
      await expectRefusedBeforeHandler(entry, otherPurposeToken(entry));
      expect(state.consumeCalls).toHaveLength(0);
    });

    if (!stream) it("admits the same request with a fresh token, spends it once and issues the next one", async () => {
      const token = mintSessionCsrf(session(), entry.route);
      const response = await send(entry, token);
      const next = response.headers.get("x-inherit-csrf");
      // Sign-out and the activation each end the session a successor would be
      // bound to, so they issue none.
      if (NO_SUCCESSOR.has(entry.route)) {
        if (entry.route === "auth.sign-out") expect(response.status).toBe(303);
        expect(next).toBeNull();
      } else {
        expect(next).not.toBe(token);
        expect(verifySessionCsrf(next, session(), entry.route)).not.toBeNull();
      }
      expect(state.consumeCalls).toEqual([expect.objectContaining({
        p_route_id: entry.route, p_session_kind: entryKind(entry), p_token_hash: sha256(token),
        function: V1_KINDS.has(entryKind(entry)) ? "consume_session_csrf_v1" : "consume_session_csrf_v2",
        ...(V1_KINDS.has(entryKind(entry)) ? {} : {
          p_cookie_hash: "sessionHash" in session() ? (session() as { sessionHash: string }).sessionHash : null,
          p_purpose_session_id: entryKind(entry) === "upload-session" || entryKind(entry) === "evidence-session" ? ID : null,
        }),
      })]);
      expect(state.consumeResults).toEqual([true]);
    });
  });

  it("admits two overlapping requests of one page through the browser's chain, and still refuses a spent token", async () => {
    const { csrfHandle } = await import("./session-csrf-client");
    for (const route of ["api.jurisdiction", "api.withdraw"] as const) {
      state.consumeResults.length = 0;
      const entry = CASES.find((candidate) => candidate.route === route)!;
      const rendered = mintSessionCsrf(sessionFor(kindOf(route)), route);
      // Two copies of the page's rendered value, both sent before either answer
      // arrived. Without the chain the second is refused: the server's one spend.
      const [raw, repeated] = await Promise.all([send(entry, rendered), send(entry, rendered)]);
      expect(raw.headers.get("x-inherit-csrf"), route).not.toBeNull();
      await expectRefused(entry, repeated);
      expect(state.consumeResults, route).toEqual([true, false]);
      // Through the chain, from a newly rendered value, the second waits for the
      // first answer and carries its successor: both are admitted.
      state.consumeResults.length = 0;
      const page = mintSessionCsrf(sessionFor(kindOf(route)), route);
      const handle = csrfHandle(page), sent: string[] = [];
      const through = (token: string) => { sent.push(token); return send(entry, token); };
      const [first, second] = await Promise.all([handle.send(through), handle.send(through)]);
      expect(sent[0], route).toBe(page);
      expect(sent[1], `${route}: the second carries the first answer's successor`).toBe(first.headers.get("x-inherit-csrf"));
      expect(second.headers.get("x-inherit-csrf"), `${route}: the second is admitted`).not.toBeNull();
      expect(state.consumeResults, route).toEqual([true, true]);
      // A replay of either spent value is refused before the handler, as before.
      for (const spent of sent) await expectRefusedBeforeHandler(entry, spent);
      expect(state.consumeResults, route).toEqual([true, true, false, false]);
    }
  });

  it("refuses an authenticated token once its auth session has ended", async () => {
    const entry = CASES.find((candidate) => candidate.route === "api.jurisdiction")!;
    const token = mintSessionCsrf(sessionFor("authenticated"), "api.jurisdiction");
    state.liveSessions.clear();
    await expectRefusedBeforeHandler(entry, token);
  });

  it("refuses a reviewer token once its auth session has ended, as an account token is", async () => {
    const entry = CASES.find((candidate) => candidate.route === "api.appeal-review")!;
    const token = mintSessionCsrf(sessionFor("reviewer"), "api.appeal-review");
    state.liveSessions.clear();
    await expectRefusedBeforeHandler(entry, token);
    expect(state.consumeCalls).toEqual([expect.objectContaining({ function: "consume_session_csrf_v2", p_session_kind: "reviewer" })]);
  });

  it("leaves a request with no session to its handler's own answer, spending nothing", async () => {
    state.signedIn = false;
    for (const entry of CASES.filter((candidate) => kindOf(candidate.route) === "authenticated")) {
      const response = await send(entry, null);
      expect(response.status, entry.path).not.toBe(403);
    }
    expect(state.consumeCalls).toHaveLength(0);
  });

  it("refuses a sign-out from any other origin, token or not", async () => {
    const entry = CASES.find((candidate) => candidate.route === "auth.sign-out")!;
    const loaded = await entry.load();
    const post = loaded.POST as (request: Request) => Promise<Response>;
    const token = mintSessionCsrf(sessionFor("authenticated"), "auth.sign-out");
    for (const origin of [null, "https://elsewhere.test", "http://inherit.test"]) {
      const headers = new Headers({ "x-inherit-csrf": token, "sec-fetch-site": "same-origin" });
      if (origin) headers.set("origin", origin);
      const response = await post(new Request(`${ORIGIN}/auth/sign-out`, { method: "POST", headers }));
      expect(response.status, String(origin)).toBe(403);
      expect(await response.json()).toEqual({ error: "request_forbidden" });
    }
    expect(state.consumeCalls).toHaveLength(0);
    const signedOut = await post(new Request(`${ORIGIN}/auth/sign-out`, { method: "POST",
      headers: { origin: ORIGIN, "x-inherit-csrf": token } }));
    expect(signedOut.status).toBe(303);
    expect(signedOut.headers.get("location")).toBe(`${ORIGIN}/auth/sign-in`);
  });

  it("wraps every whole route it guards, so the check cannot be skipped by a refactor of one handler", async () => {
    const { SESSION_CSRF_GUARD } = await import("./session-csrf");
    // api.consents and api.subject-drafts check the token inside the branches
    // they answer themselves; their other branches keep their own page's token.
    for (const entry of CASES.filter((candidate) => !INLINE.has(candidate.route))) {
      const loaded = await entry.load();
      expect((loaded[entry.method] as Record<symbol, unknown>)[SESSION_CSRF_GUARD], entry.path).toBe(entry.route);
    }
    for (const file of ["src/app/api/consents/route.ts", "src/app/api/subject-drafts/route.ts"]) {
      expect(readFileSync(file, "utf8")).toMatch(/(?:requireAccountCsrf|admitAccountCsrf)\(request, "api\.(?:consents|subject-drafts)"\)/u);
    }
    // 2026-11-19 (G8.5, the migration stage): the reviewer's branch of the
    // chunk acknowledgement checks its token before anything of its own; the
    // TEST account archive's branch answers first with its own value.
    expect(readFileSync("src/app/api/downloads/[session]/chunks/[sequence]/acknowledge/route.ts", "utf8"))
      .toMatch(/if\(archive\)return archive;\n  const admitted=await requireReviewerCsrf\(request,"api\.claim-review-chunk-acknowledgement"\);\n  if\(admitted instanceof Response\)return admitted;/u);
  });
});

/**
 * The register's side. Every route `mutationSecurityBindings.csrfTransport`
 * binds is accounted for exactly once: guarded by the one-time session token
 * (`SESSION_CSRF_ROUTES`), an alias of one that is (`policy.aliasOf`), or one
 * of the routes whose X-Inherit-CSRF is still of its own design, each recorded
 * in `docs/register-contract-divergence.json#csrfOwnDesign` with the literal it
 * is read from.
 */
describe("every route the register binds to csrfTransport is accounted for", () => {
  type RegisterRoute = { id: string; auth?: string; methods?: string[]; policy?: { aliasOf?: string } };
  type OwnDesign = { routeId: string; file: string; literal: string; kind: string; value: string; oneTime: string; branch?: boolean };
  const register = JSON.parse(readFileSync("docs/route-register.json", "utf8")) as Parameters<typeof csrfHeaderRequiredOf>[2] & { routes: RegisterRoute[] };
  const own = (JSON.parse(readFileSync("docs/register-contract-divergence.json", "utf8")) as { csrfOwnDesign: OwnDesign[] }).csrfOwnDesign;
  const routes: RegisterRoute[] = register.routes;
  const bound = routes.filter(route => (route.methods ?? []).some(method => csrfHeaderRequiredOf(route as never, method, register)));

  it("guards each route of SESSION_CSRF_ROUTES as the register authenticates it", () => {
    for (const [route, kind] of Object.entries(SESSION_CSRF_ROUTES)) {
      const entry = routes.find(candidate => candidate.id === route);
      expect(entry?.auth, route).toBe(kind);
      expect(bound.map(candidate => candidate.id), route).toContain(route);
    }
  });

  it("accounts for every bound route once, in both directions", () => {
    const guarded = new Set(Object.keys(SESSION_CSRF_ROUTES));
    const aliases = bound.filter(route => route.policy?.aliasOf && guarded.has(route.policy.aliasOf)).map(route => route.id);
    const ownWhole = own.filter(row => !row.branch).map(row => row.routeId);
    expect(new Set(ownWhole).size, "one row per route").toBe(ownWhole.length);
    const accounted = [...guarded, ...aliases, ...ownWhole].sort();
    expect(accounted).toEqual(bound.map(route => route.id).sort());
    expect(aliases).toEqual(["api.embryo-withdraw"]);
    // A branch row names a route the session token guards for its other bodies.
    for (const row of own.filter(candidate => candidate.branch)) expect(guarded.has(row.routeId), row.routeId).toBe(true);
    // 75 since the merge with G8.5's form shapes: api.embryo-acknowledge replaced the Embryo gate's server action.
    expect(bound).toHaveLength(75);
    // 32 since 2026-11-19 (G8.5 stage one): api.subjects, api.future-person-claimant-bind,
    // api.future-person-correction and api.appeal-complete moved onto the session token (36 before).
    // 18 since stage two, the same day: fourteen more whole rows moved (api.account-completion,
    // api.invitations, api.embryo-cohort-drafts, api.legal-evidence-upload-session,
    // api.embryo-record-key-cards-rights, api.export, api.subject-export, api.future-person-export,
    // api.future-person-identity-profile, api.future-person-recovery-key,
    // api.future-person-analysis-stop, api.future-person-delete, api.appeal-document-session,
    // api.third-party-subject-export), and the two branch rows (api.consents, api.subject-drafts) left.
    // 0 since the migration stage, the same day: the seventeen rows that needed a new session kind
    // (reviewer 9, upload-session 3, claim-session 2, evidence-session 2, reset-session 1) moved,
    // and api.future-person-claim-objection moved under the owner's decision that it takes either kind.
    expect(ownWhole).toHaveLength(0);
    // 1 since the migration stage: the reviewer's branch of api.claim-review-chunk-acknowledgement
    // moved, and the TEST account archive's acknowledgement on the same path keeps its own
    // per-chunk value (0 before: the whole route was one row).
    expect(own.filter(row => row.branch).map(row => row.routeId)).toEqual(["api.claim-review-chunk-acknowledgement"]);
  });

  it("anchors each own-design row to the code it describes", () => {
    for (const row of own) {
      expect(["digest-not-one-time", "operation-token", "derived-one-time", "none"], row.routeId).toContain(row.kind);
      expect(readFileSync(row.file, "utf8").includes(row.literal), `${row.routeId}: ${row.file}`).toBe(true);
      expect(row.value.length, row.routeId).toBeGreaterThan(20);
      expect(row.oneTime.length, row.routeId).toBeGreaterThan(5);
    }
  });
});
