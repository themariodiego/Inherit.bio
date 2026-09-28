import fs from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import {
  ADULT_UPLOAD_REVISION_COPY as REVISION,
  OTHER_ADULT_UPLOAD_COPY as COPY,
  PATH_B_REQUEST_COPY as REQUEST,
} from "@/copy/upload/other-adult";
import { JURISDICTION_AFFIRM, JURISDICTION_SELECT_LABEL } from "@/copy/settings/jurisdiction";
import { parseArtifactFile } from "@/lib/legal/artifact-file";
import {
  OTHER_ADULT_UPLOAD_STATEMENT_KEYS,
  SUBJECT_ESIGNATURE_STATEMENT_KEYS,
  artifactStatements,
  artifactWarning,
  type OtherAdultTarget,
} from "@/lib/uploads/other-adult-upload";
import { AdultSubjectReviewForm } from "../embryo/adult-subject-review-form";
import { AdultUploadRevisionForm } from "./adult-upload-revision-form";
import { latestFileLine } from "./other-adult-lines";
import { OtherAdultNewPersonForm, OtherAdultUploadCard } from "./other-adult-upload-card";
import { PathBRequestForm } from "./path-b-request-form";

/**
 * The screens `e2e/other-adult-upload.spec.ts` drives, rendered here so every
 * selector and sentence that spec relies on is pinned before a browser runs.
 */
const uploader = parseArtifactFile(fs.readFileSync("content/legal/consent.upload-other-adult/v2.md", "utf8"))!;
const person = parseArtifactFile(fs.readFileSync("content/legal/consent.subject-adult-esignature/v1.md", "utf8"))!;
const texts = artifactStatements(uploader.body);
const base: OtherAdultTarget = {
  subjectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", label: "Synthetic Relative",
  requestedAt: "2026-09-28T10:00:00Z", answerBy: "2026-10-28T10:00:00Z", state: "awaiting-request", signed: false,
  latest: null, operationToken: "o".repeat(40),
};
const consent = { token: "t".repeat(40), version: 2, effectiveOn: "2026-09-28", summary: uploader.summary, body: uploader.body,
  statements: OTHER_ADULT_UPLOAD_STATEMENT_KEYS.map((key, index) => ({ key, text: texts[index]! })),
  warning: artifactWarning(uploader.body)! };
