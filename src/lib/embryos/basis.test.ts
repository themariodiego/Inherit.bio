import { describe, expect, it } from "vitest";
import { BASIS_OPTIONS, SITUATION_OPTIONS } from "@/copy/embryos/upload";
import {
  BASES,
  BASIS_CASES,
  EMBRYO_ANALYSIS_GRANT_STATEMENT_KEYS,
  EMBRYO_ARTIFACT_KEYS,
  EMBRYO_ARTIFACT_STATEMENT_KEYS,
  EMBRYO_COUNT_MAXIMUM,
  EMBRYO_UPLOAD_UPLOADER_STATEMENT_KEYS,
  UPLOAD_SITUATIONS,
  basisCaseFor,
  dispositionModeFor,
  requiredContactCount,
  requiredPrincipalSlotLabels,
  typedNameIsValid,
  uploadClassFor,
  uploadSituationValue,
  type Basis,
  type UploadSituation,
} from "./basis";

/** Every (situation × basis) cell of contract §1: exact contact count and the slot labels of the 201 body. */
const CELLS: readonly [UploadSituation, Basis, 0 | 1 | 2, string[]][] = [
  ["own-embryos", "two-evidenced-parents", 1, ["other-genetic-parent"]],
  ["own-embryos", "donor-gamete-anonymous", 0, []],
  ["own-embryos", "parent-deceased", 0, []],
  ["own-embryos", "sole-legal-disposition-authority", 0, []],
  ["with-genetic-parents-permission", "two-evidenced-parents", 2, ["genetic-parent", "genetic-parent"]],
  ["with-genetic-parents-permission", "donor-gamete-anonymous", 1, ["genetic-parent"]],
  ["with-genetic-parents-permission", "parent-deceased", 1, ["genetic-parent"]],
  ["with-genetic-parents-permission", "sole-legal-disposition-authority", 1, ["genetic-parent"]],
];

/**
 * The draft vocabulary (contract §1-§2): request values to schema values,
 * the exact contact cardinality of every situation and basis, the
 * disposition mode of every basis case, the statement keys of every
 * artifact in published order, and the Tier-2 typed-name rule.
 */
