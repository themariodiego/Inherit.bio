import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FUTURE_PERSON_LINK } from "@/copy/family/index";
import { GATE_BUTTON, GATE_CHECKBOX_LABEL, GATE_SESSION_NOTE } from "@/copy/embryos/gate";
import {
  CELL_WORDS,
  NO_ROWS_SENTENCE,
  STANDING_STATEMENT,
  WITHIN_FAMILY_NOT_TESTED,
} from "@/copy/embryos/compare";
import { NO_RESULTS_SENTENCE } from "@/copy/embryos/detail";
import { EMBRYO_STATUS, RETENTION_SENTENCE } from "@/copy/embryos/index";
import {
  DROPOUT_NOT_MEASURED,
  NOT_MEASURABLE_FROM_FILE,
  NOT_STATED_BY_SOURCE,
  QC_FAILED_CHIP,
} from "@/copy/embryos/qc";
import { NO_RANKING_STATEMENT, TRADEOFFS_EXISTS, TRADEOFFS_NONE_MEASURABLE } from "@/copy/embryos/tradeoffs";
import { MODELLED_MARKER } from "@/lib/figures/contract";
import type { EmbryoCohortView } from "@/lib/embryos/cohorts";
import type { ComparisonEmbryo } from "@/lib/embryos/policy";
import { syntheticAbsoluteFinding, syntheticCarrierFinding, syntheticCoverageFailure, syntheticNullFinding, syntheticQc } from "@/lib/embryos/synthetic";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    h("a", { href, ...rest }, children as never),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const { EmbryoChip } = await import("./embryo-chip");
const { CohortCard } = await import("./cohort-card");
const { EmbryoResultGate } = await import("./result-gate");
const { EmbryoUnavailable, BlockingState, EmbryoEmptyState } = await import("./states");
const { CompareTable } = await import("./compare/compare-table");
const { CompareCell } = await import("./compare/compare-cell");
const { TradeOffPanel } = await import("./compare/trade-off-panel");
const { ContextStrip } = await import("./compare/context-strip");
const { QcTable } = await import("./compare/qc-table");
const { QcBlock } = await import("./detail/qc-block");
const { FindingsSection } = await import("./detail/findings-section");

/**
 * The embryo renderers over synthetic fixtures (design §6.1): the compare
 * table carries `data-compare-surface`, one attributed block per cell, no
 * `aria-sort`, no `<th>` button, the G4.5 string outside any `<details>`,
 * every column present for a failed embryo with its chip and reason; the
 * chip renders no colour token; the gate withholds everything.
 */

const S = (n: number) => `05000000-0000-4000-8000-00000000000${n}`;
const E = (n: number) => `0e000000-0000-4000-8000-00000000000${n}`;

/** A fixture whose QC values order differently from the ordinals. */
function embryos(): ComparisonEmbryo[] {
  return [
    { id: E(1), sample_ordinal: 0, display_label: "Embryo 1", status: "qc_pass", qc: syntheticQc({ call_rate: 0.97, sites_called: 970 }) },
    { id: E(2), sample_ordinal: 1, display_label: "Embryo 2", status: "qc_fail", qc: syntheticQc({ call_rate: 0.6, sites_called: 600, qc_verdict: "fail", qc_reasons: ["embryo_call_rate", "unknown_reason"], parent_a_concordance: 0.8 }) },
    { id: E(3), sample_ordinal: 2, display_label: "Embryo 3", status: "qc_pass", qc: syntheticQc({ call_rate: 0.99, sites_called: 990 }) },
  ];
}

const subjectIds = new Map([[E(1), S(1)], [E(2), S(2)], [E(3), S(3)]]);

const NO_COLOUR = /bg-subject-|--dir-|--state-|--evidence-|text-danger|text-ok|bg-ok|bg-danger/;
const NO_SEX = /\b(sex|male|female|XX|XY|chrX|chrY|chrM|karyotype|rank|ranked|best embryo)\b/i;

