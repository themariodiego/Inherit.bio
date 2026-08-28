// Renders each template to HTML (node environment) and asserts key strings.
// createElement instead of JSX so the file stays .test.ts per repo convention.
import { createElement } from "react";
import { render } from "@react-email/components";
import { describe, expect, it } from "vitest";
import { ReportReadyEmail } from "./report-ready";
import { ResearchDigestEmail } from "./research-digest";

const ATTRIBUTION =
  "Sequence · an open-source project in collaboration with Plus Bio";
const DISCLAIMER = "Informational, not medical advice.";

describe("report-ready email", () => {
  it("renders file name, count, dashboard link, and footer lines", async () => {
    const html = await render(
      createElement(ReportReadyEmail, {
        fileName: "genome_v5.txt",
        reportCount: 12,
        dashboardUrl: "https://example.test/dashboard",
      }),
    );
    expect(html).toContain("Your reports are ready");
    expect(html).toContain("genome_v5.txt");
    expect(html).toContain("12 reports are");
    expect(html).toContain("https://example.test/dashboard");
    expect(html).toContain(ATTRIBUTION);
    expect(html).toContain(DISCLAIMER);
  });

  it("uses singular phrasing for one report", async () => {
    const html = await render(
      createElement(ReportReadyEmail, {
        fileName: "a.vcf",
        reportCount: 1,
        dashboardUrl: "https://example.test/d",
      }),
    );
    expect(html).toContain("1 report is");
  });
});

describe("research-digest email", () => {
  it("renders entries, manage-preferences link, and footer lines", async () => {
    const html = await render(
      createElement(ResearchDigestEmail, {
        entries: [
          {
            title: "Caffeine metabolism",
            summary: "A CYP1A2 report.",
            url: "https://example.test/r/caffeine",
          },
          {
            title: "Lactase persistence",
            summary: "An MCM6 report.",
            url: "https://example.test/r/lactase",
          },
        ],
        manageUrl: "https://example.test/settings/email",
      }),
    );
    expect(html).toContain("Caffeine metabolism");
    expect(html).toContain("A CYP1A2 report.");
    expect(html).toContain("https://example.test/r/lactase");
    expect(html).toContain("Manage email preferences");
    expect(html).toContain("https://example.test/settings/email");
    expect(html).toContain(ATTRIBUTION);
    expect(html).toContain(DISCLAIMER);
  });
});
