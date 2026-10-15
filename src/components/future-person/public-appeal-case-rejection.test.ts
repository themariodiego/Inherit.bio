import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PublicAppealCaseRejection } from "./public-appeal-case-rejection";
describe("separate final-case rejection control", () => {
 it("keeps the exact visible reason label separate from the controlled textarea and associates each instance uniquely", () => {
  const props = { caseId: "87000000-0000-4000-8000-000000000001", reviewRevision: 1,
   csrf: "a".repeat(64), nonce: "synthetic-case-nonce", disabled: false, onResolved: vi.fn() };
  const html = renderToStaticMarkup(createElement("div", null,
   createElement(PublicAppealCaseRejection, props), createElement(PublicAppealCaseRejection, props)));
  const labels = [...html.matchAll(/<label class="block" for="([^"]+)">Reason<\/label>/gu)];
  expect(labels).toHaveLength(2);
  expect(new Set(labels.map(label => label[1])).size).toBe(2);
  for (const label of labels) expect(html).toContain(`<textarea id="${label[1]}"`);
  expect(html).not.toMatch(/>Reason<textarea/u);
 });
 it("requires a professional reason and explicit read confirmation, and offers no target-changing decision", () => {
  const html = renderToStaticMarkup(createElement(PublicAppealCaseRejection, { caseId: "87000000-0000-4000-8000-000000000001",
   reviewRevision: 1, csrf: "a".repeat(64), nonce: "synthetic-case-nonce", disabled: false, onResolved: vi.fn() }));
  expect(html).toContain("This closes only this request."); expect(html).toContain("does not give access");
  expect(html).toContain("I have read this request and the files that are here.");
  expect(html).toMatch(/disabled=""[^>]*>Refuse request/u); expect(html).toContain('maxLength="2000"');
  expect(html).not.toContain("approve-access"); expect(html).not.toContain('name="targetId"');
  expect(html).not.toContain("Keep the same choice");
  expect(html).toContain('aria-busy="false"');
  expect(html).not.toContain("Saving this choice.");
 });
 it("offers only native-admitted prior uphold with the same reason/read confirmation and no access or reversal control", () => {
  const html = renderToStaticMarkup(createElement(PublicAppealCaseRejection, { caseId: "87000000-0000-4000-8000-000000000001",
   reviewRevision: 4, csrf: "a".repeat(64), nonce: "synthetic-case-nonce", disabled: false, allowUphold: true, onResolved: vi.fn() }));
  expect(html).toMatch(/disabled=""[^>]*>Keep the same choice/u); expect(html).toContain("This does not give access.");
  expect(html).not.toContain("reverse-prior-decision"); expect(html).not.toContain("approve-access");
  expect(html).not.toContain('name="priorDecisionId"');
 });
});

it("offers a nonfinal request only when the native header admits it, with no client recipient or new deadline", () => {
 const props = { caseId: "87000000-0000-4000-8000-000000000001", reviewRevision: 2, csrf: "a".repeat(64),
  nonce: "synthetic-current-information-form", disabled: false, onResolved: vi.fn(), onMoreInformation: vi.fn() };
 expect(renderToStaticMarkup(createElement(PublicAppealCaseRejection, props))).not.toContain("Ask for more files");
 const html = renderToStaticMarkup(createElement(PublicAppealCaseRejection, { ...props, allowMoreInformation: true }));
 expect(html).toMatch(/disabled=""[^>]*>Ask for more files/u);
 expect(html).toContain("keeps the same deadline and gives no access");
 expect(html).not.toMatch(/name="(?:recipient|email|deadline|targetId)"/u);
});


it("offers exact native-admitted correction only with a fresh evidence requirement and no target input", () => {
 const props = { caseId: "87000000-0000-4000-8000-000000000001", reviewRevision: 4, csrf: "a".repeat(64),
  nonce: "synthetic-correction-form", disabled: false, onResolved: vi.fn() };
 expect(renderToStaticMarkup(createElement(PublicAppealCaseRejection, props))).not.toContain("Change this choice");
 const html = renderToStaticMarkup(createElement(PublicAppealCaseRejection, { ...props, reversal: { priorDecisionRevision: 3, evidenceRevision: 4 } }));
 expect(html).toMatch(/disabled=""[^>]*>Change this choice/u);
 expect(html).toContain("The old files cannot be opened. A new request with new files is needed.");
 expect(html).toContain("This gives no access.");
 expect(html).not.toMatch(/name="(?:targetId|priorDecisionId|recipient|deadline)"/u);
});