describe("EmbryoChip", () => {
  it("renders the disc, the ordinal label, the kind chip and no colour token", () => {
    const html = renderToStaticMarkup(h(EmbryoChip, { embryo: { id: E(3), displayLabel: "Embryo 3" }, href: "/embryos/x" }));
    expect(html).toMatch(/data-slot="embryo-disc"[^>]*>E</);
    expect(html).toMatch(/<a href="\/embryos\/x"[^>]*data-slot="embryo-label"[^>]*>Embryo 3</);
    expect(html).toMatch(/data-slot="subject-kind"[^>]*>Embryo</);
    expect(html).not.toContain("qc-chip");
    expect(html).not.toMatch(NO_COLOUR);
    const failed = renderToStaticMarkup(h(EmbryoChip, { embryo: { id: E(2), displayLabel: "Embryo 2" }, qcFailed: true }));
    expect(failed).toMatch(new RegExp(`data-slot="qc-chip"[^>]*>${QC_FAILED_CHIP}<`));
    expect(failed).not.toContain("<a ");
  });
});

describe("CompareTable", () => {
  const html = renderToStaticMarkup(h(CompareTable, { layer: "estimate", embryos: embryos(), rows: [], subjectIds }));

  it("is the compare surface with every column in ordinal order and no sort control", () => {
    expect(html).toContain('data-compare-surface="true"');
    expect(html).toContain('data-card="true"');
    const ordinals = [...html.matchAll(/data-sample-ordinal="(\d+)"/g)].map((match) => Number(match[1]));
    expect(ordinals).toEqual([0, 1, 2]);
    const labels = [...html.matchAll(/data-slot="embryo-label"[^>]*>(Embryo \d)</g)].map((match) => match[1]);
    expect(labels).toEqual(["Embryo 1", "Embryo 2", "Embryo 3"]);
    expect(html).not.toContain("aria-sort");
    expect(html).not.toMatch(/<th[^>]*>\s*<button/);
    expect(html).not.toContain("<button");
    expect(html).toContain("<caption");
  });

  it("keeps the failed column with its chip, reason and measured numbers as figures", () => {
    expect(html.match(new RegExp(QC_FAILED_CHIP, "g"))).toHaveLength(1);
    const footers = [...html.matchAll(/data-slot="column-footer" data-embryo-id="([^"]+)"/g)].map((match) => match[1]);
    expect(footers).toEqual([E(1), E(2), E(3)]);
    const failedFooter = html.slice(html.indexOf(`data-slot="column-footer" data-embryo-id="${E(2)}"`), html.indexOf(`data-slot="column-footer" data-embryo-id="${E(3)}"`));
    expect(failedFooter).toContain('data-reason="embryo_call_rate"');
    expect(failedFooter).toContain('data-reason="qc_review_required"');
    expect(failedFooter).toContain("Embryo 2: we could read only");
    expect(failedFooter).toMatch(/data-figure-kind="natural-frequency"[^>]*>.*about 60 in 100/);
    expect(failedFooter).toMatch(/data-figure-kind="coverage"[^>]*>.*read 600 of the 1,000 positions this needs/);
    expect(failedFooter).toContain(NOT_MEASURABLE_FROM_FILE);
    expect(failedFooter).toContain(`data-subject-id="${S(2)}"`);
    expect(html.match(/data-claim-block="true"/g)).toHaveLength(3);
  });

  it("renders the honest sentence in place of the rows and no risk figure", () => {
    expect(html).toContain(NO_ROWS_SENTENCE);
    expect(html).not.toMatch(/data-figure-kind="(absolute|relative|percentile)"/);
    expect(html).not.toMatch(NO_COLOUR);
    expect(html).not.toMatch(NO_SEX);
  });

  it("renders one attributed block per cell when rows exist", () => {
    const rows = [
      { findings: [syntheticAbsoluteFinding("Embryo 1", "c-a", 0.02), syntheticNullFinding("Embryo 2", "c-a", "embryo_call_rate"), syntheticAbsoluteFinding("Embryo 3", "c-a", 0.01)] },
    ];
    const withRows = renderToStaticMarkup(h(CompareTable, { layer: "estimate", embryos: embryos(), rows, subjectIds }));
    const tbody = withRows.slice(withRows.indexOf("<tbody"), withRows.indexOf("</tbody>"));
    expect(tbody.match(/data-claim-block="true"/g)).toHaveLength(3);
    expect(tbody).toContain(`data-subject-id="${S(1)}"`);
    expect(tbody).toContain(`data-subject-id="${S(2)}"`);
    expect(tbody).toContain(CELL_WORDS.notMeasurable);
    expect(tbody.match(/data-figure-kind="absolute"/g)).toHaveLength(2);
    expect(withRows).not.toContain("aria-sort");
  });
});

