import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PublicAppealCaseRejection } from "./public-appeal-case-rejection";
describe("separate final-case rejection control", () => {
 it("requires a professional reason and explicit read confirmation, and offers no target-changing decision", () => {
  const html = renderToStaticMarkup(createElement(PublicAppealCaseRejection, { caseId: "87000000-0000-4000-8000-000000000001",
   reviewRevision: 1, csrf: "a".repeat(64), nonce: "synthetic-case-nonce", disabled: false, onResolved: vi.fn() }));
  expect(html).toContain("This closes only this request."); expect(html).toContain("does not give access");
  expect(html).toContain("I have read this request and the files that are here.");
  expect(html).toMatch(/disabled=""[^>]*>Refuse request/u); expect(html).toContain('maxLength="2000"');
  expect(html).not.toContain("approve-access"); expect(html).not.toContain('name="targetId"');
  expect(html).not.toContain("Keep the same choice");
 });
 it("offers only native-admitted prior uphold with the same reason/read confirmation and no access or reversal control", () => {
  const html = renderToStaticMarkup(createElement(PublicAppealCaseRejection, { caseId: "87000000-0000-4000-8000-000000000001",
   reviewRevision: 4, csrf: "a".repeat(64), nonce: "synthetic-case-nonce", disabled: false, allowUphold: true, onResolved: vi.fn() }));
  expect(html).toMatch(/disabled=""[^>]*>Keep the same choice/u); expect(html).toContain("This does not give access.");
  expect(html).not.toContain("reverse-prior-decision"); expect(html).not.toContain("approve-access");
  expect(html).not.toContain('name="priorDecisionId"');
 });
});
