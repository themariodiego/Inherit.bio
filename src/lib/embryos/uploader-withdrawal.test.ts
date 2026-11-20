import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two halves of a non-parent uploader's withdrawal of its permission for
 * an embryo upload (owner decision of 19 November 2026, "A non-parent
 * uploader's withdrawal for an embryo upload stops analysis and deletes, as
 * they signed"): what /embryos and /embryos/upload render for the control,
 * read while the page renders and writing nothing, and the one request the
 * control sends. The admin client records every call and filter.
 */
const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  filters: [] as string[],
  rpc: vi.fn(),
  tables: {} as Record<string, unknown>,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (name: string, args: unknown) => { mocks.calls.push(`rpc(${name})`); return Promise.resolve(mocks.rpc(name, args)); },
    from: (table: string) => {
      mocks.calls.push(`from(${table})`);
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "in", "eq", "gt", "order", "limit"]) {
        chain[method] = (...args: unknown[]) => { mocks.filters.push(`${table}.${method}(${JSON.stringify(args)})`); return chain; };
      }
      for (const write of ["insert", "upsert", "update", "delete"]) {
        chain[write] = () => { mocks.calls.push(`${write}(${table})`); return chain; };
      }
      chain.maybeSingle = () => Promise.resolve(mocks.tables[table] ?? { data: null, error: null });
      chain.then = (resolve: (value: unknown) => unknown) => resolve(mocks.tables[`${table}[]`] ?? { data: [], error: null });
      return chain;
    },
  }),
}));
vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
const { prepareCohortUploaderWithdrawals, prepareDraftUploaderWithdrawal } = await import("./uploader-withdrawal");
const { requestEmbryoUploaderWithdrawal } = await import("./uploader-withdrawal-client");
const { verifyPersonOperationNonce } = await import("@/lib/person-operation-nonce-core");
afterAll(() => vi.unstubAllEnvs());

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COHORT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DRAFT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SIGNATURE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ACTOR = { accountId: ACCOUNT, sessionId: SESSION };
type Cohort = Parameters<typeof prepareCohortUploaderWithdrawals>[1][number];
const cohort = (viewerRole: Cohort["viewerRole"], id = COHORT) => ({ id, viewerRole }) as Cohort;
const writes = () => mocks.calls.filter(call => /^(insert|upsert|update|delete)\(/u.test(call)
  || (call.startsWith("rpc(") && call !== "rpc(embryo_uploader_withdrawal_readiness_v1)"));

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.filters.length = 0;
  mocks.rpc.mockReset();
  mocks.rpc.mockReturnValue({ data: "cohort", error: null });
  mocks.tables = {
    "embryo_cohorts[]": { data: [{ id: COHORT, draft_id: DRAFT }], error: null },
    consent_signatures: { data: { id: SIGNATURE }, error: null },
    embryo_cohort_drafts: { data: { id: DRAFT, upload_class: "embryo_third_party" }, error: null },
  };
});

