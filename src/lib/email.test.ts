import { describe, expect, it } from "vitest";
import { reportReadyHtml, researchDigestHtml } from "./email";

describe("email templates", () => {
  it("report-ready carries brand, attribution, and no-medical-advice line", () => {
    const html = reportReadyHtml({
      fileName: "sample.vcf",
      reportCount: 42,
      dashboardUrl: "https://example.test/reports",
    });
    expect(html).toContain("sample.vcf");
    expect(html).toContain("42 reports");
    expect(html).toContain("in collaboration with Plus Bio");
    expect(html).toContain("Informational, not medical advice");
    expect(html).toContain("https://example.test/reports");
  });

  it("digest lists only public report info with a manage-preferences link", () => {
    const html = researchDigestHtml({
      entries: [
        { title: "Caffeine metabolism", summary: "A CYP1A2 report.", url: "https://example.test/r/x" },
      ],
      manageUrl: "https://example.test/settings",
    });
    expect(html).toContain("Caffeine metabolism");
    expect(html).toContain("A CYP1A2 report.");
    expect(html).toContain("https://example.test/settings");
    expect(html).toContain("Informational, not medical advice");
  });
});
