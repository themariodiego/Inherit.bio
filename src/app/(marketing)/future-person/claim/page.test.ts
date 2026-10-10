import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RECEIVED_BODY, RECEIVED_HEADING, SUBMITTED_BODY, SUBMITTED_HEADING } from "@/copy/rights/future-person-claim";
import { ClaimStartReceipt } from "@/components/future-person/claim-start-receipt";
import { CLAIM_SESSION_COOKIE, sha256Hex } from "@/lib/future-person/claim-session";

const mocks = vi.hoisted(() => ({ open: true, cookie: undefined as string | undefined, rpc: vi.fn(), form: vi.fn(), documents: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => name === CLAIM_SESSION_COOKIE && mocks.cookie ? { value: mocks.cookie } : undefined }),
  headers: async () => ({ get: () => "non-authorizing-rendered-form-token" }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/future-person/claims-open", () => ({ futurePersonClaimsOpen: () => mocks.open }));
// Only unrelated interactive controls are synthetic. The actual async page,
// shared receipt and React server rendering below are exercised unchanged.
vi.mock("@/components/future-person/claim-documents", () => ({ ClaimDocuments: (props: unknown) => {
  mocks.documents(props); return React.createElement("section", { "data-documents": "true" });
} }));
vi.mock("@/components/future-person/claim-form", () => ({ FuturePersonClaimForm: (props: unknown) => {
  mocks.form(props); return React.createElement("form", { "data-start": "true" });
} }));
import Page from "./page";

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.clearAllMocks(); mocks.open = true; mocks.cookie = Buffer.alloc(32, 9).toString("base64url");
  mocks.rpc.mockResolvedValue({ data: { status: "live", mode: "record-key" }, error: null });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("the genuine live-claim page preserves the common start receipt", () => {
  it.each(["record-key", "claimant-recovery-key", "keyless"])("renders the exact same acknowledgement after refresh for %s", async mode => {
    mocks.rpc.mockResolvedValue({ data: { status: "live", mode }, error: null });
    const markup = renderToStaticMarkup(await Page());
    const receipt = renderToStaticMarkup(React.createElement(ClaimStartReceipt));
    expect(markup).toContain(receipt);
    expect(receipt).toContain(RECEIVED_HEADING); expect(receipt).toContain(RECEIVED_BODY);
    expect((markup.match(/role="status"/gu) ?? []).length).toBe(1);
    expect(markup.indexOf(receipt)).toBeLessThan(markup.indexOf('data-documents="true"'));
    expect(mocks.form).not.toHaveBeenCalled(); expect(mocks.documents).toHaveBeenCalledTimes(1);
    expect(mocks.documents.mock.calls[0][0]).toMatchObject({ mode });
    expect(mocks.rpc.mock.calls).toEqual([["claim_session_status_v1", { p_session_hash: sha256Hex(mocks.cookie!) }]]);
    expect(markup).not.toContain(mocks.cookie!); expect(markup).not.toContain(`>${mode}<`);
  });

  it("retains the distinct completed-claim acknowledgement with no document or start controls", async () => {
    mocks.rpc.mockResolvedValue({ data: { status: "completed" }, error: null });
    const markup = renderToStaticMarkup(await Page());
    expect(markup).toContain(SUBMITTED_HEADING); expect(markup).toContain(SUBMITTED_BODY);
    expect(markup).not.toContain(RECEIVED_HEADING);
    expect(mocks.form).not.toHaveBeenCalled(); expect(mocks.documents).not.toHaveBeenCalled();
  });

  it.each(["missing-cookie", "malformed-cookie", "status-error", "missing-status", "unknown-mode", "closed"])(
    "does not invent a receipt without an actual current live status: %s", async fault => {
      if (fault === "missing-cookie") mocks.cookie = undefined;
      if (fault === "malformed-cookie") mocks.cookie = "invalid";
      if (fault === "status-error") mocks.rpc.mockResolvedValue({ data: { status: "live", mode: "record-key" }, error: { code: "42501" } });
      if (fault === "missing-status") mocks.rpc.mockResolvedValue({ data: null, error: null });
      if (fault === "unknown-mode") mocks.rpc.mockResolvedValue({ data: { status: "live", mode: "unknown" }, error: null });
      if (fault === "closed") mocks.open = false;
      const markup = renderToStaticMarkup(await Page());
      expect(markup).not.toContain(RECEIVED_HEADING); expect(markup).not.toContain(SUBMITTED_HEADING);
      expect(mocks.documents).not.toHaveBeenCalled();
      if (["missing-cookie", "malformed-cookie", "closed"].includes(fault)) expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
});
