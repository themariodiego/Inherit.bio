import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OWN_REPORT_CHOICES, OWN_REPORT_PURPOSES, type OwnReportChoicesView } from "@/lib/uploads/own-report-purpose";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { OwnReportChoices } from "./own-report-choices";

const files = [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", label: "File 1" }];
type Reconsent = Extract<OwnReportChoicesView, { kind: "ready" }>["choices"][number]["reconsent"];
function render(enabled: string[] = [], reconsent: Record<string, Reconsent> = {}) {
  const view: Extract<OwnReportChoicesView, { kind: "ready" }> = { kind: "ready", subjectId: files[0].id,
    choices: OWN_REPORT_PURPOSES.map(purpose => ({ purposeKey: purpose, ...OWN_REPORT_CHOICES[purpose],
      granted: enabled.includes(purpose), grantId: enabled.includes(purpose) ? files[0].id : null,
      token: `test-${purpose}`, statementKeys: ["make-this-result-for-me"],
      artifact: { key: OWN_REPORT_CHOICES[purpose].artifactKey, version: 2, body: `Terms for ${purpose}` },
      reconsent: reconsent[purpose] ?? null,
    })) };
  return renderToStaticMarkup(createElement(OwnReportChoices, { view, files }));
}

describe("independent report choice panel", () => {
  it("starts with three unchecked choices, no inferred opt-in and a disabled generation button", () => {
    const html = render();
    expect(html.match(/type="checkbox"/g)).toHaveLength(3);
    expect(html.indexOf("Trait reports and estimates")).toBeLessThan(html.indexOf("Observed genetic variants"));
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
  it("enables ancestry independently and links its results while describing the lineage limit", () => {
    const html = render(["ancestry"]);
    expect(html).toContain("Parent lines are not computed yet.");
    expect(html).toContain('href="/genome/me/ancestry"');
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Generate selected reports<\/button>/);
  });
});

/**
 * G5.2 requires the re-consent surface to state what changed, in the same
 * block as the accept control, and to link the version that was signed. The
 * "same block" clause is what these assert positionally: a change summary
 * rendered somewhere else on the page satisfies the words and not the
 * requirement, because the person deciding is looking at the control.
 */
describe("re-consent after a document is superseded", () => {
  const changed = {
    "reports.monogenic": { signedVersion: 1, changes: [{ version: 2, summary: "Clarifies that this layer shows observed variants." }] },
  };
  it("says what changed and links the signed version, in the block holding the accept control", () => {
    const html = render([], changed);
    const block = html.slice(html.indexOf('data-testid="reconsent-notice"'));
    const end = block.indexOf("Enable Observed genetic variants");
    expect(end, "the notice must precede the control it belongs to").toBeGreaterThan(0);
    const sameBlock = block.slice(0, end);
    expect(sameBlock).toContain("Clarifies that this layer shows observed variants.");
    expect(sameBlock).toContain('href="/legal/consent/consent.own-monogenic/v/1"');
    expect(sameBlock).toContain("You agreed to version 1");
    // The checkbox is the accept control; the notice is useless behind it.
    expect(sameBlock).toContain('type="checkbox"');
  });
  it("shows every version between the one signed and the current one, not only the newest", () => {
    const html = render([], {
      "reports.monogenic": { signedVersion: 1, changes: [
        { version: 2, summary: "Second version changed the scope." },
        { version: 3, summary: "Third version changed the retention." },
      ] },
    });
    expect(html).toContain("Second version changed the scope.");
    expect(html).toContain("Third version changed the retention.");
    expect(html.match(/data-testid="reconsent-change"/g)).toHaveLength(2);
  });
  it("says nothing about changes to someone who never agreed before", () => {
    expect(render()).not.toContain('data-testid="reconsent-notice"');
    expect(render([], changed).match(/data-testid="reconsent-notice"/g)).toHaveLength(1);
  });
  it("does not nag once the current version is agreed to", () => {
    const html = render(["reports.monogenic"], changed);
    expect(html).not.toContain('data-testid="reconsent-notice"');
    expect(html).toContain("Turn off Observed genetic variants");
  });
});
