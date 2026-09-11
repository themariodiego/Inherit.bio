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
  /**
   * The automatic attempts are the point of the 2026-09-11 change, and the
   * risk they carry is doing something on a person's behalf without saying so.
   * So the notice is asserted, and asserted to sit OUTSIDE the alert: the
   * refusal is still true while a retry is pending, and a screen reader must
   * hear the refusal rather than a reassurance about it.
   */
  it("says an automatic attempt is coming, without softening the refusal", () => {
    const html = renderToStaticMarkup(createElement(StagedUploadRecovery, { ...props, retrying: true }));
    expect(html).toContain("Trying again automatically. You can also try now.");
    expect(html.match(/<p role="alert"[^>]*>(.*?)<\/p>/)?.[1]).toBe(interrupted);
    // The button never goes away: it is how a person acts sooner.
    expect(html).toContain("Try this upload again");
  });

  it("says nothing about retrying once the attempts are spent", () => {
    const html = renderToStaticMarkup(createElement(StagedUploadRecovery, { ...props, retrying: false }));
    expect(html).not.toContain("automatically");
    expect(html).toContain("Try this upload again");
  });

  it("disables the action while the owning uploader is busy", () => {
    const html = renderToStaticMarkup(createElement(StagedUploadRecovery, { ...props, disabled: true }));
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });
});