describe("embryo basis vocabulary", () => {
  it("lists the same situations and bases the upload flow offers, in the same order", () => {
    expect(SITUATION_OPTIONS.map((option) => option.id)).toEqual([...UPLOAD_SITUATIONS]);
    expect(BASIS_OPTIONS.map((option) => option.id)).toEqual([...BASES]);
    expect(BASIS_CASES).toEqual(["true_two_parent", "anonymous_donor", "parent_deceased", "sole_legal_authority"]);
  });

  it.each([
    ["two-evidenced-parents", "true_two_parent"],
    ["donor-gamete-anonymous", "anonymous_donor"],
    ["parent-deceased", "parent_deceased"],
    ["sole-legal-disposition-authority", "sole_legal_authority"],
  ] as const)("maps basis %s to case %s", (basis, basisCase) => {
    expect(basisCaseFor(basis)).toBe(basisCase);
  });

  it.each([
    ["true_two_parent", "two-parent-propose-confirm"],
    ["anonymous_donor", "single-authority-direct"],
    ["parent_deceased", "single-authority-direct"],
    ["sole_legal_authority", "single-authority-direct"],
  ] as const)("records a disposition for case %s in mode %s", (basisCase, mode) => {
    expect(dispositionModeFor(basisCase)).toBe(mode);
  });

  it.each([
    ["own-embryos", "own_embryos", "embryo_own"],
    ["with-genetic-parents-permission", "with_genetic_parents_permission", "embryo_third_party"],
  ] as const)("stores situation %s as %s with upload class %s", (situation, value, uploadClass) => {
    expect(uploadSituationValue(situation)).toBe(value);
    expect(uploadClassFor(situation)).toBe(uploadClass);
  });

  it("covers every situation and basis exactly once in its contact table", () => {
    expect(CELLS).toHaveLength(UPLOAD_SITUATIONS.length * BASES.length);
    const seen = new Set(CELLS.map(([situation, basis]) => `${situation}/${basis}`));
    for (const situation of UPLOAD_SITUATIONS) {
      for (const basis of BASES) expect(seen.has(`${situation}/${basis}`), `${situation}/${basis}`).toBe(true);
    }
  });

  it.each(CELLS)("requires exactly the contacts of %s with %s: %i, labelled %j", (situation, basis, count, labels) => {
    expect(requiredContactCount(situation, basis)).toBe(count);
    expect(requiredPrincipalSlotLabels(situation, basis)).toEqual(labels);
    expect(requiredPrincipalSlotLabels(situation, basis)).toHaveLength(count);
  });

  it("returns a fresh label array on every call, so a caller cannot change the table", () => {
    const first = requiredPrincipalSlotLabels("with-genetic-parents-permission", "two-evidenced-parents");
    first.push("changed");
    expect(requiredPrincipalSlotLabels("with-genetic-parents-permission", "two-evidenced-parents")).toEqual([
      "genetic-parent",
      "genetic-parent",
    ]);
  });

  it("publishes the six artifact keys and their statement keys in contract §2 order", () => {
    expect(EMBRYO_ARTIFACT_KEYS).toEqual([
      "consent.upload-embryo",
      "attestation.embryo-parentage",
      "attestation.embryo-disposition-rights",
      "attestation.embryo-single-parent-basis",
      "charter.future-person",
      "disclosure.insurance-and-discrimination",
    ]);
    expect(Object.keys(EMBRYO_ARTIFACT_STATEMENT_KEYS)).toEqual([...EMBRYO_ARTIFACT_KEYS]);
    expect(EMBRYO_ARTIFACT_STATEMENT_KEYS["consent.upload-embryo"]).toEqual([
      "genetic-parent-or-authority",
      "no-outcome-data",
      "future-person-charter",
      "withdraw-any-time",
    ]);
    expect(EMBRYO_ARTIFACT_STATEMENT_KEYS["attestation.embryo-parentage"]).toEqual([
      "genetic-parent-of-these-embryos",
      "other-parent-named-truthfully",
      "false-statement-warning-read",
    ]);
    expect(EMBRYO_ARTIFACT_STATEMENT_KEYS["attestation.embryo-disposition-rights"]).toEqual([
      "right-to-decide-disposition",
      "no-dispute-or-proceeding",
      "objection-stops-and-deletes",
    ]);
    expect(EMBRYO_ARTIFACT_STATEMENT_KEYS["attestation.embryo-single-parent-basis"]).toEqual([
      "basis-is-true",
      "evidence-is-genuine",
      "objection-stops-analysis",
    ]);
    expect(EMBRYO_ARTIFACT_STATEMENT_KEYS["charter.future-person"]).toEqual(["read-in-full", "rights-are-enforceable"]);
    expect(EMBRYO_ARTIFACT_STATEMENT_KEYS["disclosure.insurance-and-discrimination"]).toEqual(["understood"]);
    expect(EMBRYO_UPLOAD_UPLOADER_STATEMENT_KEYS).toEqual([
      "uploader-right-to-files",
      "not-a-genetic-parent",
      "parents-permission-held",
      "withdraw-any-time",
    ]);
    expect(EMBRYO_ANALYSIS_GRANT_STATEMENT_KEYS).toEqual(["one-purpose", "every-parent-must-agree", "pause-or-stop-any-time"]);
  });

  it("uses no statement key twice within one artifact", () => {
    for (const [key, keys] of Object.entries(EMBRYO_ARTIFACT_STATEMENT_KEYS)) {
      expect(new Set(keys).size, key).toBe(keys.length);
    }
    expect(new Set(EMBRYO_UPLOAD_UPLOADER_STATEMENT_KEYS).size).toBe(EMBRYO_UPLOAD_UPLOADER_STATEMENT_KEYS.length);
    expect(new Set(EMBRYO_ANALYSIS_GRANT_STATEMENT_KEYS).size).toBe(EMBRYO_ANALYSIS_GRANT_STATEMENT_KEYS.length);
  });

  it("caps a cohort at 64 embryos", () => {
    expect(EMBRYO_COUNT_MAXIMUM).toBe(64);
  });

  it.each([
    ["Ada Test", true],
    ["Ada Test Person", true],
    ["Ada\tTest", true],
    ["Ada    Test", true],
    ["  Ada Test  ", true],
    ["Ada B Test", true],
    ["Ño Ün", true],
    ["A B", false],
    ["Ada B", false],
    ["Ada", false],
    ["Ada ", false],
    ["", false],
    ["   ", false],
    ["A\tB", false],
  ])("judges the typed name %j valid: %s", (name, valid) => {
    expect(typedNameIsValid(name)).toBe(valid);
  });
});
