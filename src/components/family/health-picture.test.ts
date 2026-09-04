import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    h("a", { href, ...rest }, children as never),
}));

const { CarrierMatchBlock } = await import("./carrier-match-block");
const { CarrierPanel } = await import("./carrier-panel");
const { HealthPictureCell } = await import("./health-picture-cell");
const { HealthPictureTable } = await import("./health-picture-table");
const { TradeOffPanel } = await import("./trade-off-panel");
const copy = await import("../../copy/family/health-picture");

import { EXACT_MARKER, MODELLED_MARKER } from "@/lib/figures/contract";
import type { CarrierMatch } from "@/lib/family/carrier-pair";
import type { HealthPictureColumn } from "./health-picture-table";

/**
 * The side-by-side surface's components (design §6.1). What is proved here:
 * one attributed claim block per cell, no control that could order the
 * table, the pair block's single pair attribution with both chips and the
 * mandated sentence as one line, and the absence of every relatedness word.
 */

const VIEWER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COUNTERPART = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SELF_A = "11111111-1111-4111-8111-111111111111";
const SELF_B = "22222222-2222-4222-8222-222222222222";
const HANDLE_B = "33333333-3333-4333-8333-333333333333";

const COLUMN_A: HealthPictureColumn = {
  subject: {
    id: SELF_A,
    displayLabel: "You",
    subjectClass: "self",
    routeSegment: "me",
    subjectAccountId: VIEWER,
    ownerAccountId: VIEWER,
  },
  dataSubjectId: SELF_A,
  displayLabel: "You",
  files: 1,
};

const COLUMN_B: HealthPictureColumn = {
  subject: {
    id: HANDLE_B,
    displayLabel: "Invited adult",
    subjectClass: "other_adult",
    routeSegment: `s-${HANDLE_B}`,
    subjectAccountId: COUNTERPART,
    ownerAccountId: null,
  },
  dataSubjectId: SELF_B,
  displayLabel: "Bo",
  files: 1,
};

const PEOPLE = [COLUMN_A, COLUMN_B] as [HealthPictureColumn, HealthPictureColumn];

function match(overrides: Partial<CarrierMatch> = {}): CarrierMatch {
  return {
    kind: "probability",
    probability: 0.25,
    gene: "E2EGENE1",
    conditionId: "e2e-recessive",
    conditionName: "A synthetic condition",
    a: {
      dataSubjectId: SELF_A,
      displayLabel: "You",
      variant: { rsid: 999_999_001, classification: "Pathogenic", genotype: "A/G", copies: "one copy" },
    },
    b: {
      dataSubjectId: SELF_B,
      displayLabel: "Bo",
      variant: { rsid: 999_999_001, classification: "Pathogenic", genotype: "A/G", copies: "one copy" },
    },
    ...overrides,
  } as CarrierMatch;
}

