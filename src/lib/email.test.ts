import { afterEach, describe, expect, it, vi } from "vitest";
import { mailSubject, renderMail, sendReportReady, sendResearchDigest } from "./email";

describe("send helpers without RESEND_API_KEY", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("no-op with a warning instead of crashing", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const sentReport = await sendReportReady("user@example.test", {
      reportCount: 3,
      dashboardUrl: "https://example.test/d",
    });
    const sentDigest = await sendResearchDigest("user@example.test", {
      entries: [{ title: "T", summary: "S", url: "https://example.test/r" }],
      manageUrl: "https://example.test/settings",
    });

    expect(sentReport).toBe(false);
    expect(sentDigest).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toContain("RESEND_API_KEY unset");
  });
});


describe("minimum owner notice renderer", () => {
  it("renders only the fixed claim status and fragment objection link", async () => {
    const mail = { id: "future-person-owner-notice", payload: {
      objectionUrl: "https://example.test/withdraw/request#synthetic-objection",
    } } as const;
    const html = await renderMail(mail);
    expect(mailSubject(mail)).toBe("A claim needs your review on Inherit");
    expect(html).toContain(mail.payload.objectionUrl);
    expect(html).toContain("The claim is pending.");
    expect(html).toContain("30 days");
    for (const forbidden of ["verifiedName", "dateOfBirth", "parentNames", "genotype", "genome", "approved"])
      expect(html).not.toContain(forbidden);
  });
  it("renders the fixed minimal information request without identity, reason, authority or a new closing date", async () => {
    const mail = { id: "future-person-more-information", payload: {} } as const;
    const html = await renderMail(mail);
    expect(mailSubject(mail)).toBe("We need more information about your Inherit request");
    expect(html).toContain("We need more details");
    expect(html).toContain("Your request stays pending, and its closing date stays the same.");
    expect(html).toContain("This message gives no access to a record.");
    expect(html).not.toMatch(/contactEmail|verifiedName|dateOfBirth|parentNames|candidate|recordKey|recoveryKey|review_reason|synthetic|\d{4}-\d{2}-\d{2}/iu);
    expect(html).not.toMatch(/href=["'][^"']*#/iu);
    expect(html).not.toContain("/withdraw/request");
  });
});
