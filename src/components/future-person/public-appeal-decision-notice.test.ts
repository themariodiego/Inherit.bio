import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicAppealDecisionNotice } from "./public-appeal-decision-notice";
import type { PublicAppealDecisionNotice as Notice } from "@/lib/future-person/public-appeal-decision-notice";
const notice: Notice = { deadline: "2026-11-01T00:00:00Z", decisions: [{ documentKind: "appeal-subject-source-control", decision: "rejected", decisionReference: "a".repeat(48) }] };
describe("recipient-only notice page", () => {
 it("shows the actual coded refusal, reference and original deadline without a new authority action", () => {
  const html = renderToStaticMarkup(createElement(PublicAppealDecisionNotice, { notice }));
  expect(html).toContain("Review of your files"); expect(html).toContain("Refused"); expect(html).toContain("a".repeat(48));
  expect(html).toContain('dateTime="2026-11-01T00:00:00Z"'); expect(html).toContain("does not give access");
  expect(html).not.toMatch(/<form|<input|<button|href=|reviewer|target|account|ciphertext/u);
 });
 it("shows acceptance of a file without an access-review reference", () => {
  const html = renderToStaticMarkup(createElement(PublicAppealDecisionNotice, { notice: { ...notice,
   decisions: [{ documentKind: "appeal-photo-identity", decision: "approved", decisionReference: null }] } }));
  expect(html).toContain("File to check your name and age"); expect(html).toContain("Accepted"); expect(html).not.toContain("Review reference");
 });
});