describe("the cohort card's view", () => {
  it("is prepared only for a cohort the viewer uploaded as its non-parent uploader, from its own uploader signature", async () => {
    const views = await prepareCohortUploaderWithdrawals(ACTOR, [cohort("nonparent_uploader_owner")]);
    const view = views.get(COHORT)!;
    expect(view.signatureId).toBe(SIGNATURE);
    expect(view.readiness).toBe("cohort");
    expect(verifyPersonOperationNonce(view.nonce, { ...ACTOR, operation: "consent_revoke", targetId: SIGNATURE })).not.toBeNull();
    expect(verifyPersonOperationNonce(view.nonce, { ...ACTOR, operation: "consent_revoke", targetId: COHORT })).toBeNull();
    expect(mocks.filters).toEqual(expect.arrayContaining([
      `embryo_cohorts.eq(${JSON.stringify(["owner_account_id", ACCOUNT])})`,
      `embryo_cohorts.eq(${JSON.stringify(["upload_class", "embryo_third_party"])})`,
      `consent_signatures.eq(${JSON.stringify(["target_id", DRAFT])})`,
      `consent_signatures.eq(${JSON.stringify(["artifact_key", "consent.upload-embryo"])})`,
      `consent_signatures.eq(${JSON.stringify(["purpose", "embryo-upload-uploader-class"])})`,
      `consent_signatures.eq(${JSON.stringify(["signer_account_id", ACCOUNT])})`,
    ]));
    expect(writes()).toEqual([]);
  });

  it("is never prepared for a genetic parent, and reads nothing for one", async () => {
    expect((await prepareCohortUploaderWithdrawals(ACTOR, [cohort("required_upload_principal")])).size).toBe(0);
    expect(mocks.calls).toEqual([]);
  });

  it("offers no request when the read fails, and nothing when it finds nothing", async () => {
    mocks.rpc.mockReturnValue({ data: null, error: { code: "PGRST202", message: "missing" } });
    expect((await prepareCohortUploaderWithdrawals(ACTOR, [cohort("nonparent_uploader_owner")])).get(COHORT))
      .toEqual({ signatureId: SIGNATURE, readiness: "unavailable", nonce: null });
    mocks.rpc.mockReturnValue({ data: null, error: { code: "42501", message: "not_found" } });
    expect((await prepareCohortUploaderWithdrawals(ACTOR, [cohort("nonparent_uploader_owner")])).size).toBe(0);
    mocks.tables.consent_signatures = { data: null, error: null };
    expect((await prepareCohortUploaderWithdrawals(ACTOR, [cohort("nonparent_uploader_owner")])).size).toBe(0);
  });
});

describe("the upload page's view", () => {
  it("is prepared for the newest open draft only when it is a third-party upload the account signed", async () => {
    mocks.rpc.mockReturnValue({ data: "draft", error: null });
    const view = await prepareDraftUploaderWithdrawal(ACTOR);
    expect(view?.readiness).toBe("draft");
    expect(view?.signatureId).toBe(SIGNATURE);
    expect(mocks.filters).toEqual(expect.arrayContaining([
      `embryo_cohort_drafts.eq(${JSON.stringify(["owner_account_id", ACCOUNT])})`,
      `embryo_cohort_drafts.in(${JSON.stringify(["state", ["draft", "evidence_pending", "ready"]])})`,
    ]));
    mocks.tables.embryo_cohort_drafts = { data: { id: DRAFT, upload_class: "embryo_own" }, error: null };
    expect(await prepareDraftUploaderWithdrawal(ACTOR)).toBeNull();
    mocks.tables.embryo_cohort_drafts = { data: null, error: null };
    expect(await prepareDraftUploaderWithdrawal(ACTOR)).toBeNull();
    expect(writes()).toEqual([]);
  });
});

describe("the request", () => {
  it("is api.consent-revoke for the signature: POST, no body, the page's code and the chain's session token", async () => {
    const seen: [string, RequestInit][] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { seen.push([url, init]); return new Response(null, { status: 202 }); });
    const csrf = { send: (request: (token: string) => Promise<Response>) => request("csrf-token") };
    expect(await requestEmbryoUploaderWithdrawal(csrf as never, SIGNATURE, "the-code")).toBe("withdrawn");
    expect(seen).toEqual([[`/api/consents/${SIGNATURE}/revoke`, { method: "POST",
      headers: { "X-Inherit-Operation-Nonce": "the-code", "X-Inherit-CSRF": "csrf-token" } }]]);
    vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));
    expect(await requestEmbryoUploaderWithdrawal(csrf as never, SIGNATURE, "the-code")).toBe("refused");
    vi.stubGlobal("fetch", async () => new Response(null, { status: 200 }));
    expect(await requestEmbryoUploaderWithdrawal(csrf as never, SIGNATURE, "the-code")).toBe("uncertain");
    vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
    expect(await requestEmbryoUploaderWithdrawal(csrf as never, SIGNATURE, "the-code")).toBe("uncertain");
    vi.unstubAllGlobals();
  });
});
