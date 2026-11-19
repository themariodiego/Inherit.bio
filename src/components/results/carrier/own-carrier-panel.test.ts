import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OwnCarrierPanel } from "./own-carrier-panel";
import type { OwnCarrierView } from "@/lib/family/own-carrier-read";
import type { OwnCarrierCondition } from "@/lib/family/own-carrier-status";
import {
  CARRIER_LIMITS,
  CARRIER_LIMITS_HEADING,
  NO_CLASSIFIED_POSITIONS,
} from "@/copy/family/health-picture";
import { LAB_CONFIRMATION_LINE, PENETRANCE_NOT_ESTABLISHED } from "@/copy/family/carrier-evidence";
import {
  CARRIER_STATUS_OFF_STATUS,
  CARRIER_STATUS_PREPARING_STATUS,
  OWN_CARRIER_LIMITS,
} from "@/copy/genome/carrier";
import { NO_FILE_YET } from "@/copy/reports/strings";

/**
 * Every state `/genome/[subject]/carrier` renders, from plain data. The
 * brief's monogenic presentation law (§4, lines 1329-1335) is asserted on a
 * finding and on a condition the file does not cover: the penetrance label on
 * both; the not-a-negative-result count where no reviewed change shows; and on
 * the finding the review status and date as text and the laboratory line.
 */
const SUBJECT = "88110000-0000-4000-8000-000000000001";
const REPORTS = "/genome/me/reports";
const evidence = { variantName: "Synthetic change one", reviewStatus: "reviewed by expert panel", reviewStars: 3,
  lastEvaluated: "2024-01-01", penetranceClass: "unestablished" as const, releaseId: "synthetic-unit-panel",
  geneValidityReadOn: "2026-09-28", variationId: 881101 };
const finding: OwnCarrierCondition = { conditionId: "SYNTHETIC:8811", conditionName: "Synthetic recessive condition one",
  gene: "SYNOWNA", inheritanceMode: "autosomal_recessive", penetranceClass: "unestablished", releaseId: "synthetic-unit-panel",
  geneValidityReadOn: "2026-09-28", requiredPositions: 2, checkedPositions: 2,
  finding: { assertionId: 11, classification: "Pathogenic", genotype: "A/G", copies: "one copy", evidence } };
const uncovered: OwnCarrierCondition = { ...finding, conditionId: "SYNTHETIC:8812", conditionName: "Synthetic recessive condition two",
  gene: "SYNOWNB", requiredPositions: 1, checkedPositions: 0, finding: null };
const clinvar: OwnCarrierCondition = { ...uncovered, conditionId: "MONDO:0009061", conditionName: "Cystic fibrosis", gene: "CFTR",
  releaseId: "clinvar-2026-09", requiredPositions: 3, checkedPositions: 3 };

