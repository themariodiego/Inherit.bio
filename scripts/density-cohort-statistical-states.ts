import { z } from "zod";
import type { DensityStateCase } from "./density-capture-plan";
import { COHORT_DENSITY_NATIVE_SOURCES, publishedCohortBagSchema } from "./density-cohort-publication-states";

export type StatisticalCohortDensityRecipe = "uncovered" | "fitted-partial";
export function statisticalCohortDensityRecipe(row: DensityStateCase): StatisticalCohortDensityRecipe | null {
  const paths: Record<string, string> = { "embryos.index": "/embryos", "embryos.compare": "/embryos/compare",
    "embryos.detail": "/embryos/[embryoId]" };
  if (!Object.hasOwn(paths, row.route.id) || row.route.path !== paths[row.route.id]
    || row.route.auth !== "authenticated" || row.route.stateProfile !== "product-result") return null;
  return row.state === "not-covered" ? "uncovered" : row.state === "partial-coverage" ? "fitted-partial" : null;
}
export const STATISTICAL_COHORT_DENSITY_NATIVE_SOURCES = Object.freeze([
  ...COHORT_DENSITY_NATIVE_SOURCES, "e2e/helpers/embryo-statistical-coverage-audit.ts",
  "src/lib/embryos/statistical-fit-contract.ts", "src/lib/embryos/statistical-read.ts",
  "src/components/embryo/statistical-coverage.tsx", "e2e/fixtures/embryo-pair-fitted-partial-grch38.vcf",
]);
const completedBag = z.object({ count: z.literal(2), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const statisticalCohortBagSchema = publishedCohortBagSchema.extend({ scores: completedBag, jobs: completedBag });

/** Exactly the two native job/score bags may advance after the original
 * statistical producer. Every complete source/parent/QC field stays exact. */
export function checkedStatisticalCohortBags(before: unknown, after: unknown) {
  const initial = publishedCohortBagSchema.parse(before), current = statisticalCohortBagSchema.parse(after);
  for (const name of Object.keys(initial)) {
    if (name === "scores" || name === "jobs") continue;
    if (JSON.stringify(initial[name as keyof typeof initial]) !== JSON.stringify(current[name as keyof typeof current]))
      throw new Error("Statistical work changed the complete publication or authority graph");
  }
  return current;
}
