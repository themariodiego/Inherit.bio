import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), rpc: vi.fn(), read: vi.fn(), pinned: vi.fn() }));
vi.mock("@/lib/uploads/own-upload-context", () => ({ currentOwnUploadAccount: mocks.actor }));
vi.mock("@/lib/crypto", () => ({ decryptSecret: vi.fn(), hmacSecret: () => "b".repeat(64) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc,
  from: (table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: () => mocks.read(table) }) }) }) }) }));
vi.mock("./model-endpoint", () => ({ modelRuntimeRevision: () => "a".repeat(64),
  normalizeModelEndpoint: () => ({ baseUrl: "https://model.synthetic.invalid/v1", origin: "https://model.synthetic.invalid",
    providerClass: "cloud", runtimeAttestationFingerprint: "a".repeat(64) }),
  createPinnedModelFetch: mocks.pinned }));
import { prepareOwnCopilotProvider } from "./own-provider-authority";
const id = "77800000-0000-4000-8000-000000000001";
const authority = { accountId: id, sessionId: id, subjectId: id, context: {
  accountRevision: 1, authSessionRevision: 1, jurisdictionRevision: 1, subjectBindingRevision: 1, accountBindingRevision: 1,
  uploadConsentId: id, subjectLifecycleRevision: 1, originatingSessionRevision: 1, principalId: id, principalRevision: 1,
}, settingsRevision: 2, recipientRevision: 2, providerClass: "cloud", runtimeAttestationRevision: 1,
  runtimeAttestationFingerprint: "a".repeat(64), copilotGrantId: id, copilotGrantRevision: 1, providerGrantId: id, providerGrantRevision: 1 };
beforeEach(() => {
  vi.clearAllMocks(); mocks.actor.mockResolvedValue({ accountId: id, sessionId: id });
  mocks.rpc.mockResolvedValue({ data: authority, error: null });
  mocks.read.mockImplementation(async table => ({ data: table === "llm_keys" ? null : {
    provider: "openai_compatible", base_url: "https://model.synthetic.invalid/v1", model: "synthetic-model",
    copilot_recipient: { providerLabel: "Synthetic model", origin: "https://model.synthetic.invalid", credentialFingerprint: "b".repeat(64),
      revision: 2, runtimeAttestationFingerprint: "a".repeat(64), providerClass: "cloud", baseUrl: "https://model.synthetic.invalid/v1",
      provider: "openai_compatible", model: "synthetic-model" },
  }, error: null }));
  mocks.pinned.mockImplementation((_endpoint, authorize) => authorize);
});
it("rechecks source authority when the actual transport invokes its connection callback", async () => {
  const provider = await prepareOwnCopilotProvider(id); expect(provider).not.toBeNull();
  const dataAuthority = vi.fn().mockResolvedValue(true);
  provider!.createFetch(dataAuthority);
  const authorize = mocks.pinned.mock.calls.at(-1)![1] as () => Promise<boolean>;
  expect(await authorize()).toBe(true);
  // Simulate withdrawal after preparation or DNS but before a later connection.
  dataAuthority.mockResolvedValue(false);
  expect(await authorize()).toBe(false);
  expect(dataAuthority).toHaveBeenCalledTimes(2);
});
it("cannot use the data callback to bypass a changed provider permission", async () => {
  const provider = await prepareOwnCopilotProvider(id); expect(provider).not.toBeNull();
  const dataAuthority = vi.fn().mockResolvedValue(true);
  provider!.createFetch(dataAuthority);
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  const authorize = mocks.pinned.mock.calls.at(-1)![1] as () => Promise<boolean>;
  expect(await authorize()).toBe(false); expect(dataAuthority).not.toHaveBeenCalled();
});
