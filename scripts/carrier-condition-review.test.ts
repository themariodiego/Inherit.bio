import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SIGN_OFF_HEADING,
  buildReviewNote,
  rankedFromNote,
  reviewedPart,
  reviewNotePath,
  reviewScenarios,
  type ReviewAssertion,
  type ReviewCondition,
  type ReviewInput,
} from "./carrier-condition-review";

/**
 * The owner's review notes (`docs/carrier-condition-reviews/`), one per
 * starter condition, each the reference its activation records.
 *
 * Everything above a note's sign-off section is built again here from the
 * pinned data and the real components and compared character for
 * character. A changed count, source, label or rendered sentence fails,
 * which means the note no longer describes what the owner would be signing.
 * The owner's own section (ticks, severity, name, date) is not compared.
 *
 * What this cannot check: that the ten listed changes are the ten with the
 * most ClinVar submitters. The submitter counts come from the pinned
 * 442 MB release, which the repository does not hold. The check holds the
 * listed ten to their own counts' order and to the pinned extract.
 */
const ROOT = process.cwd();
const read = (file: string) => JSON.parse(readFileSync(path.join(ROOT, file), "utf8"));
const conditions = (read("data/ref/carrier/conditions.json") as { conditions: ReviewCondition[] }).conditions;
const extract = read("data/ref/carrier/clinvar-assertions.json") as { columns: string[]; assertions: unknown[][] };
const manifest = read("data/ref/carrier/manifest.json") as {
  counts: Record<string, ReviewInput["counts"]>;
  sources: { clinvar: { sha256: string }; clingen: { sha256: string; fileCreated: string } };
};
const column = (name: string) => extract.columns.indexOf(name);
const assertionsOf = (conditionId: string): ReviewAssertion[] => extract.assertions
  .filter((row) => row[column("conditionId")] === conditionId)
  .map((row) => ({
    variationId: row[column("variationId")] as number,
    name: row[column("name")] as string,
    classification: row[column("classification")] as string,
    reviewStatus: row[column("reviewStatus")] as string,
    stars: row[column("stars")] as number,
    lastEvaluated: row[column("lastEvaluated")] as string | null,
    grch38: row[column("grch38")] as ReviewAssertion["grch38"],
    grch38Equivalents: row[column("grch38Equivalents")] as unknown[],
  }));

describe("the carrier condition review notes", () => {
  it("has exactly one note per starter condition", () => {
    const notes = readdirSync(path.join(ROOT, "docs/carrier-condition-reviews")).filter((file) => file.endsWith(".md")).sort();
    expect(notes).toEqual(conditions.map((condition) => `${condition.gene}.md`).sort());
  });

  describe.each(conditions.map((condition) => [condition.gene, condition] as const))("%s", (gene, condition) => {
    const note = readFileSync(path.join(ROOT, reviewNotePath(gene)), "utf8");
    const assertions = assertionsOf(condition.conditionId);
    const ranked = rankedFromNote(note);

    it("lists ten of this condition's assertions, ranked by submitters, then stars, then VariationID", () => {
      expect(ranked).toHaveLength(Math.min(10, assertions.length));
      const byId = new Map(assertions.map((row) => [row.variationId, row]));
      for (const row of ranked) expect(byId.has(row.variationId), String(row.variationId)).toBe(true);
      const keys = ranked.map((row) => [-row.submitters, -byId.get(row.variationId)!.stars, row.variationId]);
      const sorted = [...keys].sort((left, right) => left[0] - right[0] || left[1] - right[1] || left[2] - right[2]);
      expect(keys).toEqual(sorted);
    });

    it("says, above its sign-off, exactly what the pinned data and the rendered pages say", () => {
      const built = buildReviewNote({
        condition, assertions, counts: manifest.counts[condition.conditionId], topTen: ranked,
        sources: { clinvarSha256: manifest.sources.clinvar.sha256, clingenSha256: manifest.sources.clingen.sha256,
          clingenFileCreated: manifest.sources.clingen.fileCreated },
      });
      expect(note).toContain(`\n${SIGN_OFF_HEADING}\n`);
      expect(reviewedPart(note)).toBe(reviewedPart(built));
    });
  });

  it("renders the brief's laboratory and penetrance lines and ClinVar's attribution on every carrier card", () => {
    const example = { gene: "CFTR", variantName: "example", classification: "Pathogenic",
      reviewStatus: "practice guideline", reviewStars: 4, lastEvaluated: "2004-03-03", variationId: 7105, known: 2 };
    const seen = reviewScenarios(example, { ...example, variantName: "second", variationId: 7115 });
    const cards = [seen.portraitBothCarry, seen.portraitNoSecondCopy, seen.portraitNotCovered,
      ...Object.values(seen.portraitRefused), seen.healthPictureBothCarry];
    for (const card of cards) {
      expect(card).toContain("Before anyone acts on this, it needs confirming in an accredited laboratory. Consumer files are not a clinical test.");
      expect(card).toContain("Penetrance for this variant has not been established.");
      expect(card).toContain("Classifications from ClinVar (NCBI), release 2026-09. Gene links from ClinGen, read 28 September 2026.");
    }
    // A finding never reads as "not a carrier", and no number replaces a refusal.
    for (const card of cards) expect(card.join("\n")).not.toMatch(/not a carrier|(?<!\d)0 in 100|(?<![\d.])0%/i);
    for (const card of Object.values(seen.portraitRefused)) expect(card.join("\n")).not.toMatch(/\bin 100\b|1 in 4/);
  });
});