describe("CompareCell", () => {
  it("renders an absolute-risk finding as one block with the modelled marker once and the untested sentence", () => {
    const html = renderToStaticMarkup(h(CompareCell, { finding: syntheticAbsoluteFinding("Embryo 1", "c-a", 0.02), subjectId: S(1) }));
    expect(html.match(/data-claim-block="true"/g)).toHaveLength(1);
    expect(html.match(new RegExp(MODELLED_MARKER, "g"))).toHaveLength(1);
    expect(html).toContain('data-figure-kind="absolute"');
    expect(html).toContain('data-figure-kind="interval"');
    expect(html).toContain('data-figure-kind="natural-frequency"');
    expect(html).toContain(WITHIN_FAMILY_NOT_TESTED);
    expect(html).not.toMatch(NO_COLOUR);
  });

  it("renders a carrier finding as a carrier-status figure in words", () => {
    const html = renderToStaticMarkup(h(CompareCell, { finding: syntheticCarrierFinding("Embryo 1", "c-x", "carrier"), subjectId: S(1) }));
    expect(html).toMatch(/data-figure-kind="carrier-status"[^>]*data-figure-class="variant-call"[^>]*data-figure-basis="observed"/);
    expect(html).toContain("one copy found");
    expect(html).not.toContain(MODELLED_MARKER);
  });

  it("renders the closed words for every no-number state, and a tie without an ordinal", () => {
    const reasons: [string, string][] = [
      ["embryo_call_rate", CELL_WORDS.notMeasurable],
      ["contamination", CELL_WORDS.notMeasurable],
      ["sex_combined_model_unavailable", CELL_WORDS.noPopulationFigure],
      ["within_family_validation_unavailable", CELL_WORDS.notTestedBetweenSiblings],
      ["source_call_disputed", CELL_WORDS.underReview],
      ["qc_review_required", CELL_WORDS.underReview],
    ];
    for (const [reason, word] of reasons) {
      const html = renderToStaticMarkup(h(CompareCell, { finding: syntheticNullFinding("Embryo 1", "c-a", reason), subjectId: S(1) }));
      expect(html, reason).toContain(`>${word}<`);
      expect(html, reason).not.toContain("data-figure-kind");
      expect(html, reason).toContain(`data-subject-id="${S(1)}"`);
    }
    const failure = renderToStaticMarkup(h(CompareCell, { finding: syntheticCoverageFailure("Embryo 1", "c-a"), subjectId: S(1) }));
    expect(failure).toContain(`>${CELL_WORDS.notRead}<`);
    const tied = renderToStaticMarkup(h(CompareCell, { finding: syntheticAbsoluteFinding("Embryo 1", "c-a", 0.02), subjectId: S(1), tied: true }));
    expect(tied).toContain(CELL_WORDS.tooCloseToTellApart);
    expect(tied).not.toContain("data-figure-kind");
    expect(tied).not.toMatch(/\b(1st|2nd|3rd|first|second)\b/i);
  });
});

describe("TradeOffPanel", () => {
  it("renders the G4.5 string, the none-measurable statement and no count, outside any details", () => {
    const html = renderToStaticMarkup(
      h(TradeOffPanel, { tradeOffs: { statement_copy_id: "embryo.tradeoffs.none-measurable", conflicts: [] }, conditionNames: new Map(), embryoCount: 3 }),
    );
    expect(html).toContain('data-trade-off-panel="true"');
    expect(html).toContain(NO_RANKING_STATEMENT);
    expect(html).toContain(TRADEOFFS_NONE_MEASURABLE);
    expect(html).toContain("This page shows 3 embryos because the laboratory sent 3 files.");
    expect(html).not.toContain("<details");
    expect(html).not.toMatch(/\d+ of \d+/);
  });

  it("names each real conflict with its condition names", () => {
    const html = renderToStaticMarkup(
      h(TradeOffPanel, {
        tradeOffs: { statement_copy_id: "embryo.tradeoffs.exists", conflicts: [{ embryo_label: "Embryo 2", lowest_condition_id: "c-a", highest_condition_id: "c-b", copy_id: "embryo.tradeoffs.conflict" }] },
        conditionNames: new Map([["c-a", "heart"], ["c-b", "cancer"]]),
        embryoCount: 1,
      }),
    );
    expect(html).toContain(TRADEOFFS_EXISTS);
    expect(html).toContain("Embryo 2 has the lowest heart risk and the highest cancer risk.");
    expect(html).toContain("This page shows 1 embryo because the laboratory sent 1 file.");
  });
});

