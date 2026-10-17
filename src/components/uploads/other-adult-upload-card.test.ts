import fs from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import {
  ADULT_UPLOAD_DERIVED_LIST as DERIVED,
  ADULT_UPLOAD_REVISION_COPY as REVISION,
  HELD_FOR_YOU_COPY as HELD,
  OTHER_ADULT_UPLOAD_COPY as COPY,
  PATH_B_CHOICES_COPY as CHOICES,
  PATH_B_REQUEST_COPY as REQUEST,
} from "@/copy/upload/other-adult";
import { PATH_B_PURPOSES } from "@/lib/uploads/path-b-purpose";
import { JURISDICTION_AFFIRM, JURISDICTION_SELECT_LABEL } from "@/copy/settings/jurisdiction";
import { parseArtifactFile } from "@/lib/legal/artifact-file";
import {
  ADULT_NON_ACCOUNT_HOLDER_KEEP_DAYS,
  OTHER_ADULT_UPLOAD_STATEMENT_KEYS,
  SUBJECT_ESIGNATURE_STATEMENT_KEYS,
  adultUploadRevisionRetention,
  artifactStatements,
  artifactWarning,
  type OtherAdultTarget,
} from "@/lib/uploads/other-adult-upload";
import { AdultSubjectReviewForm } from "../embryo/adult-subject-review-form";
import { AdultUploadRevisionForm } from "./adult-upload-revision-form";
import { heldForYouLine, latestFileLine } from "./other-adult-lines";
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
    expect(html).toMatch(/<input[^>]*data-slot="other-adult-file"[^>]*disabled/);
    expect(html).toMatch(new RegExp(`<button[^>]*disabled[^>]*>${COPY.chooseButton}</button>`));
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
  it("tells the person, in their own account, what is waiting and what they said yes to", () => {
    expect(heldForYouLine({ state: "pending", fileKind: "vcf", addedOn: "2026-09-28T11:00:00Z",
      deleteBy: "2026-10-28T11:00:00Z", confirmedOn: null }))
      .toBe(HELD.pending("28 September 2026", "vcf", "28 October 2026"));
    expect(heldForYouLine({ state: "confirmed", fileKind: "array", addedOn: "2026-09-28T11:00:00Z",
      deleteBy: null, confirmedOn: "2026-09-29T11:00:00Z" }))
      .toBe(HELD.confirmed("28 September 2026", "array"));
    expect(HELD.pending("28 September 2026", "vcf", "28 October 2026")).toMatch(/link in our email/);
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
    account: null,
  };
  it("signed in with the invited address, asks for the statements and name, and uses the account's country", () => {
    const html = renderToStaticMarkup(createElement(PathBRequestForm, { review: { ...review, account: { country: "United Kingdom" } } }));
    expect(html).toContain('data-slot="path-b-account"');
    expect(text(html)).toContain(REQUEST.accountNote("United Kingdom"));
    for (const statement of statements) expect(text(html)).toContain(statement);
    expect(html.match(/type="checkbox"/g)).toHaveLength(4);
    expect(text(html)).not.toContain(JURISDICTION_SELECT_LABEL);
    expect(text(html)).not.toContain(JURISDICTION_AFFIRM);
    expect(html).not.toContain('name="jurisdictionCode"');
    expect(text(html)).toContain(REQUEST.typedNameLabel);
    expect(text(html)).toContain(REQUEST.refuseButton);
    expect(text(html)).toContain(REQUEST.deleteButton);
  });
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
  const revision = { state: "pending" as const, uploaderName: "Alex Synthetic", label: "Synthetic Relative", fileKind: "vcf" as const,
    addedOn: "2026-09-28T11:00:00Z", deleteBy: "2026-10-28T11:00:00Z", confirmedOn: null };
  // What adult_upload_revision_retention_v1 answers for a person with no account:
  // a yes would start the 730-day clock; once confirmed, the clock's fixed end.
  const KEEP_PENDING = { keepDays: 730 as const, keepUntil: null };
  const KEEP_CONFIRMED = { keepDays: 730 as const, keepUntil: "2028-09-28T11:00:00Z" };
  const kept = (state: "pending" | "confirmed") => state === "pending" ? KEEP_PENDING : KEEP_CONFIRMED;
  it("shows one file as the uploader sees it, with three answers and no account", () => {
    const html = renderToStaticMarkup(createElement(AdultUploadRevisionForm, { review: { nonce: "n".repeat(40), revision,
      retention: KEEP_PENDING } }));
    expect(html).toContain('data-slot="adult-upload-revision"');
    for (const line of [REVISION.heading, REVISION.added("28 September 2026", "vcf"), REVISION.seeHeading,
      REVISION.see("Synthetic Relative"), REVISION.nothingYet, REVISION.deadline("28 October 2026"),
      REVISION.confirmButton, REVISION.refuseButton, REVISION.deleteButton, REVISION.deleteDetail,
      REVISION.uploader("Alex Synthetic"), REVISION.contact]) {
      expect(text(html)).toContain(line);
    }
  });
  it("shows the anonymous uploader fallback and last-resort contact without identifiers", () => {
    const html = renderToStaticMarkup(createElement(AdultUploadRevisionForm, { review: { nonce: "n".repeat(40),
      revision: { ...revision, uploaderName: null }, retention: KEEP_PENDING } }));
    expect(text(html)).toContain(REVISION.uploader(null));
    expect(text(html)).toContain(REVISION.contact);
    expect(html).not.toContain("Alex Synthetic");
    expect(html).not.toContain("verified identity");
  });
  it("after a yes, keeps only the no and the delete", () => {
    const html = renderToStaticMarkup(createElement(AdultUploadRevisionForm, { review: { nonce: "n".repeat(40),
      revision: { ...revision, state: "confirmed" as const, confirmedOn: "2026-09-29T11:00:00Z" }, retention: KEEP_CONFIRMED } }));
    expect(text(html)).toContain(REVISION.confirmedOn("29 September 2026"));
    expect(text(html)).not.toContain(REVISION.confirmButton);
    expect(text(html)).toContain(REVISION.refuseButton);
  });
  // The register's prospectiveDerivedCategoryLabels: one closed server list,
  // the same one the upload-time email renders, and nothing beyond it.
  const DERIVED_TEXTS = [
    "A private copy of its DNA readings, put in a standard form. This can be made once you say yes.",
    "Observed genetic variants, only if you turn this on later.",
    "Trait reports and estimates, only if you turn this on later.",
  ];
  const derivedBlock = (html: string) => {
    const blocks = [...html.matchAll(/<div data-slot="adult-upload-derived">([\s\S]*?)<\/div>/g)];
    expect(blocks).toHaveLength(1);
    return blocks[0]![1]!;
  };
  it("is the exact closed list of what can be made, and names no other result", () => {
    expect(DERIVED.heading).toBe("What can be made from this file");
    expect(DERIVED.items.map(item => item.category)).toEqual(["standard-copy", "reports.monogenic", "reports.polygenic"]);
    expect(DERIVED.items.map(item => item.text)).toEqual(DERIVED_TEXTS);
    expect(DERIVED.closing).toBe("Each of these needs your own Inherit account. You turn on each kind of result by itself. "
      + "The person who added it sees a result only if you share it with them. Nothing else is made from this file.");
    // The two results carry the names the person later turns on, one at a time.
    expect(DERIVED.items[1]!.text.startsWith(`${CHOICES.layers["reports.monogenic"]},`)).toBe(true);
    expect(DERIVED.items[2]!.text.startsWith(`${CHOICES.layers["reports.polygenic"]},`)).toBe(true);
    // Ancestry can be chosen but nothing makes it from this file, so it is not listed.
    expect(PATH_B_PURPOSES.filter(purpose => !DERIVED.items.some(item => item.category === purpose))).toEqual(["ancestry"]);
    expect(JSON.stringify(DERIVED)).not.toMatch(/ancestry|portrait|health picture|embryo|carrier|copilot/i);
    // The database's Path B report store holds exactly these two outputs.
    const reports = fs.readFileSync("supabase/migrations/20260930234000_path_b_queued_reports.sql", "utf8");
    expect(reports).toContain(" purpose text not null check(purpose in('reports.monogenic','reports.polygenic')),");
  });
  it.each([
    ["pending", revision, REVISION.nothingYet],
    ["confirmed", { ...revision, state: "confirmed" as const, confirmedOn: "2026-09-29T11:00:00Z" }, REVISION.confirmedOn("29 September 2026")],
  ] as const)("renders that list on the %s review, after its own line", (_state, shown, line) => {
    const html = renderToStaticMarkup(createElement(AdultUploadRevisionForm, { review: { nonce: "n".repeat(40), revision: shown,
      retention: kept(shown.state) } }));
    const block = derivedBlock(html);
    expect(block).toContain(`<h2 class="title">${DERIVED.heading}</h2>`);
    expect([...block.matchAll(/<li data-category="([^"]+)">([^<]*)<\/li>/g)].map(match => [match[1], match[2]]))
      .toEqual(DERIVED.items.map(item => [item.category, item.text]));
    expect(block.match(/<li\b/g)).toHaveLength(DERIVED_TEXTS.length);
    expect(text(block)).toContain(DERIVED.closing);
    expect(html.indexOf(line)).toBeGreaterThan(-1);
    expect(html.indexOf(line)).toBeLessThan(html.indexOf('data-slot="adult-upload-derived"'));
  });
  it("leaves the Path A review with its own words: no file is ever added there", () => {
    const html = renderToStaticMarkup(createElement(AdultSubjectReviewForm, { review: { nonce: "n".repeat(40),
      acceptanceBlockedBy: "sign-in", artifact: { version: 1, effectiveOn: "2026-09-01", summaryMarkdown: "Summary.",
        bodyMarkdown: "Body.", bodySha256: "a".repeat(64) } } }));
    expect(html).toContain("No genetic data has been shared");
    expect(html).not.toContain(REVISION.heading);
  });

  // G5.4: retention stated in days, and a contact of last resort, on both
  // screens. adult.non-account-holder-24mo is exactly 730 days (owner
  // decision 2026-10-16); the database states it per file, and a person bound
  // to their own account has no such clock and is not told one.
  it("states 730 days before a yes, after the 30-day line, only when the database reports that clock", () => {
    const html = renderToStaticMarkup(createElement(AdultUploadRevisionForm, { review: { nonce: "n".repeat(40), revision,
      retention: KEEP_PENDING } }));
    expect(REVISION.keepIfYes(730)).toBe("If you say yes, we keep it for at most 730 days from that day. Then we delete it.");
    expect(text(html)).toContain(REVISION.keepIfYes(730));
    expect(html).toContain('data-slot="adult-upload-keep"');
    expect(html.indexOf(REVISION.deadline("28 October 2026"))).toBeLessThan(html.indexOf(REVISION.keepIfYes(730)));
    const bound = renderToStaticMarkup(createElement(AdultUploadRevisionForm, { review: { nonce: "n".repeat(40), revision,
      retention: { keepDays: null, keepUntil: null } } }));
    expect(bound).not.toContain('data-slot="adult-upload-keep"');
    expect(text(bound)).not.toContain("730 days");
    expect(text(bound)).toContain(REVISION.contact);
  });
  it("after a yes, states the 730 days and the fixed day the file is deleted", () => {
    const html = renderToStaticMarkup(createElement(AdultUploadRevisionForm, { review: { nonce: "n".repeat(40),
      revision: { ...revision, state: "confirmed" as const, confirmedOn: "2026-09-29T11:00:00Z" }, retention: KEEP_CONFIRMED } }));
    expect(REVISION.keptUntil(730, "28 September 2028"))
      .toBe("We keep it for at most 730 days from the day you said yes. It is deleted on 28 September 2028.");
    expect(text(html)).toContain(REVISION.keptUntil(730, "28 September 2028"));
    expect(text(html)).not.toContain(REVISION.keepIfYes(730));
    expect(text(html)).toContain(REVISION.contact);
    const bound = renderToStaticMarkup(createElement(AdultUploadRevisionForm, { review: { nonce: "n".repeat(40),
      revision: { ...revision, state: "confirmed" as const, confirmedOn: "2026-09-29T11:00:00Z" },
      retention: { keepDays: null, keepUntil: null } } }));
    expect(text(bound)).not.toContain("730 days");
  });
  it("on the request, states the 30 and 730 days to a person signing with no account, and the contact to everyone", () => {
    const html = renderToStaticMarkup(createElement(PathBRequestForm, { review }));
    expect(REQUEST.keep(730)).toBe("Each file they add is deleted after 30 days unless you say yes to it. "
      + "If you say yes, we keep that file for at most 730 days from that day. Then we delete it.");
    expect(text(html)).toContain(REQUEST.keep(730));
    expect(html).toContain('data-slot="path-b-request-keep"');
    expect(REQUEST.contact).toBe("If the link does not work, or you did not expect this, write to privacy@inherit.bio.");
    expect(text(html)).toContain(REQUEST.contact);
    expect(text(html).match(/privacy@inherit\.bio/g)).toHaveLength(1);
    const account = renderToStaticMarkup(createElement(PathBRequestForm, { review: { ...review, account: { country: "United Kingdom" } } }));
    expect(account).not.toContain('data-slot="path-b-request-keep"');
    expect(text(account)).not.toContain("730 days");
    expect(text(account)).toContain(REQUEST.contact);
  });
  it("uses the one number the database, the register and the code share", () => {
    expect(ADULT_NON_ACCOUNT_HOLDER_KEEP_DAYS).toBe(730);
    const migration = fs.readFileSync("supabase/migrations/20261016170000_path_b_confirmed_file_retention.sql", "utf8");
    expect(migration).toContain("create function private.adult_non_account_holder_days_v1()\n"
      + "returns integer language sql immutable set search_path='' as $$ select 730 $$;");
    expect(migration).toContain("v_deadline:=new.confirmed_at+make_interval(hours=>24*private.adult_non_account_holder_days_v1());");
    const register = fs.readFileSync("docs/retention.md", "utf8").split("\n")
      .find(line => line.startsWith("| `adult.non-account-holder-24mo` |"))!;
    expect(register).toContain("Exactly 730 days");
    expect(register).not.toMatch(/24 months/);
    expect(adultUploadRevisionRetention.safeParse({ keepDays: 731, keepUntil: null }).success).toBe(false);
    expect(adultUploadRevisionRetention.safeParse({ keepDays: null, keepUntil: "2028-09-28T11:00:00Z" }).success).toBe(false);
    expect(adultUploadRevisionRetention.safeParse(KEEP_CONFIRMED).success).toBe(true);
  });
});
