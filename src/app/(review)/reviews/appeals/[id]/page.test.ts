import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
const mocks = vi.hoisted(() => ({ open: vi.fn(), account: vi.fn(), rpc: vi.fn(), retry: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("opaque404"); } }));
vi.mock("@/lib/future-person/appeals-open", () => ({ testAppealIntakeOpen: mocks.open }));
vi.mock("@/lib/account-deletion", () => ({ getSensitiveAccountContext: mocks.account }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/components/future-person/public-appeal-review", () => ({ PublicAppealReview: () => null }));
import Page from "./page";
import { sealNewAppeal } from "@/lib/future-person/appeal-case-envelope";
import { appealReviewRow } from "@/lib/future-person/public-appeal-review";
const id = (n: number) => `89000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const run = (caseId = id(1), search: Record<string, string> = {}) => Page({ params: Promise.resolve({ id: caseId }), searchParams: Promise.resolve(search) });
function current(caseId = id(1), deadline = new Date(Date.now() + 30 * 86400000).toISOString()) {
 const scope = { version: 1, caseKind: "appeal", caseId, originalAuthorPrincipalId: id(2), initialStatementRevision: 1,
  originalSubmittedAt: new Date(Date.now() - 1000).toISOString(), originalDeadline: deadline, intakeKind: "subject-objection" };
 const { format, ...encrypted } = sealNewAppeal(scope, { kind: "subject-objection", claimantName: "Synthetic Claimant",
  contactEmail: "synthetic@example.test", statement: "This original statement asks for a human review of source control.", affirmed: true });
 void format;
 return { contextVersion: "appeal-case-final-context-v1", caseId, caseKind: "subject-objection", scope,
  reviewRevision: 1, evidenceRevision: 1, deadline, ...encrypted, documents: [], documentDecisionsAvailable: false, allowedDecisions: ["reject"] };
}
beforeEach(() => {
 vi.stubGlobal("React", React); vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 89).toString("base64")); vi.clearAllMocks();
 mocks.open.mockReturnValue(true); mocks.account.mockResolvedValue({ user: { id: id(3) }, sessionId: id(4) });
 mocks.rpc.mockReturnValue({ retry: mocks.retry }); mocks.retry.mockResolvedValue({ data: current(), error: null });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("the rejection page's separate own-JWT current-case entry", () => {
 it("reaches the viewer for genuinely sealed incomplete evidence without relaxing the whole documentary decoder", async () => {
  const row = current(); mocks.retry.mockResolvedValue({ data: row, error: null });
  const { contextVersion, documentDecisionsAvailable, allowedDecisions, ...documentary } = row;
  void contextVersion; void documentDecisionsAvailable; void allowedDecisions;
  expect(appealReviewRow.safeParse(documentary).success).toBe(false);
  const rendered = await run(); expect(rendered.type).toBe("main");
  expect(mocks.rpc.mock.calls).toEqual([["read_public_appeal_case_context_v1", { p_case: id(1) }]]);
  expect(mocks.retry.mock.calls).toEqual([[false]]);
  expect(JSON.stringify(rendered)).not.toContain(row.wrappedCaseKeyHex);
  expect(JSON.stringify(rendered)).not.toContain("synthetic@example.test");
 });
 it.each(["42501", "P0001"])("keeps native refusal %s opaque", async code => {
  mocks.retry.mockResolvedValue({ data: null, error: { code } }); await expect(run()).rejects.toThrow("opaque404");
 });
 it.each(["foreign", "expired", "expanded", "swapped-key"])("refuses a %s native case", async state => {
  const row = state === "foreign" ? current(id(5)) : state === "expired" ? current(id(1), new Date(Date.now() - 1).toISOString())
   : state === "expanded" ? { ...current(), targetId: id(5) } : { ...current(), wrappedCaseKeyHex: "e".repeat(144) };
  mocks.retry.mockResolvedValue({ data: row, error: null }); await expect(run()).rejects.toThrow("opaque404");
 });
 it("reads no case without the caller's sensitive account", async () => {
  mocks.account.mockResolvedValue(null); await expect(run()).rejects.toThrow("opaque404"); expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it.each(["closed", "selector", "query"])("refuses %s before account and native lookup", async state => {
  if (state === "closed") mocks.open.mockReturnValue(false);
  await expect(run(state === "selector" ? "INVALID" : id(1), state === "query" ? { target: id(5) } : {})).rejects.toThrow("opaque404");
  expect(mocks.account).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
 });
});