describe("ContextStrip", () => {
  it("renders exactly three counts with their notes", () => {
    const html = renderToStaticMarkup(h(ContextStrip, { counts: { embryos_analysed: 8, quality_check_passed: 6, not_measurable: 2 } }));
    expect(html.match(/data-metric-value="true"/g)).toHaveLength(3);
    expect(html).toContain("8 embryos analysed");
    expect(html).toContain("6 passed the quality check");
    expect(html).toContain("2 not measurable");
    expect(html).not.toContain("data-figure-kind");
  });
});

describe("QcTable and QcBlock", () => {
  it("prints the null words for unknown source fields and unmeasured metrics, and figures for measured ones", () => {
    const html = renderToStaticMarkup(h(QcTable, { embryos: embryos(), subjectIds }));
    expect(html.match(new RegExp(NOT_STATED_BY_SOURCE, "g"))!.length).toBeGreaterThanOrEqual(12);
    expect(html).toContain(NOT_MEASURABLE_FROM_FILE);
    expect(html).toContain(DROPOUT_NOT_MEASURED);
    expect(html).toMatch(/data-figure-kind="coverage"/);
    expect(html).toContain(QC_FAILED_CHIP);
    expect(html).not.toContain("—</");
    expect(html).not.toMatch(/>\s*-\s*</);
    expect(html).not.toContain("aria-sort");
    expect(html).not.toMatch(NO_COLOUR);
  });

  it("renders one attributed block on the detail page with the coverage figure and the dropout sentence", () => {
    const html = renderToStaticMarkup(h(QcBlock, { qc: syntheticQc({ contamination_estimate: 0.01 }), embryoId: E(1), subjectId: S(1) }));
    expect(html.match(/data-claim-block="true"/g)).toHaveLength(1);
    expect(html).toContain(`data-subject-id="${S(1)}"`);
    expect(html).toContain('data-density-primary-claim="true"');
    expect(html).toMatch(/data-figure-kind="coverage"[^>]*data-figure-class="quality"[^>]*data-figure-basis="observed"/);
    expect(html).toContain(DROPOUT_NOT_MEASURED);
    expect(html).toContain(NOT_STATED_BY_SOURCE);
    expect(html).not.toContain(MODELLED_MARKER);
  });
});

describe("FindingsSection", () => {
  it("renders exactly one sentence while the registry is empty", () => {
    const html = renderToStaticMarkup(h(FindingsSection, { findings: [], subjectId: S(1) }));
    expect(html.match(new RegExp(NO_RESULTS_SENTENCE, "g"))).toHaveLength(1);
    expect(html).not.toContain("data-figure-kind");
  });

  it("renders only registered conditions under their allowed category, as labels not headings", () => {
    const registry = [{ condition_id: "c-a", condition_name: "Synthetic condition c-a", category: "Cancer", permitted_result_kinds: ["absolute_risk"], risk_model_id: "m", enabled_by_default: true }];
    const html = renderToStaticMarkup(
      h(FindingsSection, { findings: [syntheticAbsoluteFinding("Embryo 1", "c-a", 0.02), syntheticAbsoluteFinding("Embryo 1", "c-z", 0.5)], subjectId: S(1), registry }),
    );
    expect(html).toContain('data-category="Cancer"');
    expect(html).not.toContain("c-z");
    expect(html).not.toMatch(/<h[1-6]/);
    expect(html.match(/data-claim-block="true"/g)).toHaveLength(1);
  });
});

