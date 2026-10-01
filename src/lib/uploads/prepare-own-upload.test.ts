import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Brief X1.5: the upload page renders its presentation token while it
 * renders, so preparing it must write nothing. The admin client below records
 * every call; the only RPC allowed is the read-only context lookup.
 */
const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  context: vi.fn(),
  tables: {} as Record<string, { data: unknown; error: unknown }>,
}));
vi.mock("./own-upload-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./own-upload-context")>()),
  currentOwnUploadAccount: async () => ({ accountId: ACCOUNT, sessionId: SESSION }),
}));
vi.mock("@/lib/subjects", () => ({
  resolveSubjectForAccount: async () => ({ id: SUBJECT, subjectAccountId: ACCOUNT, subjectClass: "self" }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (name: string) => { mocks.calls.push(`rpc(${name})`); return Promise.resolve(mocks.context()); },
    from: (table: string) => {
      mocks.calls.push(`from(${table})`);
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "in", "is", "lte", "eq", "contains", "or"]) {
        chain[method] = () => chain;
      }
      for (const write of ["insert", "upsert", "update", "delete"]) {
        chain[write] = () => { mocks.calls.push(`${write}(${table})`); return chain; };
      }
      chain.maybeSingle = () => Promise.resolve(mocks.tables[table]);
      chain.then = (resolve: (value: unknown) => unknown) => resolve(mocks.tables[table]);
      return chain;
    },
  }),
}));
vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
const { prepareOwnUpload } = await import("./prepare-own-upload");
const { readOwnAccountCompletionPresentation, readOwnConsentPresentation } = await import("./own-consent-token");
afterAll(() => vi.unstubAllEnvs());

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUBJECT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const revisions = { accountRevision: 2, authSessionRevision: 3, jurisdictionRevision: 4,
  subjectBindingRevision: 5, accountBindingRevision: 1 };
const body = "artifact body";
const sha = crypto.createHash("sha256").update(body).digest("hex");

function writes() {
  return mocks.calls.filter(call => /^(insert|upsert|update|delete)\(/u.test(call)
    || (call.startsWith("rpc(") && call !== "rpc(own_upload_context_v1)"));
}

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.tables = {
    consent_artifacts: { data: ["disclosure.insurance-and-discrimination", "consent.upload-self"].map(key => ({
      artifact_key: key, version: 1, body_sha256: sha, body_markdown: body, summary_markdown: "summary" })), error: null },
    subject_account_bindings: { data: { subject_principal_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }, error: null },
    consent_signatures: { data: [], error: null },
    subject_consents: { data: [], error: null },
  };
});

describe("preparing the own-upload page (brief X1.5)", () => {
  it("renders an account-completion token and writes nothing", async () => {
    mocks.context.mockReturnValue({ data: { ...revisions, birthDateState: "missing" }, error: null });
    const view = await prepareOwnUpload();
    expect(view.kind).toBe("account-completion");
    const claims = readOwnAccountCompletionPresentation((view as { token: string }).token);
    expect(claims).toMatchObject({ accountId: ACCOUNT, sessionId: SESSION, subjectId: SUBJECT, ...revisions });
    expect(writes()).toEqual([]);
  });

  it("renders a consent token for the first unsigned artifact and writes nothing", async () => {
    mocks.context.mockReturnValue({ data: { ...revisions, birthDateState: "adult" }, error: null });
    const view = await prepareOwnUpload();
    expect(view.kind).toBe("consent");
    const claims = readOwnConsentPresentation((view as { token: string }).token);
    expect(claims).toMatchObject({ accountId: ACCOUNT, sessionId: SESSION, subjectId: SUBJECT,
      artifactKey: "disclosure.insurance-and-discrimination", artifactVersion: 1, artifactBodySha256: sha });
    expect(writes()).toEqual([]);
    expect(mocks.calls).toContain("rpc(own_upload_context_v1)");
  });

  it("mints a fresh token on every render, with nothing to remember between them", async () => {
    mocks.context.mockReturnValue({ data: { ...revisions, birthDateState: "adult" }, error: null });
    const first = await prepareOwnUpload() as { token: string };
    const second = await prepareOwnUpload() as { token: string };
    expect(first.token).not.toBe(second.token);
    expect(writes()).toEqual([]);
  });
});
