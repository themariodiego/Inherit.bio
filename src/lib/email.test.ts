import { afterEach, describe, expect, it, vi } from "vitest";
import { sendReportReady, sendResearchDigest } from "./email";

describe("send helpers without RESEND_API_KEY", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("no-op with a warning instead of crashing", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const sentReport = await sendReportReady("user@example.test", {
      fileName: "a.vcf",
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
