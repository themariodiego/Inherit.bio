import { describe, expect, it } from "vitest";
import { PORTRAIT_STEPS, cannotCalculate, noSecondCopy } from "@/copy/family/portrait";
import type { CarrierCondition, CarrierMatch, CarrierRefVariant } from "./carrier-pair";
import {
  PORTRAIT_STEP_ORDER,
  evaluateOneSided,
  evaluatePortraitPreconditions,
  geneCoverage,
  ownPortraitGrantId,
  pairSides,
  type PortraitPairRows,
  type PortraitSubjectRow,
} from "./portrait";

/**
 * The Portrait rule (design §2.5; brief X3.6, line 352, line 2238): the
 * register's preconditions decided over plain rows, and the one-sided
 * readings decided over the same rows the carrier rule read. Every branch
 * of the blocking screen is proved here without a database.
 */

const ACCOUNT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCOUNT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACCOUNT_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SELF_A = "11111111-1111-4111-8111-111111111111";
const SELF_B = "22222222-2222-4222-8222-222222222222";
const PAIR = "99999999-9999-4999-8999-999999999999";
const GRANT_A = "aaaa1111-1111-4111-8111-111111111111";
const GRANT_B = "bbbb2222-2222-4222-8222-222222222222";

function subject(overrides: Partial<PortraitSubjectRow> & { id: string }): PortraitSubjectRow {
  return {
    displayLabel: "You",
    subjectClass: "self",
    lifecycle: "active",
    subjectAccountId: null,
    portraitAcknowledgedAt: "2026-09-03T00:00:00Z",
    independentLoginAt: "2026-09-03T00:00:00Z",
    ...overrides,
  };
}

/** Every step done for both people, viewed by A. */
function complete(overrides: Partial<PortraitPairRows> = {}): PortraitPairRows {
  return {
    viewerAccountId: ACCOUNT_A,
    pair: { id: PAIR, subjectAId: SELF_A, subjectBId: SELF_B, status: "current", pairRevision: 1 },
    a: subject({ id: SELF_A, subjectAccountId: ACCOUNT_A }),
    b: subject({ id: SELF_B, subjectAccountId: ACCOUNT_B }),
    grants: [
      { grantId: GRANT_A, granterAccountId: ACCOUNT_A, recipientAccountId: ACCOUNT_B },
      { grantId: GRANT_B, granterAccountId: ACCOUNT_B, recipientAccountId: ACCOUNT_A },
    ],
    paused: false,
    ...overrides,
  };
}