const render = (target: OtherAdultTarget) => renderToStaticMarkup(createElement(OtherAdultUploadCard, { target }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("the uploader's Path B screens", () => {
  it("asks for the person's name, address and date of birth first", () => {
    const html = renderToStaticMarkup(createElement(OtherAdultNewPersonForm, { token: "d".repeat(40) }));
    expect(html).toContain('data-slot="other-adult-new"');
    for (const label of [COPY.newHeading, COPY.nameLabel, COPY.emailLabel, COPY.birthLabel, COPY.detailsButton]) {
      expect(text(html)).toContain(label);
    }
    expect(html).toContain('type="date"');
    expect(html).not.toContain('type="file"');
  });
  it("asks for each statement, the typed name and the address again, with the warning above a closed control", () => {
    const html = render({ ...base, consent });
    expect(html).toContain('data-slot="other-adult-request"');
    expect(html.match(/type="checkbox"/g)).toHaveLength(7);
    for (const statement of texts) expect(text(html)).toContain(statement);
    expect(html).toContain(COPY.typedNameLabel);
    expect(html).toContain(COPY.requestEmailLabel);
    expect(html).toContain("data-legal-summary");
    expect(html.indexOf(consent.warning.slice(0, 40))).toBeLessThan(html.lastIndexOf(COPY.signAndSendButton));
    expect(html).toMatch(new RegExp(`<button[^>]*disabled[^>]*>${COPY.signAndSendButton}</button>`));
    expect(html).not.toContain('type="file"');
  });
  it("only sends the request once already signed", () => {
    const html = render({ ...base, signed: true });
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain(COPY.requestEmailLabel);
    expect(html).toContain(COPY.sendButton);
  });
  it("waits for the person's signature with one line and nothing to act on", () => {
    const html = render({ ...base, state: "awaiting-signature", signed: true, operationToken: undefined });
    expect(html).toContain('data-slot="other-adult-awaiting"');
    expect(text(html)).toContain(COPY.awaitingSignature("Synthetic Relative", "28 October 2026"));
    expect(html).not.toMatch(/<button|type="file"|type="checkbox"/);
  });
  it("offers the file only for a person who signed", () => {
    const html = render({ ...base, state: "ready", signed: true, answerBy: null, operationToken: undefined });
    expect(html).toContain('data-slot="other-adult-ready"');
    expect(html).toContain('data-slot="other-adult-file"');
    expect(html).toContain(`aria-label="${COPY.chooseLabel}"`);
    expect(html).toContain(COPY.chooseButton);
    expect(html).not.toContain('type="checkbox"');
  });
  it("shows one line and nothing to act on while a file waits for the person", () => {
    const html = render({ ...base, state: "pending", signed: true, answerBy: null,
      latest: { state: "pending", addedOn: "2026-09-28T11:00:00Z", deleteBy: "2026-10-28T11:00:00Z", confirmedOn: null } });
    expect(html).toContain('data-slot="other-adult-held"');
    expect(text(html)).toContain(COPY.pendingStatus("Synthetic Relative"));
    expect(text(html)).toContain(COPY.pendingDeadline("28 October 2026"));
    expect(html).not.toMatch(/<button|type="file"|type="checkbox"/);
  });
  it("says what the person answered about the latest file", () => {
    const latest = { addedOn: "2026-09-28T11:00:00Z", deleteBy: null, confirmedOn: "2026-09-29T11:00:00Z" };
    expect(latestFileLine("Synthetic Relative", { ...latest, state: "confirmed" }))
      .toBe(COPY.confirmedStatus("Synthetic Relative", "28 September 2026"));
    expect(latestFileLine("Synthetic Relative", { ...latest, state: "refused" }))
      .toBe(COPY.refusedStatus("Synthetic Relative", "28 September 2026"));
    expect(latestFileLine("Synthetic Relative", { ...latest, state: "expired" })).toBe(COPY.endedStatus("28 September 2026"));
    expect(latestFileLine("Synthetic Relative", { ...latest, state: "pending" })).toBeNull();
    const html = render({ ...base, state: "ready", signed: true, latest: { ...latest, state: "confirmed" } });
    expect(text(html)).toContain(COPY.confirmedStatus("Synthetic Relative", "28 September 2026"));
  });
  it("says why nothing can be done yet", () => {
    expect(text(render({ ...base, blockedBy: "account-completion" }))).toContain(COPY.accountFirstStatus);
    expect(text(render({ ...base, blockedBy: "unavailable" }))).toContain(COPY.unavailableStatus);
  });
});

describe("the person's Path B screens", () => {
  const statements = artifactStatements(person.body);
  const review = {
    nonce: "n".repeat(40), label: "Synthetic Relative",
    artifact: { version: 1, effectiveOn: "2026-09-28", summary: person.summary, body: person.body, bodySha256: "a".repeat(64),
      presentationToken: "p".repeat(40),
      statements: SUBJECT_ESIGNATURE_STATEMENT_KEYS.map((key, index) => ({ key, text: statements[index]! })) },
    countries: [{ code: "GB", name: "United Kingdom" }],
    attestation: { version: 1, sha256: "f".repeat(64), summary: "Attestation summary.", body: "Attestation body." },
  };
  it("asks the person to sign each of the four statements, with their country and name, and no account", () => {
    const html = renderToStaticMarkup(createElement(PathBRequestForm, { review }));
    expect(html).toContain('data-slot="path-b-request"');
    expect(text(html)).toContain(REQUEST.heading);
    expect(text(html)).toContain(REQUEST.detail("Synthetic Relative"));
    expect(text(html)).toContain(REQUEST.testNote);
    for (const statement of statements) expect(text(html)).toContain(statement);
    expect(html.match(/type="checkbox"/g)).toHaveLength(5);
    expect(text(html)).toContain(JURISDICTION_AFFIRM);
    expect(text(html)).toContain(JURISDICTION_SELECT_LABEL);
    expect(text(html)).toContain(REQUEST.typedNameLabel);
    expect(html).toMatch(new RegExp(`<button[^>]*disabled[^>]*>${REQUEST.signButton}</button>`));
    expect(text(html)).toContain(REQUEST.refuseButton);
    expect(text(html)).toContain(REQUEST.deleteButton);
    expect(text(html)).not.toMatch(/Sign in|account acceptance|Accept through/);
  });
  const revision = { state: "pending" as const, label: "Synthetic Relative", fileKind: "vcf" as const,
    addedOn: "2026-09-28T11:00:00Z", deleteBy: "2026-10-28T11:00:00Z", confirmedOn: null };
  it("shows one file as the uploader sees it, with three answers and no account", () => {
    const html = renderToStaticMarkup(createElement(AdultUploadRevisionForm, { review: { nonce: "n".repeat(40), revision } }));
    expect(html).toContain('data-slot="adult-upload-revision"');
    for (const line of [REVISION.heading, REVISION.added("28 September 2026", "vcf"), REVISION.seeHeading,
      REVISION.see("Synthetic Relative"), REVISION.nothingYet, REVISION.deadline("28 October 2026"),
      REVISION.confirmButton, REVISION.refuseButton, REVISION.deleteButton, REVISION.deleteDetail]) {
      expect(text(html)).toContain(line);
    }
  });
  it("after a yes, keeps only the no and the delete", () => {
    const html = renderToStaticMarkup(createElement(AdultUploadRevisionForm, { review: { nonce: "n".repeat(40),
      revision: { ...revision, state: "confirmed" as const, confirmedOn: "2026-09-29T11:00:00Z" } } }));
    expect(text(html)).toContain(REVISION.confirmedOn("29 September 2026"));
    expect(text(html)).not.toContain(REVISION.confirmButton);
    expect(text(html)).toContain(REVISION.refuseButton);
  });
  it("leaves the Path A review with its own words: no file is ever added there", () => {
    const html = renderToStaticMarkup(createElement(AdultSubjectReviewForm, { review: { nonce: "n".repeat(40),
      acceptanceBlockedBy: "sign-in", artifact: { version: 1, effectiveOn: "2026-09-01", summaryMarkdown: "Summary.",
        bodyMarkdown: "Body.", bodySha256: "a".repeat(64) } } }));
    expect(html).toContain("No genetic data has been shared");
    expect(html).not.toContain(REVISION.heading);
  });
});
