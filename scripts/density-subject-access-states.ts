import { z } from "zod";
import type { DensityStateCase } from "./density-capture-plan";
import { APPEAL_REVIEW_DENSITY_NATIVE_SOURCES, APPEAL_REVIEW_DENSITY_TABLES } from "./density-appeal-review-states";

export function isSubjectAccessProcessingDensityState(row: DensityStateCase): boolean {
  return row.route.id === "rights.subject-access" && row.route.path === "/legal/appeals"
    && row.route.auth === "public" && row.route.stateProfile === "public-rights-flow" && row.state === "processing";
}
export const SUBJECT_ACCESS_DENSITY_NATIVE_SOURCES = Object.freeze([
  ...APPEAL_REVIEW_DENSITY_NATIVE_SOURCES, "src/app/(marketing)/legal/appeals/page.tsx",
  "src/components/future-person/appeal-intake-form.tsx", "src/app/api/appeals/route.ts",
  "src/lib/future-person/appeal-form.ts", "src/lib/future-person/appeals-open.ts",
]);
export const SUBJECT_ACCESS_DENSITY_TABLES = APPEAL_REVIEW_DENSITY_TABLES;
const bag = z.object({ count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const subjectAccessDensityFactsSchema = z.object({
  completeBags: z.object(Object.fromEntries(Object.keys(SUBJECT_ACCESS_DENSITY_TABLES).map(name => [name, bag]))).strict(),
  scope: z.object({ reviewerConfigured: z.literal(true), liveSession: z.literal(true),
    noCaseForReviewer: z.literal(true), intakeEnabled: z.literal(true) }).strict(),
}).strict();
export type SubjectAccessDensityFacts = z.infer<typeof subjectAccessDensityFactsSchema>;
