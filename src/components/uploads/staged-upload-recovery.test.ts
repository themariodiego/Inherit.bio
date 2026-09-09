import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StagedUploadRecovery } from "./staged-upload-recovery";

const interrupted = "The upload could not finish. Your existing files are unchanged. Please try again.";

describe("finishing an upload whose bytes are already stored", () => {
  const props = { message: interrupted, disabled: false, onFinish: () => {} };
  it("offers the action without promising the upload succeeded", () => {
    const html = renderToStaticMarkup(createElement(StagedUploadRecovery, props));
    expect(html).toContain("Try this upload again");
    expect(html).toContain("Finishing it does not send the file again.");
    expect(html).not.toMatch(/is stored and|prepared|reports are ready|succeeded/);
    expect(html).not.toContain('type="file"');
  });
  // The refusal is announced on its own, so a suite that pins the exact alert
  // text still reads the same sentence after the action is offered beside it.
  it("keeps the refusal as the whole text of its own alert", () => {
    const html = renderToStaticMarkup(createElement(StagedUploadRecovery, props));
    const alert = html.match(/<p role="alert"[^>]*>(.*?)<\/p>/)?.[1];
    expect(alert).toBe(interrupted);
    expect(alert).not.toContain("<button");
  });
  it("disables the action while the owning uploader is busy", () => {
    const html = renderToStaticMarkup(createElement(StagedUploadRecovery, { ...props, disabled: true }));
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });
});
