import { afterEach, describe, expect, it, vi } from "vitest";
import { csrfHandle } from "@/lib/security/session-csrf-client";
import { submitFamilyPermission, type PermissionAction } from "./permission-response";

// The rendered one-time X-Inherit-CSRF tokens of the two routes (G8.5).
const GRANT_CSRF = `1800000000000.${"G".repeat(43)}.${"1".repeat(64)}`;
const REVOKE_CSRF = `1800000000000.${"R".repeat(43)}.${"2".repeat(64)}`;
const csrf = { grant: csrfHandle(GRANT_CSRF), revoke: csrfHandle(REVOKE_CSRF) };

const grant: PermissionAction = { kind: "grant", request: { action: "grant-purpose",
  subjectId: "00000000-0000-4000-8000-000000000001", purposeKey: "family.portrait",
  artifactVersion: 1, artifactPresentationToken: "synthetic-presentation", affirmed: true,
  statementKeys: ["one-purpose", "one-named-adult", "own-account", "pause-or-stop-any-time"] } };
const receipt = { recordKind: "purpose_grant", recordId: "00000000-0000-4000-8000-000000000002",
  artifactKey: "consent.share-with-adult", artifactVersion: 1, purposeKey: "family.portrait",
  signedAt: "2026-09-07T00:00:00.000Z" };
afterEach(() => vi.unstubAllGlobals());

describe("Family permission operation receipts", () => {
  it("does not report success from headers before the actual response body completes", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } });
    const request = vi.fn().mockResolvedValue(new Response(body, { status: 201 }));
    vi.stubGlobal("fetch", request);
    let settled = false;
    const result = submitFamilyPermission(grant, csrf).then(value => { settled = true; return value; });
    await Promise.resolve(); await Promise.resolve();
    expect(settled).toBe(false);
    stream.enqueue(new TextEncoder().encode(JSON.stringify(receipt)));
    await Promise.resolve(); expect(settled).toBe(false);
    stream.close();
    expect(await result).toBe(true);
    expect(request).toHaveBeenCalledExactlyOnceWith("/api/consents", {
      method: "POST", headers: { "content-type": "application/json", "X-Inherit-CSRF": GRANT_CSRF }, body: JSON.stringify(grant.request),
    });
  });
  it.each([
    [201, { ...receipt, purposeKey: "reports.monogenic" }],
    [201, { ...receipt, artifactVersion: 2 }],
    [201, { ...receipt, artifactKey: "consent.upload-self" }],
    [201, { ...receipt, recordId: "not-an-id" }],
    [201, { ...receipt, signedAt: "unknown" }],
    [201, { ...receipt, extra: true }],
    [200, receipt], [409, receipt], [201, { granted: true }],
  ])("refuses status %i with a mismatched or incomplete receipt %j", async (status, data) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(data, { status })));
    expect(await submitFamilyPermission(grant, csrf)).toBe(false);
  });
  it("consumes malformed and broken responses without treating headers as success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not JSON", { status: 201 })));
    expect(await submitFamilyPermission(grant, csrf)).toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.error(new Error("connection interrupted")); },
    }), { status: 201 })));
    expect(await submitFamilyPermission(grant, csrf)).toBe(false);
  });
  it("confirms only the exact revocation response and preserves the selected grant", async () => {
    const action: PermissionAction = { kind: "revoke", grantId: receipt.recordId, nonce: "revoke-nonce" };
    const request = vi.fn().mockResolvedValue(Response.json({ revoked: true, effectiveAt: receipt.signedAt }));
    vi.stubGlobal("fetch", request);
    expect(await submitFamilyPermission(action, csrf)).toBe(true);
    // 20261023120000 (G5.6): the page's one-time nonce travels in its header.
    expect(request).toHaveBeenCalledExactlyOnceWith(`/api/consents/${receipt.recordId}/revoke`, { method: "POST",
      headers: { "X-Inherit-Operation-Nonce": "revoke-nonce", "X-Inherit-CSRF": REVOKE_CSRF } });
    for (const data of [{ revoked: false, effectiveAt: receipt.signedAt }, { revoked: true }, receipt]) {
      request.mockResolvedValue(Response.json(data));
      expect(await submitFamilyPermission(action, csrf)).toBe(false);
    }
  });
  it("lets the control handle transport failure without reporting a permission change", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(submitFamilyPermission(grant, csrf)).rejects.toThrow("offline");
  });
});