describe("the Portrait preconditions", () => {
  it("passes only when both people have every step done", () => {
    expect(evaluatePortraitPreconditions(complete())).toEqual({ kind: "ok" });
    // Seen from B's account the answer is the same.
    expect(evaluatePortraitPreconditions(complete({ viewerAccountId: ACCOUNT_B }))).toEqual({ kind: "ok" });
  });

  it("names the four steps in the order a person completes them, and the copy names each one", () => {
    expect(PORTRAIT_STEP_ORDER).toEqual(["account", "independentLogin", "grant", "acknowledged"]);
    for (const step of PORTRAIT_STEP_ORDER) expect(PORTRAIT_STEPS[step]).toBeTruthy();
  });

  it("answers a viewer who holds neither account, an ended pair and a purged pair alike: not authorised", () => {
    expect(evaluatePortraitPreconditions(complete({ viewerAccountId: ACCOUNT_C }))).toEqual({
      kind: "not-authorised",
    });
    for (const status of ["revoked", "purged"]) {
      expect(
        evaluatePortraitPreconditions(complete({ pair: { ...complete().pair, status } })),
      ).toEqual({ kind: "not-authorised" });
    }
    // A minor's record, or a purged record, is never a Portrait subject.
    expect(
      evaluatePortraitPreconditions(complete({ b: subject({ id: SELF_B, subjectAccountId: ACCOUNT_B, subjectClass: "minor" }) })),
    ).toEqual({ kind: "not-authorised" });
    expect(
      evaluatePortraitPreconditions(complete({ b: subject({ id: SELF_B, subjectAccountId: ACCOUNT_B, lifecycle: "purged" }) })),
    ).toEqual({ kind: "not-authorised" });
  });

  it("is blocked by a pause before any step is named", () => {
    const rows = complete({
      paused: true,
      b: subject({ id: SELF_B, subjectAccountId: ACCOUNT_B, portraitAcknowledgedAt: null }),
    });
    expect(evaluatePortraitPreconditions(rows)).toEqual({ kind: "paused" });
  });

  it("names the missing account alone for a person who has none, and the grant the viewer cannot yet make (X3.6)", () => {
    // No grant can exist toward a person with no account, so the viewer's
    // own grant step is open too; the other person's only step is the account.
    const rows = complete({
      b: subject({ id: SELF_B, subjectAccountId: null, portraitAcknowledgedAt: null, independentLoginAt: null }),
      grants: [],
    });
    expect(evaluatePortraitPreconditions(rows)).toEqual({
      kind: "missing",
      missing: [
        { subjectId: SELF_A, step: "grant" },
        { subjectId: SELF_B, step: "account" },
      ],
    });
  });

  it("names a missing own-session grant, acknowledgement and independent login, per person, in pair order", () => {
    const rows = complete({
      a: subject({ id: SELF_A, subjectAccountId: ACCOUNT_A, portraitAcknowledgedAt: null }),
      b: subject({ id: SELF_B, subjectAccountId: ACCOUNT_B, independentLoginAt: null }),
      // Only A's grant is live.
      grants: [{ grantId: GRANT_A, granterAccountId: ACCOUNT_A, recipientAccountId: ACCOUNT_B }],
    });
    expect(evaluatePortraitPreconditions(rows)).toEqual({
      kind: "missing",
      missing: [
        { subjectId: SELF_A, step: "acknowledged" },
        { subjectId: SELF_B, step: "independentLogin" },
        { subjectId: SELF_B, step: "grant" },
      ],
    });
  });

  it("counts a grant only when the person's own account signed it toward the other (X3.6: never the uploader for both)", () => {
    const rows = complete({
      grants: [
        { grantId: GRANT_A, granterAccountId: ACCOUNT_A, recipientAccountId: ACCOUNT_B },
        // A grant "about B" that A's account signed does not stand for B's step.
        { grantId: GRANT_B, granterAccountId: ACCOUNT_A, recipientAccountId: ACCOUNT_A },
      ],
    });
    expect(evaluatePortraitPreconditions(rows)).toEqual({
      kind: "missing",
      missing: [{ subjectId: SELF_B, step: "grant" }],
    });
    // A pair marked current does not stand for a grant either: the rows decide.
    expect(evaluatePortraitPreconditions({ ...rows, pair: { ...rows.pair, status: "current" } })).toEqual({
      kind: "missing",
      missing: [{ subjectId: SELF_B, step: "grant" }],
    });
  });

  it("tells the viewer's own side from the other, and finds only the viewer's own grant to delete", () => {
    const rows = complete();
    expect(pairSides(rows)).toEqual({ mine: rows.a, other: rows.b });
    expect(pairSides({ ...rows, viewerAccountId: ACCOUNT_B })).toEqual({ mine: rows.b, other: rows.a });
    expect(ownPortraitGrantId(rows)).toBe(GRANT_A);
    expect(ownPortraitGrantId({ ...rows, viewerAccountId: ACCOUNT_B })).toBe(GRANT_B);
    expect(ownPortraitGrantId({ ...rows, grants: [rows.grants[1]] })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The one-sided readings (brief line 2238, line 1349).
// ---------------------------------------------------------------------------

const REF: CarrierRefVariant[] = [
  { rsid: 1001, geneSymbol: "GENEA", alt: "G", clinvarSignificance: "Pathogenic" },
  { rsid: 1002, geneSymbol: "GENEA", alt: "G", clinvarSignificance: "Likely pathogenic" },
  { rsid: 1003, geneSymbol: "GENEA", alt: "G", clinvarSignificance: "Benign" },
  { rsid: 2001, geneSymbol: "GENED", alt: "G", clinvarSignificance: "Pathogenic" },
  { rsid: 3001, geneSymbol: "GENEB", alt: "G", clinvarSignificance: "Pathogenic" },
  { rsid: 4001, geneSymbol: "GENEU", alt: "G", clinvarSignificance: "Pathogenic" },
];

const CONDITIONS: CarrierCondition[] = [
  { conditionId: "a", conditionName: "A", geneSymbols: ["GENEA"], inheritanceMode: "autosomal_recessive" },
  { conditionId: "d", conditionName: "D", geneSymbols: ["GENED"], inheritanceMode: "autosomal_dominant" },
  { conditionId: "b", conditionName: "B", geneSymbols: ["GENEB"], inheritanceMode: "autosomal_recessive" },
  { conditionId: "u", conditionName: "U", geneSymbols: ["GENEU"], inheritanceMode: null },
];

function person(id: string, label: string, entries: [number, string][]) {
  return { dataSubjectId: id, displayLabel: label, genotypes: new Map(entries) };
}

function oneSided(
  a: [number, string][],
  b: [number, string][],
  matches: CarrierMatch[] = [],
) {
  return evaluateOneSided({
    a: person(SELF_A, "You", a),
    b: person(SELF_B, "Bo", b),
    refVariants: REF,
    conditions: CONDITIONS,
    matches,
  });
}

describe("the one-sided readings", () => {
  it("finds no second copy where the other file reports a known position and shows no change", () => {
    const readings = oneSided(
      [[1001, "A/G"], [1002, "A/A"], [1003, "A/A"]],
      [[1001, "A/A"], [1002, "A/A"], [1003, "A/A"]],
    );
    expect(readings).toHaveLength(1);
    expect(readings[0]).toMatchObject({
      kind: "no-second-copy",
      gene: "GENEA",
      conditionId: "a",
      carrier: { dataSubjectId: SELF_A, variant: { rsid: 1001, copies: "one copy" } },
      other: { dataSubjectId: SELF_B },
      uncoveredRsid: null,
      // The harmless position is not a known cause; the two pathogenic ones are.
      coverage: { known: 2, covered: 2 },
    });
    expect(noSecondCopy("Bo")).toBe(
      "Based on the variants your files cover, we found no second copy in Bo. This is not zero risk: your files do not cover every variant known to cause this condition.",
    );
  });

  it("cannot calculate where the other file reports none of the gene's known positions, naming the carrier's own position", () => {
    const readings = oneSided([[3001, "A/G"]], [[1003, "A/A"]]);
    expect(readings).toHaveLength(1);
    expect(readings[0]).toMatchObject({
      kind: "not-covered",
      gene: "GENEB",
      carrier: { dataSubjectId: SELF_A },
      other: { dataSubjectId: SELF_B, displayLabel: "Bo" },
      uncoveredRsid: 3001,
      coverage: { known: 1, covered: 0 },
    });
    expect(cannotCalculate("Bo", "rs3001")).toBe(
      "We cannot do this calculation. Bo’s file does not cover rs3001.",
    );
  });

  it("reads either side as the carrier", () => {
    const readings = oneSided([[1001, "A/A"]], [[1001, "A/G"]]);
    expect(readings[0]).toMatchObject({
      kind: "no-second-copy",
      carrier: { dataSubjectId: SELF_B },
      other: { dataSubjectId: SELF_A },
    });
  });

  it("never answers a gene the carrier rule answered, nor one both or neither file shows a change in", () => {
    const match = {
      kind: "probability",
      probability: 0.25,
      gene: "GENEA",
      conditionId: "a",
      conditionName: "A",
      a: { dataSubjectId: SELF_A, displayLabel: "You", variant: { rsid: 1001, classification: "Pathogenic", genotype: "A/G", copies: "one copy" } },
      b: { dataSubjectId: SELF_B, displayLabel: "Bo", variant: { rsid: 1001, classification: "Pathogenic", genotype: "A/G", copies: "one copy" } },
    } as const satisfies CarrierMatch;
    expect(oneSided([[1001, "A/G"]], [[1001, "A/G"]], [match])).toEqual([]);
    expect(oneSided([[1001, "A/G"]], [[1002, "A/G"]])).toEqual([]);
    expect(oneSided([[1001, "A/A"]], [[1001, "A/A"]])).toEqual([]);
  });

  it("stays silent on a dominant or unrecorded pattern, on two copies, and on a reading it cannot count", () => {
    expect(oneSided([[2001, "A/G"]], [[2001, "A/A"]])).toEqual([]);
    expect(oneSided([[4001, "A/G"]], [[4001, "A/A"]])).toEqual([]);
    expect(oneSided([[1001, "G/G"]], [[1001, "A/A"]])).toEqual([]);
    expect(oneSided([[1001, "A/G"]], [[1001, "--"]])).toEqual([]);
    expect(oneSided([[1001, "A/G"]], [[1002, "G"]])).toEqual([]);
  });

  it("counts a gene's known changes against the ones both files report", () => {
    const a = new Map<number, string>([[1001, "A/G"], [1002, "A/A"], [1003, "A/A"]]);
    const b = new Map<number, string>([[1001, "A/A"], [1003, "A/A"]]);
    expect(geneCoverage("GENEA", REF, a, b)).toEqual({ known: 2, covered: 1 });
    expect(geneCoverage("genea", REF, a, b)).toEqual({ known: 2, covered: 1 });
    expect(geneCoverage("NOPE", REF, a, b)).toEqual({ known: 0, covered: 0 });
  });

  it("produces no number and never the string 0% (line 2238)", () => {
    const readings = oneSided([[1001, "A/G"]], [[1001, "A/A"]]);
    expect(JSON.stringify(readings)).not.toContain("0%");
    expect(readings.every((reading) => !("probability" in reading))).toBe(true);
  });
});
