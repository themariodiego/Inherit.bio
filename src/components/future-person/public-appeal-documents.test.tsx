import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { PublicAppealDocuments } from "./public-appeal-documents";
import type { PublicAppealView } from "@/lib/future-person/public-appeal-session";
const view: PublicAppealView = { caseKind: "subject-objection", deadline: "2026-11-01T00:00:00Z",
 documentKinds: ["appeal-photo-identity", "appeal-subject-source-control"], evidenceState: "collecting", completionAvailable: true, documents: [] };
const render = (overrides: Partial<PublicAppealView> = {}) => renderToStaticMarkup(createElement(PublicAppealDocuments, {
 view: { ...view, ...overrides }, documentNonce: "synthetic-document-form", completeNonce: "synthetic-complete-form", documentCsrf: "a".repeat(64), completeCsrf: "b".repeat(64),
}));
describe("purpose-bound public appeal evidence page", () => {
 it("presents only its two registered kind labels with accessible file controls and no target selector", () => {
  const html = render();expect(html).toContain("Photo identity document");expect(html).toContain("Evidence that the source is yours");
  expect(html).not.toContain("genetic parent role");expect(html.match(/type="file"/gu)).toHaveLength(2);
  expect(html).toContain('for="appeal-appeal-photo-identity"');expect(html).toContain('aria-describedby="appeal-appeal-photo-identity-hint"');
  expect(html).toContain("The original filename is not sent");expect(html).toContain("do not give you access");
  expect(html).not.toMatch(/name="(?:subjectId|cohortId|accountId|reviewer)"/u);
 });
 it("keeps completion unavailable without both received documents and affirmation", () => {
  expect(render()).toMatch(/disabled=""[^>]*>Submit evidence for review/u);
 });
 it("keeps a genuinely unbound access-review producer closed", () => {
  const html = render({ caseKind: "access-or-review-appeal", documentKinds: ["appeal-photo-identity", "appeal-decision-notice"], completionAvailable: false });
  expect(html).toContain("underlying decision must be identified");expect(html).not.toContain("Submit evidence for review");
 });
 it("uses the server-selected genetic-parent proof and never substitutes subject control", () => {
  const html = render({ caseKind: "genetic-parent-objection", documentKinds: ["appeal-photo-identity", "appeal-genetic-parent-authority"] });
  expect(html).toContain("Evidence of your genetic parent role");expect(html).not.toContain("Evidence that the source is yours");
 });
});
