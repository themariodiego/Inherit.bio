import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OWN_REPORT_CHOICES, OWN_REPORT_PURPOSES, type OwnReportChoicesView } from "@/lib/uploads/own-report-purpose";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { OwnReportChoices } from "./own-report-choices";

const files = [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", label: "File 1" }];
function render(enabled: string[] = []) {
  const view: Extract<OwnReportChoicesView, { kind: "ready" }> = { kind: "ready", subjectId: files[0].id,
    choices: OWN_REPORT_PURPOSES.map(purpose => ({ purposeKey: purpose, ...OWN_REPORT_CHOICES[purpose],
      granted: enabled.includes(purpose), grantId: enabled.includes(purpose) ? files[0].id : null,
      token: `test-${purpose}`, statementKeys: ["make-this-result-for-me"],
      artifact: { key: OWN_REPORT_CHOICES[purpose].artifactKey, version: 2, body: `Terms for ${purpose}` },
    })) };
  return renderToStaticMarkup(createElement(OwnReportChoices, { view, files }));
}

describe("independent report choice panel", () => {
  it("starts with three unchecked choices, no inferred opt-in and a disabled generation button", () => {
    const html = render();
    expect(html.match(/type="checkbox"/g)).toHaveLength(3);
    expect(html).not.toContain("checked=");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Generate selected reports<\/button>/);
    for (const purpose of OWN_REPORT_PURPOSES) expect(html).toContain(`Terms for ${purpose}`);
    expect(html).toContain("You can turn a choice off here later.");
  });
  it("enables generation for one report type while leaving the others unchecked", () => {
    const html = render(["reports.polygenic"]);
    expect(html).toContain("Turn off Trait reports and estimates");
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).not.toContain("checked=");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Generate selected reports<\/button>/);
  });
  it("does not advertise ancestry generation when only ancestry is selected", () => {
    const html = render(["ancestry"]);
    expect(html).toContain("Ancestry generation for new uploads is not available yet.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Generate selected reports<\/button>/);
  });
});
