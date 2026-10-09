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
 });
});
