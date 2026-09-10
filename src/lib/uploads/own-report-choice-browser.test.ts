import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { disableOwnReportChoice, enableOwnReportChoice, generateOwnReports } from "./own-report-choice-browser";
const fetchMock = vi.fn();
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const choice = { purposeKey: "reports.polygenic" as const, label: "Trait reports and estimates", description: "Traits",
  granted: false, grantId: null, artifact: { key: "consent.own-polygenic", version: 2, body: "The permission" },
  token: "presentation-token", statementKeys: ["make-this-result-for-me"], reconsent: null };
const receipt = { recordKind: "purpose_grant", recordId: otherId, artifactKey: choice.artifact.key,
  artifactVersion: 2, purposeKey: choice.purposeKey, signedAt: "2026-09-06T12:00:00Z" };
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => vi.unstubAllGlobals());
const reply = (body: unknown, status = 200) => fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe("own report choice transport", () => {
  it("sends only the one explicitly chosen purpose and presented artifact", async () => {
    reply(receipt, 201); await enableOwnReportChoice(id, choice);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/consents");
    expect(request.headers["x-inherit-csrf"]).toBe(choice.token);
    expect(JSON.parse(request.body)).toEqual({ action: "grant-purpose", subjectId: id, purposeKey: "reports.polygenic",
      artifactVersion: 2, artifactPresentationToken: choice.token, affirmed: true, statementKeys: ["make-this-result-for-me"] });
  });
  it.each([{ purposeKey: "ancestry" }, { artifactVersion: 1 }, { artifactKey: "consent.own-monogenic" },
    { privateField: "unexpected" }, { recordKind: "signature" }])("refuses a mismatched or open receipt: %j", async patch => {
    reply({ ...receipt, ...patch }, 201);
    await expect(enableOwnReportChoice(id, choice)).rejects.toThrow("choice_not_saved");
  });
  it("does not treat a success-shaped error status as permission", async () => {
    reply(receipt, 409); await expect(enableOwnReportChoice(id, choice)).rejects.toThrow();
  });
  it("withdraws exactly the given grant without a client-selected purpose override", async () => {
    reply({ revoked: true, effectiveAt: "2026-09-06T12:00:00Z" }); await disableOwnReportChoice(otherId);
    expect(fetchMock).toHaveBeenCalledWith(`/api/consents/${otherId}/revoke`, { method: "POST" });
  });
  it("does not accept an unconfirmed withdrawal", async () => {
    reply({ revoked: true }); await expect(disableOwnReportChoice(otherId)).rejects.toThrow();
  });
  it("distinguishes generated results from source preparation", async () => {
    reply({ fileId: id, status: "processed", analysisState: "active" });
    await expect(generateOwnReports(id)).resolves.toBe("ready");
    expect(fetchMock).toHaveBeenCalledWith(`/api/files/${id}/process`, { method: "POST" });
    reply({ fileId: id, status: "normalization_complete", analysisState: "not_generated" });
    await expect(generateOwnReports(id)).resolves.toBe("not_generated");
  });
  it.each([{ fileId: otherId }, { analysisState: "not_generated" }, { results: [] }])("does not advertise readiness from an invalid receipt: %j", async patch => {
    reply({ fileId: id, status: "processed", analysisState: "active", ...patch });
    await expect(generateOwnReports(id)).rejects.toThrow();
  });
  it("refuses malformed ids before issuing requests", async () => {
    await expect(disableOwnReportChoice("../other")).rejects.toThrow();
    await expect(generateOwnReports("../other")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
