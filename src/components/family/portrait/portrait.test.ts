import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    h("a", { href, ...rest }, children as never),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));

const { PortraitBanner } = await import("./portrait-banner");
const { PairBar } = await import("./pair-bar");
const { PortraitBlocking } = await import("./portrait-blocking");
const { CarrierPairCard, OneSidedCard, crossForMatch } = await import("./portrait-card");
const { TraitCard } = await import("./trait-card");
const { RefusalsList } = await import("./refusals-list");
const { DeletePortrait } = await import("./delete-portrait");
const copy = await import("../../../copy/family/portrait");

import { EXACT_MARKER, MODELLED_MARKER } from "@/lib/figures/contract";
import type { CarrierMatch } from "@/lib/family/carrier-pair";
import type { OneSidedReading } from "@/lib/family/portrait";
import { listTraitEntries } from "@/lib/family/traits";
import type { HealthPictureColumn } from "../health-picture-table";

/**
 * The Portrait components (design §6.1, §2.5; G5.9). What is proved here:
 * the banner pair verbatim and never collapsible; the blocking screen's
 * heading, body, server-derived steps and single acknowledgement; the
 * distribution as 100 DOM spans with no image, a table fallback and a
 * legend that differs by fill, border and text; one attributed pair block
 * per output with the exactness label once, the derivation string, the
 * segregation sentence once, "How sure we are" outside any details and
 * the chance-not-prediction line; a refused match with no fraction; a
 * one-sided reading with the mandated sentence and no zero; eleven
 * refusal cards; every trait card unregistered.
 */

const VIEWER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COUNTERPART = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SELF_A = "11111111-1111-4111-8111-111111111111";
const SELF_B = "22222222-2222-4222-8222-222222222222";
const GRANT = "cccc3333-3333-4333-8333-333333333333";

const COLUMN_A: HealthPictureColumn = {
  subject: {
    id: SELF_A,
    displayLabel: "You",
    subjectClass: "self",
    routeSegment: `s-${SELF_A}`,
    subjectAccountId: VIEWER,
    ownerAccountId: VIEWER,
  },
  dataSubjectId: SELF_A,
  displayLabel: "You",
  files: null,
};