describe("CohortCard", () => {
  const cohort: EmbryoCohortView = {
    id: "0c000000-0000-4000-8000-000000000001",
    status: "active",
    createdAt: "2026-09-03T10:00:00.000Z",
    embryoCount: 2,
    viewerRole: "required_upload_principal",
    requiredUploadPrincipalAccountIds: [],
    requiredUploadPrincipalsWithoutAccount: 0,
    analysisGranted: false,
    viewerAnalysisGranted: false,
    embryos: [
      { id: E(1), subjectId: S(1), sampleOrdinal: 0, displayLabel: "Embryo 1", status: "qc_marginal" },
      { id: E(2), subjectId: S(2), sampleOrdinal: 1, displayLabel: "Embryo 2", status: "qc_fail" },
    ],
    retentionExpiresAt: "2028-09-03T10:00:00.000Z",
  };

  it("renders the date label, one status word per embryo, the analysis line, the compare link and the retention line", () => {
    const html = renderToStaticMarkup(h(CohortCard, { cohort, jurisdictionCopy: null }));
    expect(html).toContain("Embryos added on 3 September 2026");
    expect(html).toContain(EMBRYO_STATUS.qc_marginal);
    expect(html).toContain(EMBRYO_STATUS.qc_fail);
    expect(html).toContain("Waiting for you to turn on the results");
    expect(html).toContain('href="/embryos/compare?cohort=0c000000-0000-4000-8000-000000000001"');
    expect(html).toContain(`href="/embryos/${E(1)}"`);
    expect(html).toContain(RETENTION_SENTENCE);
    expect(html).not.toMatch(NO_COLOUR);
    expect(html).not.toMatch(NO_SEX);
    expect(html).not.toContain("data-figure-kind");
  });

  it("carries the register's copy when the cohort's contributors refuse the capability", () => {
    const html = renderToStaticMarkup(h(CohortCard, { cohort, jurisdictionCopy: "Not here." }));
    expect(html).toMatch(/data-slot="cohort-jurisdiction"[^>]*>Not here\.</);
  });
});

describe("states and the gate", () => {
  it("renders the register's copy and the future-person link, never a sentence of its own", () => {
    const html = renderToStaticMarkup(
      h(EmbryoUnavailable, { decision: { capability: "embryo_analysis", status: "unreviewed", userFacingCopy: "The register's own copy.", jurisdictionCode: null, source: "unset" } }),
    );
    expect(html).toContain("The register&#x27;s own copy.");
    expect(html).toContain(FUTURE_PERSON_LINK);
    expect(html).toContain('href="/legal/future-person"');
    expect(html).not.toContain("Not available in this jurisdiction yet");
  });

  it("renders a blocking state with one sentence and at most one action, and the four-part empty state", () => {
    const blocking = renderToStaticMarkup(h(BlockingState, { state: "consent-required", children: "Waiting." }));
    expect(blocking).toContain('data-state="consent-required"');
    expect(blocking).not.toContain("<a ");
    const empty = renderToStaticMarkup(
      h(EmbryoEmptyState, { heading: "No embryo files added yet.", whatAppears: "What.", howToMakeItAppear: "How.", action: { label: "Go", href: "/embryos/request-data" } }),
    );
    expect(empty).toMatch(/<h2[^>]*data-slot="empty-state-heading"[^>]*>No embryo files added yet\.</);
    expect(empty.match(/<p /g)).toHaveLength(2);
    const action = empty.match(/<a [^>]*href="\/embryos\/request-data"[^>]*>/)?.[0] ?? "";
    expect(action).toContain('data-variant="default"');
  });

  it("renders the gate with the exact checkbox, the session sentence, one primary action and no result", () => {
    const html = renderToStaticMarkup(h(EmbryoResultGate, { action: async () => ({ ok: true }) }));
    expect(html).toContain(GATE_CHECKBOX_LABEL);
    expect(html).toContain(GATE_SESSION_NOTE);
    expect(html).toContain(`>${GATE_BUTTON}<`);
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain("data-figure-kind");
    expect(html).not.toContain("data-claim-block");
    expect(html).not.toContain(STANDING_STATEMENT);
  });
});
