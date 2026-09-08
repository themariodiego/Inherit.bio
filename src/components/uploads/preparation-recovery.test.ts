import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PreparationRecovery } from "./preparation-recovery";

describe("truthful preparation recovery", () => {
  const props = { disabled: false, onRetry: () => {}, reportsHref: "/genome/me/reports", fileHref: "/files" };
  it("acknowledges preparation but neither report absence nor all-ready after a report failure", () => {
    const html = renderToStaticMarkup(createElement(PreparationRecovery, { ...props, code: "report_generation_unavailable" }));
    expect(html).toContain("Your file was prepared, but we could not confirm that your selected reports are ready.");
    expect(html).toContain("Retry selected reports");
    expect(html).toContain('href="/genome/me/reports"'); expect(html).toContain('href="/files"');
    expect(html).not.toMatch(/Retry preparation|preparation did not finish|not been generated|Your file is stored and your selected reports are ready/);
    expect(html).not.toContain('type="file"');
  });
  it("keeps unknown/network outcomes uncertain and offers same-file preparation retry", () => {
    const html = renderToStaticMarkup(createElement(PreparationRecovery, { ...props, code: "unavailable" }));
    expect(html).toContain("We could not confirm whether file preparation finished.");
    expect(html).toContain("Retry preparation");
    expect(html).not.toMatch(/file was prepared|Retry selected reports|reports are ready/);
  });
  it("retains the build refusal without suggesting retrying an unsupported reference", () => {
    const html = renderToStaticMarkup(createElement(PreparationRecovery, { ...props, code: "build_unknown" }));
    expect(html).toContain("GRCh37 or GRCh38"); expect(html).not.toContain("<button");
  });
  it("disables the retry action when the owning uploader is disabled", () => {
    const html = renderToStaticMarkup(createElement(PreparationRecovery, { ...props, code: "report_generation_unavailable", disabled: true }));
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });
  it("gives the Files row a report recovery link without implying a new upload or preparation", () => {
    const html = renderToStaticMarkup(createElement(PreparationRecovery, {
      disabled: false, reportsHref: props.reportsHref, code: "report_generation_unavailable",
    }));
    expect(html).toContain("Review your reports"); expect(html).not.toContain("<button");
    expect(html).not.toContain("Retry preparation");
  });
});