const COLUMN_B: HealthPictureColumn = {
  subject: {
    id: SELF_B,
    displayLabel: "You",
    subjectClass: "self",
    routeSegment: `s-${SELF_B}`,
    subjectAccountId: COUNTERPART,
    ownerAccountId: COUNTERPART,
  },
  dataSubjectId: SELF_B,
  displayLabel: "Bo",
  files: null,
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

function renderCard(m: CarrierMatch, conditionMode: string | null = "autosomal_recessive"): string {
  return renderToStaticMarkup(
    h(CarrierPairCard, {
      match: m,
      conditionMode,
      coverage: { known: 3, covered: 2 },
      id: "test",
      people: PEOPLE,
      viewerAccountId: VIEWER,
    }),
  );
}

const FORBIDDEN_MEDIA = /<img\b|<canvas\b|<svg\b[^>]*role="img"/;

/** The rendered words alone, without markup, for the assertions about what a reader sees. */
function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

describe("the persistent banner", () => {
  it("renders the two mandated sentences in a plain section, never a details", () => {
    const html = renderToStaticMarkup(h(PortraitBanner));
    expect(html).toContain(copy.BANNER_FIRST);
    expect(html).toContain(copy.BANNER_SECOND);
    expect(html).toContain('data-slot="portrait-banner"');
    expect(html).not.toContain("<details");
    expect(html).not.toContain("<button");
  });
});

describe("the pair bar", () => {
  it("chips both people, carries each subject id, and renders no file count, no action and no pair attribution", () => {
    const html = renderToStaticMarkup(h(PairBar, { people: PEOPLE, viewerAccountId: VIEWER }));
    expect(html).toContain(`data-subject-id="${SELF_A}"`);
    expect(html).toContain(`data-subject-id="${SELF_B}"`);
    expect(html).toMatch(/data-slot="subject-name"[^>]*>You</);
    expect(html).toMatch(/data-slot="subject-name"[^>]*>Bo</);
    expect(html).toMatch(/data-slot="subject-kind"[^>]*>Shared with you</);
    expect(html).not.toContain("data-slot=\"subject-files\"");
    expect(html).not.toContain("Add a file");
    expect(html).not.toContain("data-subject-pair");
    expect(html).not.toContain("<a ");
  });
});

describe("the blocking screen", () => {
  const people = [
    { subjectId: SELF_A, displayLabel: "You", isViewer: true },
    { subjectId: SELF_B, displayLabel: "Bo", isViewer: false },
  ] as const;

  it("names who still has a step, states the body, lists every step and offers the consents link", () => {
    const html = renderToStaticMarkup(
      h(PortraitBlocking, {
        people: [people[0], people[1]],
        missing: [
          { subjectId: SELF_B, step: "independentLogin" },
          { subjectId: SELF_B, step: "grant" },
          { subjectId: SELF_B, step: "acknowledged" },
        ],
        consentsHref: "/settings/consents",
      }),
    );
    expect(html).toContain("Portrait is waiting for Bo");
    expect(html).toContain(copy.BLOCKING_BODY);
    expect(html).toContain("Bo has not: signed in to Inherit on their own");
    expect(html).toContain("Bo has not: turned on Portrait from their own account");
    expect(html).toContain("Bo has not: read what Portrait will and will not show");
    expect(html.match(/data-slot="portrait-missing-step"/g)).toHaveLength(3);
    expect(html).toContain('href="/settings/consents"');
    expect(html).toContain(copy.OPEN_CONSENTS_BUTTON);
    // The viewer has nothing to acknowledge, so no checkbox renders.
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain("data-figure-kind");
    expect(html).not.toContain("data-claim-block");
  });

  it("renders the acknowledgement card for the viewer's own step only, in the second person, unticked", () => {
    const html = renderToStaticMarkup(
      h(PortraitBlocking, {
        people: [people[0], people[1]],
        missing: [
          { subjectId: SELF_A, step: "acknowledged" },
          { subjectId: SELF_B, step: "grant" },
        ],
        consentsHref: "/settings/consents",
      }),
    );
    expect(html).toContain("Portrait is waiting for you and Bo");
    expect(html).toContain("You have not: read what Portrait will and will not show");
    expect(html).not.toContain("You has not");
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('checked=""');
    expect(html).toContain(copy.ACKNOWLEDGE_CHECKBOX_LABEL);
    expect(html).toContain(copy.ACKNOWLEDGE_BUTTON);
    expect(html.match(/data-variant="default"/g)).toHaveLength(1);
    expect(html).toContain('href="/settings/consents"');
  });

  it("names the missing account alone, in the third person", () => {
    const html = renderToStaticMarkup(
      h(PortraitBlocking, {
        people: [people[0], { subjectId: SELF_B, displayLabel: "Invited adult", isViewer: false }],
        missing: [{ subjectId: SELF_B, step: "account" }],
        consentsHref: "/settings/consents",
      }),
    );
    expect(html).toContain("Invited adult has not: opened their own Inherit account");
    expect(html.match(/data-slot="portrait-missing-step"/g)).toHaveLength(1);
  });
});

describe("the carrier-pair card with the one fraction", () => {
  const html = renderCard(match());

  it("is one pair-attributed block with both chips and the exactness label exactly once", () => {
    expect(html.match(/data-claim-block="true"/g)).toHaveLength(1);
    expect(html.match(/data-subject-pair="[^"]+"/g)).toEqual([`data-subject-pair="${SELF_A}:${SELF_B}"`]);
    expect(html.match(/data-slot="carrier-person"/g)).toHaveLength(2);
    expect(html.match(/data-exact-marker="true"/g)).toHaveLength(1);
    expect(html).toContain(EXACT_MARKER);
    expect(html).not.toContain(MODELLED_MARKER);
    expect(html).not.toContain("data-modelled-marker");
  });

  it("renders the mandated derivation, the three exact figures at 100, and the cross from one copy each", () => {
    expect(html).toContain("1 in 4 (25%) affected · 2 in 4 (50%) carriers · 1 in 4 (25%) neither");
    const exact = html.match(/data-figure-kind="natural-frequency"[^>]*data-figure-basis="exact"/g);
    expect(exact).toHaveLength(3);
    expect(html).toContain("about 25 in 100");
    expect(html).toContain("about 50 in 100");
    expect(html.match(/data-figure-kind="carrier-status"/g)).toHaveLength(2);
    expect(crossForMatch(match()).parents).toEqual({ kind: "autosomal", a: 1, b: 1 });
  });

  it("draws 100 outcome dots as spans, a stacked bar, a legend and a table fallback, with no image", () => {
    expect(html.match(/data-slot="outcome-dot"/g)).toHaveLength(100);
    expect(html).not.toMatch(FORBIDDEN_MEDIA);
    expect(html).not.toContain('role="img"');
    expect(html.match(/data-slot="outcome-bar-segment"/g)).toHaveLength(3);
    // Three treatments that differ by fill and border, and a word for each.
    expect(html.match(/data-treatment="solid"/g)!.length).toBe(25 + 1);
    expect(html.match(/data-treatment="half"/g)!.length).toBe(50 + 1);
    expect(html.match(/data-treatment="empty"/g)!.length).toBe(25 + 1);
    expect(html).toContain("border-solid");
    expect(html).toContain("border-dashed");
    expect(html).toContain("border-dotted");
    for (const outcome of ["affected", "carrier", "neither"] as const) {
      expect(html).toContain(copy.OUTCOME_LEGEND[outcome]);
    }
    expect(html).toContain("Out of 100 possible children, about 25 would have the condition.");
    expect(html).toContain("Out of 100 possible children, about 50 would carry one copy of the change.");
    expect(html).toContain("Out of 100 possible children, about 25 would have no copy of the change.");
    expect(html).toContain("<figure");
    expect(html).toContain("<figcaption");
    expect(html).toContain(copy.DOTS_CAPTION);
    expect(html).toContain(`<summary`);
    expect(html).toContain(copy.SEE_AS_TABLE_BUTTON);
    expect(html).toMatch(/<details[^>]*data-slot="outcome-table"[^>]*>[\s\S]*<table/);
    expect(html.match(/data-slot="outcome-table-count"/g)).toHaveLength(3);
  });

  it("states the count against the registry, the segregation sentence once, the chance line and the counsellor line", () => {
    expect(html).toContain("Both files cover 2 of the 3 changes known to cause this condition.");
    expect(html.match(new RegExp(copy.SEGREGATION_SENTENCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(1);
    expect(html).toContain(copy.CHANCE_NOT_PREDICTION);
    expect(html).toContain(copy.COUNSELLOR_NO_ROUTE);
    expect(html).toContain("You: rs999999001 in E2EGENE1, which outside reviewers class as Pathogenic.");
    expect(html).toContain("Bo: rs999999001 in E2EGENE1, which outside reviewers class as Pathogenic.");
  });

  it("keeps How sure we are outside any details, with its four fields", () => {
    expect(html).toMatch(/data-slot="how-sure"/);
    const howSure = html.slice(html.indexOf('data-slot="how-sure"'));
    expect(html.slice(0, html.indexOf('data-slot="how-sure"'))).not.toMatch(/<details[^>]*>(?:(?!<\/details>)[\s\S])*$/);
    expect(howSure).toContain(copy.HOW_SURE_HEADING);
    expect(howSure).toContain(copy.PATTERN_DESCRIPTIONS.autosomal_recessive);
    expect(howSure).toContain(copy.ASSUMPTION_STATEMENTS.independent_assortment);
    // The runs measure was taken, so it is listed as checked, not assumed.
    expect(howSure).not.toContain(copy.ASSUMPTION_STATEMENTS.runs_below_threshold);
    expect(howSure).toContain(copy.HOW_SURE_LABELS.checked);
    expect(howSure).toContain(copy.RUNS_CHECKED_STATEMENT);
    expect(howSure).toContain(copy.BOTH_FILES_COVERED);
    expect(howSure).toContain(copy.CARRIER_WHAT_WOULD_CHANGE);
    expect(howSure).not.toContain(copy.ASSUMPTION_STATEMENTS.equal_x_y_transmission);
  });

  it("never renders 0%, a zero count, a heading, a picture or a sentence about one child", () => {
    expect(textOf(html)).not.toMatch(/(^|[^\d])0%/);
    expect(textOf(html)).not.toMatch(/\b0 in 100\b/);
    expect(html).not.toMatch(/<h[1-6]/);
    expect(html).not.toMatch(/your child will|your baby will|your future child is|your baby’s/i);
    expect(html).not.toMatch(/centimorgan|\bcM\b|kinship|shared DNA|related to/i);
  });
});

describe("the carrier-pair card the rule refused", () => {
  it("renders the side-by-side page's sentence with the reason, no fraction and no exactness label (D-031)", () => {
    for (const reason of ["dominant", "sex-unknown", "two-copies", "no-pattern"] as const) {
      const html = renderCard(match({ kind: "no-probability", reason }), reason === "sex-unknown" ? "x_linked" : null);
      expect(html).toContain(copy.carrierNoProbabilitySentence("E2EGENE1", reason));
      expect(html).not.toContain('data-figure-basis="exact"');
      expect(html).not.toContain("data-exact-marker");
      expect(html).not.toContain("1 in 4");
      expect(html).not.toContain("25 in 100");
      expect(html).not.toContain('data-slot="outcome-dot"');
      expect(html.match(/data-figure-kind="carrier-status"/g)).toHaveLength(2);
      expect(html).toContain(copy.CHANCE_NOT_PREDICTION);
      expect(html).toContain(copy.SEGREGATION_SENTENCE);
      expect(html).toContain('data-slot="how-sure"');
      expect(html).toContain(copy.REFUSAL_ASSUMPTION);
    }
    const xLinked = renderCard(match({ kind: "no-probability", reason: "sex-unknown" }), "x_linked");
    expect(xLinked).toContain(copy.PATTERN_DESCRIPTIONS.x_linked);
    expect(xLinked).not.toContain("Out of 100 possible pregnancies");
  });

  it("renders the brief's runs refusal verbatim only for a measured file above the threshold", () => {
    const html = renderCard(match({ kind: "no-probability", reason: "runs-above-threshold", uncovered: null }));
    expect(html).toContain(copy.RUNS_REFUSAL);
    expect(html).toContain(copy.RUNS_ASSUMPTION);
    expect(html).toContain(copy.RUNS_WHAT_WOULD_CHANGE);
    expect(html).not.toContain("25 in 100");
  });

  it("renders the could-not-check sentence, never the runs refusal, for a person whose runs were not established", () => {
    const html = renderCard(match({ kind: "no-probability", reason: "runs-unchecked", uncovered: null }));
    expect(html).not.toContain(copy.RUNS_REFUSAL);
    expect(html).toContain(copy.carrierNoProbabilitySentence("E2EGENE1", "runs-unchecked"));
    expect(html).toContain(copy.RUNS_UNCHECKED_ASSUMPTION);
    expect(html).toContain(copy.RUNS_WHAT_WOULD_CHANGE);
  });

  it("names the position one file does not cover, never imputes, and never claims both files cover it", () => {
    const html = renderCard(
      match({
        kind: "no-probability",
        reason: "not-covered",
        positionsBothCovered: false,
        uncovered: { dataSubjectId: SELF_B, rsid: 999999002 },
      }),
    );
    expect(html).toContain(copy.cannotCalculate("Bo", "rs999999002"));
    expect(html).not.toContain(copy.BOTH_FILES_COVERED);
    expect(html).toContain(copy.POSITION_NOT_COVERED_WHAT_WOULD_CHANGE);
    expect(html).not.toContain("25 in 100");
    // The viewer's own gap is in the second person.
    const mine = renderCard(
      match({
        kind: "no-probability",
        reason: "not-covered",
        positionsBothCovered: false,
        uncovered: { dataSubjectId: SELF_A, rsid: 999999002 },
      }),
    );
    expect(mine).toContain("We cannot do this calculation. Your file does not cover rs999999002.");
    expect(mine).not.toContain("You’s");
  });

  it("never claims both files cover the positions of a refused match when they do not", () => {
    const html = renderCard(match({ kind: "no-probability", reason: "dominant", positionsBothCovered: false, uncovered: null }));
    expect(html).not.toContain(copy.BOTH_FILES_COVERED);
  });
});

describe("the one-sided card", () => {
  const base: OneSidedReading = {
    kind: "no-second-copy",
    gene: "GENEA",
    conditionId: "a",
    conditionName: "A",
    carrier: {
      dataSubjectId: SELF_A,
      displayLabel: "You",
      variant: { rsid: 1001, classification: "Pathogenic", genotype: "A/G", copies: "one copy" },
    },
    other: { dataSubjectId: SELF_B, displayLabel: "Bo" },
    uncoveredRsid: null,
    coverage: { known: 2, covered: 2 },
  };

  it("renders the no-second-copy sentence, the count, both readings in words and no distribution", () => {
    const html = renderToStaticMarkup(h(OneSidedCard, { reading: base, people: PEOPLE, viewerAccountId: VIEWER }));
    expect(html).toContain(copy.noSecondCopy("Bo"));
    expect(html).toContain("Both files cover 2 of the 2 changes known to cause this condition.");
    expect(html).toContain("one copy");
    expect(html).toContain(copy.NO_COPY_FOUND_READING);
    expect(html.match(/data-figure-kind="carrier-status"/g)).toHaveLength(2);
    expect(html).not.toContain('data-figure-kind="natural-frequency"');
    expect(html).not.toContain('data-slot="outcome-dot"');
    expect(textOf(html)).not.toMatch(/(^|[^\d])0%/);
    expect(html).toContain(copy.CHANCE_NOT_PREDICTION);
    expect(html).toContain(copy.SEGREGATION_SENTENCE);
    expect(html).toContain('data-slot="how-sure"');
    expect(html).toContain(copy.oneSidedWhatWouldChange("Bo"));
    expect(html.match(/data-subject-pair="[^"]+"/g)).toEqual([`data-subject-pair="${SELF_A}:${SELF_B}"`]);
  });

  it("renders the cannot-calculate sentence with the carrier's own position when the other file covers none", () => {
    const html = renderToStaticMarkup(
      h(OneSidedCard, {
        reading: { ...base, kind: "not-covered", uncoveredRsid: 1001, coverage: { known: 2, covered: 0 } },
        people: PEOPLE,
        viewerAccountId: VIEWER,
      }),
    );
    expect(html).toContain(copy.cannotCalculate("Bo", "rs1001"));
    expect(html).toContain(copy.POSITIONS_NOT_COVERED_READING);
    expect(html).not.toContain('data-slot="known-covered"');
  });

  it("speaks to the viewer in the second person when their file is the other one: never \"You hasn’t\", never \"You’s\"", () => {
    const viewerIsOther: OneSidedReading = {
      ...base,
      carrier: { dataSubjectId: SELF_B, displayLabel: "Bo", variant: base.carrier.variant },
      other: { dataSubjectId: SELF_A, displayLabel: "You" },
    };
    const noSecond = renderToStaticMarkup(h(OneSidedCard, { reading: viewerIsOther, people: PEOPLE, viewerAccountId: VIEWER }));
    expect(noSecond).toContain(copy.noSecondCopy("you"));
    expect(noSecond).toContain(copy.oneSidedWhatWouldChange("you"));
    expect(noSecond).toContain("Bo: rs1001 in GENEA");
    const notCovered = renderToStaticMarkup(
      h(OneSidedCard, {
        reading: { ...viewerIsOther, kind: "not-covered", uncoveredRsid: 1001, coverage: { known: 2, covered: 0 } },
        people: PEOPLE,
        viewerAccountId: VIEWER,
      }),
    );
    expect(notCovered).toContain("We cannot do this calculation. Your file does not cover rs1001.");
    for (const html of [noSecond, notCovered]) {
      expect(html).not.toMatch(/You’s|You hasn’t|You has\b|in You\b|for You\b/);
    }
  });
});

describe("the trait cards and the refusals", () => {
  it("states the unregistered sentence on every trait card, with no figure and no claim block", () => {
    for (const entry of listTraitEntries()) {
      const html = renderToStaticMarkup(h(TraitCard, { entry }));
      expect(html).toContain(copy.unregisteredCard(copy.TRAIT_NAMES[entry.key]));
      expect(html).toContain(copy.TRAIT_HEADINGS[entry.key]);
      expect(html).toContain(`data-trait="${entry.key}"`);
      expect(html).toContain('data-trait-status="unregistered"');
      expect(html).not.toContain("data-figure-kind");
      expect(html).not.toContain("data-claim-block");
      expect(textOf(html)).not.toMatch(/\d/);
    }
  });

  it("server-renders at least eight refusal cards with an id and a reason each, and one live link", () => {
    const html = renderToStaticMarkup(h(RefusalsList, { limitsHref: "/science" }));
    const ids = html.match(/data-refusal-id="[^"]+"/g) ?? [];
    expect(ids.length).toBeGreaterThanOrEqual(8);
    expect(ids).toHaveLength(copy.REFUSALS.length);
    expect(html).toContain('id="not-shown"');
    expect(html).toContain(copy.REFUSALS_HEADING);
    for (const refusal of copy.REFUSALS) {
      expect(html).toContain(refusal.line);
      expect(html).toContain(refusal.reason);
    }
    expect(html).toContain('href="/science"');
    expect(html).not.toContain("<details");
    expect(html).not.toContain("data-figure-kind");
    // No value for any refused item (acceptance 15): no percentage, no
    // natural frequency, no figure node. (MC1R is a gene name, not a value.)
    expect(textOf(html)).not.toMatch(/\d+(\.\d+)?\s?%|\bin (100|1,000)\b|\b\d+ in \d+\b/);
  });
});

describe("the delete control", () => {
  it("renders one destructive action and no dialog until asked", () => {
    const html = renderToStaticMarkup(h(DeletePortrait, { grantId: GRANT }));
    expect(html).toContain(copy.DELETE_LEAD);
    expect(html).toContain(copy.DELETE_BUTTON);
    expect(html).toContain('data-variant="destructive"');
    expect(html).not.toContain('data-variant="default"');
    expect(html).not.toContain('role="alertdialog"');
    expect(html).not.toContain(copy.DELETE_CONFIRM_BUTTON);
  });
});
