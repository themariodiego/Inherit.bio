import fs from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { OTHER_ADULT_REVIEW_COPY as REVIEW, OTHER_ADULT_UPLOAD_COPY as COPY } from "@/copy/upload/other-adult";
import { parseArtifactFile } from "@/lib/legal/artifact-file";
import {
  OTHER_ADULT_UPLOAD_STATEMENT_KEYS,
  artifactStatements,
  artifactWarning,
  type OtherAdultTarget,
} from "@/lib/uploads/other-adult-upload";
import { AdultSubjectReviewForm } from "../embryo/adult-subject-review-form";
import { FileRowActions } from "./file-row-actions";
import { OtherAdultUploadCard } from "./other-adult-upload-card";

/**
 * The screens `e2e/other-adult-upload.spec.ts` drives, rendered here so every
 * selector and sentence that spec relies on is pinned before a browser runs.
 */
const file = parseArtifactFile(fs.readFileSync("content/legal/consent.upload-other-adult/v1.md", "utf8"))!;
const texts = artifactStatements(file.body);
const base: OtherAdultTarget = {
  subjectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", label: "Invited adult",
  invitedAt: "2026-09-28T10:00:00Z", answerBy: "2026-10-28T10:00:00Z", state: "unsigned", heldAt: null, deleteBy: null,
};
const consent = { token: "t".repeat(40), version: 1, effectiveOn: "2026-09-28", summary: file.summary, body: file.body,
  statements: OTHER_ADULT_UPLOAD_STATEMENT_KEYS.map((key, index) => ({ key, text: texts[index]! })),
  warning: artifactWarning(file.body)! };
const render = (target: OtherAdultTarget) => renderToStaticMarkup(createElement(OtherAdultUploadCard, { target }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("the uploader's card", () => {
  it("asks for each statement, the typed name and shows the warning above a closed control", () => {
    const html = render({ ...base, consent });
    expect(html.match(/type="checkbox"/g)).toHaveLength(7);
    for (const statement of texts) expect(text(html)).toContain(statement);
    expect(html).toContain(COPY.typedNameLabel);
    expect(html).toContain("data-legal-summary");
    expect(html.indexOf(consent.warning.slice(0, 40))).toBeLessThan(html.lastIndexOf(COPY.signButton));
    expect(html).toMatch(new RegExp(`<button[^>]*disabled[^>]*>${COPY.signButton}</button>`));
    expect(html).not.toContain('type="file"');
  });
  it("offers the file only once signed", () => {
    const html = render({ ...base, state: "signed" });
    expect(html).toContain('data-slot="other-adult-file"');
    expect(html).toContain(`aria-label="${COPY.chooseLabel}"`);
    expect(html).toContain(COPY.chooseButton);
    expect(html).not.toContain('type="checkbox"');
  });
  it("shows one line and nothing to act on while held", () => {
    const html = render({ ...base, state: "held", heldAt: "2026-09-28T11:00:00Z", deleteBy: "2026-10-28T10:00:00Z" });
    expect(html).toContain('data-slot="other-adult-held"');
    expect(text(html)).toContain(COPY.heldStatus("Invited adult"));
    expect(text(html)).toContain(COPY.heldDeadline("28 October 2026"));
    expect(html).not.toMatch(/<button|type="file"|type="checkbox"/);
  });
  it("closes the upload once the invited adult is reviewing, and says why when it cannot be signed", () => {
    expect(text(render({ ...base, state: "reviewing" }))).toContain(COPY.reviewingStatus);
    expect(text(render({ ...base, blockedBy: "account-completion" }))).toContain(COPY.accountFirstStatus);
    expect(text(render({ ...base, blockedBy: "unavailable" }))).toContain(COPY.unavailableStatus);
    expect(render({ ...base, state: "reviewing" })).not.toMatch(/<button|type="file"/);
  });
});

describe("the invited adult's review", () => {
  const review = { nonce: "n".repeat(40), acceptanceBlockedBy: "sign-in" as const,
    artifact: { version: 1, effectiveOn: "2026-09-01", summaryMarkdown: "Summary.", bodyMarkdown: "Body.", bodySha256: "a".repeat(64) } };
  it("names the held file, when it was added and when it is deleted", () => {
    const html = renderToStaticMarkup(createElement(AdultSubjectReviewForm, { review: { ...review,
      heldUpload: { addedOn: "2026-09-28T11:00:00Z", deleteBy: "2026-10-28T10:00:00Z" } } }));
    expect(html).toContain('data-slot="held-upload"');
    expect(text(html)).toContain(REVIEW.heldHeading);
    expect(text(html)).toContain(REVIEW.heldAdded("28 September 2026"));
    expect(text(html)).toContain(REVIEW.heldChoices("28 October 2026"));
    expect(html).not.toContain("No genetic data has been shared");
  });
  it("keeps its earlier words when nothing is held", () => {
    const html = renderToStaticMarkup(createElement(AdultSubjectReviewForm, { review: { ...review, heldUpload: null } }));
    expect(html).toContain("No genetic data has been shared");
    expect(html).not.toContain('data-slot="held-upload"');
  });
});

describe("the released file's own row", () => {
  it("offers the subject the one control the browser journey uses", () => {
    const html = renderToStaticMarkup(createElement(FileRowActions,
      { fileId: base.subjectId, status: "uploaded", tier: 1, preparationOnly: true }));
    expect(html).toMatch(/<button[^>]*>Prepare<\/button>/);
  });
});