const render = (view: OwnCarrierView) =>
  renderToStaticMarkup(createElement(OwnCarrierPanel, { view, subjectId: SUBJECT, reportsHref: REPORTS }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

describe("OwnCarrierPanel states", () => {
  it.each([
    ["unavailable", { kind: "unavailable", fileCount: 1 }, NO_CLASSIFIED_POSITIONS],
    ["empty", { kind: "no-file", fileCount: 0 }, NO_FILE_YET],
    ["processing", { kind: "preparing", fileCount: 1 }, CARRIER_STATUS_PREPARING_STATUS],
    ["consent-required", { kind: "off", fileCount: 1 }, CARRIER_STATUS_OFF_STATUS],
  ] as const)("%s renders one sentence and no result", (state, view, sentence) => {
    const html = render(view as OwnCarrierView);
    expect(html).toContain(`data-state="${state}"`);
    expect(text(html)).toContain(sentence);
    expect(html).not.toContain("data-figure-kind");
    expect(html).not.toContain("data-claim-block");
    // The unavailable sentence is not a result, so it never carries the limits.
    expect(html).not.toContain(CARRIER_LIMITS_HEADING);
    expect(html.includes(`href="${REPORTS}"`)).toBe(state === "consent-required");
  });

  it("production's sentence is the approved one, word for word", () => {
    expect(NO_CLASSIFIED_POSITIONS).toBe(
      "This check is unavailable. Inherit cannot yet verify the evidence for each gene change. This is not a negative carrier screen.");
  });
});

describe("OwnCarrierPanel results", () => {
  it("a finding: the reading, the count, the reviewed variant line and every evidence note, in one attributed claim block", () => {
    const html = render({ kind: "result", fileCount: 1, preparing: false, conditions: [finding] });
    expect(html).toContain('data-state="complete"');
    expect(html.match(/data-claim-block="true"/g)).toHaveLength(1);
    expect(html).toContain(`data-subject-id="${SUBJECT}"`);
    expect(html).toMatch(/data-figure-kind="carrier-status" data-figure-class="variant-call" data-figure-basis="observed" data-provenance="computed:family\/own-carrier-status"/);
    expect(html).toMatch(/data-figure-kind="coverage" data-figure-class="quality" data-figure-basis="observed" data-provenance="computed:family\/own-carrier-status"/);
    const words = text(html);
    expect(words).toContain("You: one copy");
    expect(words).toContain("Your file was checked at 2 of the 2 positions known for Synthetic recessive condition one.");
    expect(words).not.toContain("This is not a negative result.");
    expect(words).toContain("You: Synthetic change one in SYNOWNA. The test release classifies it as pathogenic "
      + "(review status: reviewed by expert panel; last evaluated 1 January 2024).");
    expect(words).toContain(LAB_CONFIRMATION_LINE);
    expect(words).toContain(PENETRANCE_NOT_ESTABLISHED);
    expect(words).toContain("Classifications from a test release, not from ClinVar.");
    expect(words).not.toContain("ClinVar classifies");
    expect(html).toContain(`data-carrier-reading="one copy"`);
  });

  it("a condition the file does not cover: not a negative result, the count, why, the penetrance label, and no laboratory line", () => {
    const html = render({ kind: "result", fileCount: 1, preparing: false, conditions: [finding, uncovered] });
    expect(html).toContain('data-state="partial-coverage"');
    const block = html.slice(html.indexOf('data-condition-id="SYNTHETIC:8812"'));
    const words = text(block);
    expect(words).toContain("This is not a negative result. Your file was checked at 0 of the 1 positions known for Synthetic recessive condition two.");
    expect(words).toContain("Some reviewed positions were not read in this file.");
    expect(words).toContain(PENETRANCE_NOT_ESTABLISHED);
    expect(words).not.toContain(LAB_CONFIRMATION_LINE);
    expect(block).not.toContain('data-figure-kind="carrier-status"');
    expect(block).toContain('data-coverage="not-covered"');
  });

  it("names a ClinVar release as ClinVar, and states the limits once that are true of one person's own check", () => {
    const html = render({ kind: "result", fileCount: 1, preparing: true, conditions: [clinvar] });
    const words = text(html);
    expect(words).toContain("Classifications from ClinVar (NCBI), release 2026-09. Gene links from ClinGen, read 28 September 2026.");
    expect(words).toContain(CARRIER_STATUS_PREPARING_STATUS);
    expect(html.match(new RegExp(CARRIER_LIMITS_HEADING, "g"))).toHaveLength(1);
    for (const limit of OWN_CARRIER_LIMITS) expect(words).toContain(limit);
    expect(OWN_CARRIER_LIMITS).toEqual([CARRIER_LIMITS[0], CARRIER_LIMITS[2], CARRIER_LIMITS[3], CARRIER_LIMITS[4]]);
    expect(words).not.toContain(CARRIER_LIMITS[1]);
  });

  it("speaks of no chance, pregnancy result or child, and ranks nothing", () => {
    const words = text(render({ kind: "result", fileCount: 1, preparing: false, conditions: [finding, uncovered, clinvar] }));
    expect(words).not.toMatch(/\b1 in 4\b|in 100\b|%|per pregnancy|For each pregnancy|your child|risk\b/i);
    expect(words).not.toMatch(/\bnormal\b|\bclear\b|negative screen\b/i);
  });
});