/** The visible text of one `data-slot`, with tags removed. */
function textOfSlot(html: string, slot: string): string {
  const opening = new RegExp(`<([a-z]+)[^>]*data-slot="${slot}"[^>]*>`);
  const start = opening.exec(html);
  if (!start) return "";
  const rest = html.slice(start.index + start[0].length);
  const tag = start[1];
  let depth = 1;
  let index = 0;
  const token = new RegExp(`</?${tag}\\b[^>]*>`, "g");
  for (let found = token.exec(rest); found; found = token.exec(rest)) {
    depth += found[0].startsWith("</") ? -1 : 1;
    if (depth === 0) {
      index = found.index;
      break;
    }
  }
  return rest
    .slice(0, index)
    .replace(/<[^>]*>/g, "")
    .replace(/&#x27;|&apos;/g, "’")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const ROW = {
  slug: "caffeine-metabolism-cyp1a2-rs762551",
  title: "Caffeine metabolism",
  category: "food-drink-metabolism" as const,
  cells: [
    { kind: "letters" as const, genotypes: ["A/C"] },
    { kind: "not-covered" as const },
  ],
  hrefs: ["/genome/me/reports/caffeine-metabolism-cyp1a2-rs762551", null],
};

describe("health picture table", () => {
  const html = renderToStaticMarkup(
    h(HealthPictureTable, {
      layer: "estimate",
      columns: PEOPLE,
      rows: [ROW],
      viewerAccountId: VIEWER,
    }),
  );

  it("is a compare surface with one attributed claim block per cell", () => {
    expect(html).toContain('data-compare-surface="true"');
    expect(html).toContain('data-card="estimate"');
    expect(html.match(/data-claim-block="true"/g)).toHaveLength(2);
    expect(html).toContain(`data-subject-id="${SELF_A}"`);
    expect(html).toContain(`data-subject-id="${SELF_B}"`);
    // Every block names exactly one subject; none names a pair.
    expect(html).not.toContain("data-subject-pair");
  });

  it("offers nothing that orders, ranks or sums the table", () => {
    expect(html).not.toContain("aria-sort");
    expect(html).not.toMatch(/<th[^>]*>\s*<button/);
    expect(html).not.toContain("<button");
    expect(html).not.toMatch(/highest|lowest|\brank\b|\btotal\b|\bscore\b/i);
  });

  it("says nothing about how the two people are related", () => {
    expect(html).not.toMatch(/centimorgan|\bcM\b|kinship|shared DNA|related to/i);
  });

  it("carries the layer caption once and the absence sentence in every column footer", () => {
    expect(html.match(/<caption/g)).toHaveLength(1);
    expect(html).toContain(copy.tableCaption("estimate"));
    expect(html.match(/data-slot="column-footer"/g)).toHaveLength(2);
    expect(
      html.match(
        new RegExp(copy.BASELINE_ABSENT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
      ),
    ).toHaveLength(2);
  });

  it("shows the letters as observed genotype figures, and the missing cell as a word", () => {
    expect(html).toContain('data-figure-kind="genotype"');
    expect(html).toContain('data-figure-basis="observed"');
    expect(html).toContain('data-provenance="computed:genome/reports"');
    expect(html).toContain("Not in Bo’s file");
    // The column without a report permission carries no link at all.
    expect(html.match(/<a /g)).toHaveLength(1);
  });
});

describe("health picture table without a layer grant", () => {
  const html = renderToStaticMarkup(
    h(HealthPictureTable, {
      layer: "estimate",
      columns: PEOPLE,
      rows: [
        {
          ...ROW,
          cells: [{ kind: "letters" as const, genotypes: ["A/C"] }, { kind: "not-shared" as const }],
          hrefs: ["/genome/me/reports/caffeine-metabolism-cyp1a2-rs762551", null],
        },
      ],
      viewerAccountId: VIEWER,
    }),
  );

  it("keeps the column and says the cell is not shared, with no figure and no link for it", () => {
    expect(html.match(/<th[^>]*data-subject-id="/g)).toHaveLength(2);
    expect(html).toContain(`data-subject-id="${SELF_B}"`);
    expect(html).toContain(copy.CELL_NOT_SHARED);
    // The viewer's own letters render; the other adult's cell carries none.
    expect(html.match(/data-figure-kind="genotype"/g)).toHaveLength(1);
    expect(html.match(/data-chip="layer"/g)).toHaveLength(1);
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).not.toContain("Not in Bo’s file");
  });
});

describe("health picture cell", () => {
  it("renders the not-shared word for another adult's layer the viewer was not granted, and nothing else", () => {
    const html = renderToStaticMarkup(
      h(HealthPictureCell, {
        dataSubjectId: SELF_B,
        personName: "Bo",
        reportTitle: "Caffeine metabolism",
        layer: "estimate",
        state: { kind: "not-shared" },
        href: null,
        captionId: "caption",
      }),
    );
    expect(html).toContain(copy.CELL_NOT_SHARED);
    expect(html).not.toContain("data-figure-kind");
    expect(html).not.toContain("data-chip");
    expect(html).not.toContain("<a ");
    expect(html).toContain(`data-subject-id="${SELF_B}"`);
  });


  it("renders no figure at all when a person has added no file", () => {
    const html = renderToStaticMarkup(
      h(HealthPictureCell, {
        dataSubjectId: SELF_B,
        personName: "Bo",
        reportTitle: "Caffeine metabolism",
        layer: "estimate",
        state: { kind: "no-file" },
        href: null,
        captionId: "caption",
      }),
    );
    expect(html).toContain(copy.CELL_NO_FILE);
    expect(html).not.toContain("data-figure-kind");
    expect(html).toContain(`data-subject-id="${SELF_B}"`);
  });

  it("names the two files that disagree instead of showing letters", () => {
    const html = renderToStaticMarkup(
      h(HealthPictureCell, {
        dataSubjectId: SELF_B,
        personName: "Bo",
        reportTitle: "Caffeine metabolism",
        layer: "estimate",
        state: { kind: "disagree" },
        href: null,
        captionId: "caption",
      }),
    );
    expect(html).toContain(copy.CELL_FILES_DISAGREE);
    expect(html).not.toContain("data-figure-kind");
  });
});

describe("carrier match block", () => {
  it("attributes one pair, carries both chips, and reads as the mandated sentence", () => {
    const html = renderToStaticMarkup(
      h(CarrierMatchBlock, { match: match(), people: PEOPLE, viewerAccountId: VIEWER }),
    );
    expect(html.match(/data-subject-pair="[^"]*"/g)).toHaveLength(1);
    expect(html).toContain(`data-subject-pair="${SELF_A}:${SELF_B}"`);
    expect(html).not.toContain("data-subject-id=");
    expect(html.match(/data-slot="carrier-person"/g)).toHaveLength(2);
    expect(html.match(/data-slot="subject-name"/g)).toHaveLength(2);

    expect(textOfSlot(html, "carrier-sentence")).toBe(
      "For each pregnancy, about 25 in 100 — a 1 in 4 chance — that a child inherits both copies. Each pregnancy is independent; this is not 1 in 4 of your children.",
    );
  });

  it("labels the fraction as exact arithmetic, never as a model", () => {
    const html = renderToStaticMarkup(
      h(CarrierMatchBlock, { match: match(), people: PEOPLE, viewerAccountId: VIEWER }),
    );
    expect(html).toContain('data-figure-basis="exact"');
    expect(html).toContain('data-provenance="computed:family/carrier-pair"');
    expect(html.match(/data-exact-marker="true"/g)).toHaveLength(1);
    expect(html).toContain(EXACT_MARKER);
    expect(html).not.toContain(MODELLED_MARKER);
    expect(html).not.toContain("data-modelled-marker");
  });

  it("renders each person's own reading as a carrier-status figure", () => {
    const html = renderToStaticMarkup(
      h(CarrierMatchBlock, { match: match(), people: PEOPLE, viewerAccountId: VIEWER }),
    );
    expect(html.match(/data-figure-kind="carrier-status"/g)).toHaveLength(2);
    expect(html).toContain("one copy");
  });

  it("names both variants and both classifications, one line per person (brief line 346)", () => {
    const html = renderToStaticMarkup(
      h(CarrierMatchBlock, {
        match: match({
          b: {
            dataSubjectId: SELF_B,
            displayLabel: "Bo",
            variant: {
              rsid: 999_999_002,
              classification: "Likely pathogenic",
              genotype: "C/T",
              copies: "one copy",
            },
          },
        }),
        people: PEOPLE,
        viewerAccountId: VIEWER,
      }),
    );
    expect(html.match(/data-slot="carrier-variant"/g)).toHaveLength(2);
    expect(html).toContain(copy.personVariantLine("You", 999_999_001, "E2EGENE1", "Pathogenic"));
    expect(html).toContain(copy.personVariantLine("Bo", 999_999_002, "E2EGENE1", "Likely pathogenic"));
  });

  it("names two changed copies in the chip and the reason, and renders no number", () => {
    const html = renderToStaticMarkup(
      h(CarrierMatchBlock, {
        match: match({
          kind: "no-probability",
          reason: "two-copies",
          a: {
            dataSubjectId: SELF_A,
            displayLabel: "You",
            variant: { rsid: 999_999_005, classification: "Pathogenic", genotype: "G/G", copies: "two copies" },
          },
        } as Partial<CarrierMatch>),
        people: PEOPLE,
        viewerAccountId: VIEWER,
      }),
    );
    expect(html).toContain("two copies");
    expect(textOfSlot(html, "carrier-sentence")).toBe(
      "Both of you have a change in E2EGENE1, but Inherit cannot turn that into a chance for a pregnancy. Reason: one file shows two changed copies, not one.",
    );
    expect(html).not.toContain("25 in 100");
    expect(html).not.toContain('data-figure-basis="exact"');
  });

  it("renders no number when there is no probability, and names the reason", () => {
    const html = renderToStaticMarkup(
      h(CarrierMatchBlock, {
        match: match({ kind: "no-probability", reason: "dominant" } as Partial<CarrierMatch>),
        people: PEOPLE,
        viewerAccountId: VIEWER,
      }),
    );
    expect(textOfSlot(html, "carrier-sentence")).toBe(
      copy.carrierNoProbabilitySentence("E2EGENE1", "dominant"),
    );
    expect(html).not.toContain("25 in 100");
    expect(html).not.toContain("1 in 4");
    expect(html).not.toContain('data-figure-basis="exact"');
    expect(html).not.toContain("data-exact-marker");
    expect(html).toContain(copy.COUNSELLOR_NO_ROUTE);
  });
});

describe("carrier panel", () => {
  it("states what it checked when a pair carries nothing in common over a classified set", () => {
    const html = renderToStaticMarkup(
      h(CarrierPanel, {
        groups: [
          { key: "one", people: PEOPLE, matches: [], classifiedPositions: 40, positionsBothCover: 7 },
        ],
        viewerAccountId: VIEWER,
      }),
    );
    expect(html).toContain(copy.noCarrierMatches(7));
    expect(html).not.toContain(copy.NO_CLASSIFIED_POSITIONS);
    expect(html).toContain(copy.CARRIER_MATCHES_HEADING);
    expect(html).toContain(`id="${copy.CARRIER_MATCHES_ID}"`);
    expect(html).not.toContain("data-claim-block");
  });

  it("says there was nothing to check when the reference table classifies nothing (D-034)", () => {
    const html = renderToStaticMarkup(
      h(CarrierPanel, {
        groups: [
          { key: "one", people: PEOPLE, matches: [], classifiedPositions: 0, positionsBothCover: 0 },
        ],
        viewerAccountId: VIEWER,
      }),
    );
    expect(html).toContain(copy.NO_CLASSIFIED_POSITIONS);
    expect(html).not.toContain("checked the");
    expect(html).not.toContain(copy.noCarrierMatches(0));
    expect(html).not.toContain("data-claim-block");
    expect(html).not.toContain('data-slot="runs-provenance"');
  });

  it("names the cited definition of a run once, with its DOI as the link, only when a block renders", () => {
    const withBlock = renderToStaticMarkup(
      h(CarrierPanel, {
        groups: [
          { key: "one", people: PEOPLE, matches: [match()], classifiedPositions: 40, positionsBothCover: 7 },
        ],
        viewerAccountId: VIEWER,
      }),
    );
    expect(withBlock.match(/data-slot="runs-provenance"/g)).toHaveLength(1);
    expect(withBlock).toContain(copy.RUNS_PROVENANCE);
    expect(withBlock).toContain(`href="${copy.RUNS_SOURCE_URL}"`);
    expect(withBlock).toContain(`>${copy.RUNS_SOURCE_DOI}</a>`);
    expect(withBlock).toMatch(/<a [^>]*target="_blank"[^>]*rel="noopener noreferrer"/);

    const without = renderToStaticMarkup(
      h(CarrierPanel, {
        groups: [
          { key: "one", people: PEOPLE, matches: [], classifiedPositions: 40, positionsBothCover: 7 },
        ],
        viewerAccountId: VIEWER,
      }),
    );
    expect(without).not.toContain('data-slot="runs-provenance"');
    expect(without).not.toContain(copy.RUNS_SOURCE_DOI);
  });

  it("lists one block per match and no count above them", () => {
    const html = renderToStaticMarkup(
      h(CarrierPanel, {
        groups: [
          {
            key: "one",
            people: PEOPLE,
            matches: [
              match(),
              match({ gene: "E2EGENE2", kind: "no-probability", reason: "harmless" } as Partial<CarrierMatch>),
            ],
            classifiedPositions: 40,
            positionsBothCover: 7,
          },
        ],
        viewerAccountId: VIEWER,
      }),
    );
    expect(html.match(/data-claim-block="true"/g)).toHaveLength(2);
    expect(html).not.toContain(copy.noCarrierMatches(7));
    expect(html.match(/25 in 100/g)).toHaveLength(1);
  });
});

describe("trade-off panel", () => {
  const html = renderToStaticMarkup(
    h(TradeOffPanel, {
      rows: [
        { dataSubjectId: SELF_A, displayLabel: "You", results: 4 },
        { dataSubjectId: SELF_B, displayLabel: "Bo", results: 4 },
      ],
    }),
  );

  it("states the mandated lines and adds no heading", () => {
    expect(html).toContain('data-trade-off-panel="true"');
    expect(html).toContain(copy.NOTHING_PICKS_BETWEEN_PEOPLE);
    expect(html).toContain(copy.NO_RANKING_STATEMENT);
    expect(html).toContain(copy.availabilityStatement(2));
    expect(html).toContain(copy.perPersonTradeOff("Bo", 4));
    expect(html).not.toMatch(/<h[1-6]/);
  });

  it("does not collapse and carries no figure", () => {
    expect(html).not.toContain("<details");
    expect(html).not.toContain("<summary");
    expect(html).not.toContain("data-figure-kind");
    expect(html.match(/data-slot="trade-off-row"/g)).toHaveLength(2);
  });
});
