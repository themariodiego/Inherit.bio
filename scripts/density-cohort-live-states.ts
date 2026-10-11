import { z } from "zod";
import type { DensityStateCase } from "./density-capture-plan";
import { publishedCohortBagSchema } from "./density-cohort-publication-states";

export type CohortLiveDensityRecipe = "processing" | "analysis-pending";
export const COHORT_LIVE_DENSITY_STATES: Readonly<Record<string, Readonly<Record<string, CohortLiveDensityRecipe>>>> = {
  "embryos.index": { processing: "processing" },
  "embryos.upload": { processing: "processing" },
  "embryos.compare": { processing: "processing", "consent-required": "analysis-pending" },
  "embryos.detail": { processing: "processing", "consent-required": "analysis-pending" },
};
export function cohortLiveDensityRecipe(row: DensityStateCase): CohortLiveDensityRecipe | null {
  return Object.hasOwn(COHORT_LIVE_DENSITY_STATES, row.route.id)
    && Object.hasOwn(COHORT_LIVE_DENSITY_STATES[row.route.id], row.state)
    ? COHORT_LIVE_DENSITY_STATES[row.route.id][row.state] : null;
}

const uuid = z.string().uuid();
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const bag = z.object({ count, sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const exactly = (value: number) => bag.refine(row => row.count === value, "Exact live native row count required");
const present = bag.refine(row => row.count > 0, "Actual parent authority required");
const pendingBags = z.object({
  cohort: exactly(1), embryos: exactly(2), subjects: exactly(2), files: exactly(0), qc: exactly(0), scores: exactly(0),
  variants: exactly(0), jobs: exactly(1), sessions: exactly(1), basis: exactly(1), participants: present,
  parentHistory: present, grants: exactly(0), attestations: present, operationHistory: bag, futurePersonProfiles: exactly(0),
  principals: present, profiles: present, sources: exactly(0), parts: exactly(0), memberships: exactly(0),
}).strict();
const common = {
  ownerMatches: z.literal(true), cohortId: uuid, ownerId: uuid,
  embryos: z.array(z.object({ id: uuid, subjectId: uuid, sampleOrdinal: z.number().int().min(0).max(1),
    status: z.enum(["pending", "qc_pass"]) }).strict()).length(2),
  jobId: uuid, sessionId: uuid, sessionWorkerJobId: uuid, jobSourceBindingId: uuid,
  analysisGrants: z.literal(0), allSplitJobs: z.literal(1),
  pendingOrdinals: exactly(0), pendingVariants: exactly(0), writeIntents: bag, inputFragments: bag, directions: exactly(0),
  drafts: exactly(1), splitConfig: exactly(1), objectConfig: exactly(1),
};
export const liveCohortDensitySchema = z.discriminatedUnion("phase", [
  z.object({ ...common, phase: z.literal("processing"), cohortStatus: z.literal("ingesting"), publicationRevision: z.null(),
    jobStatus: z.literal("queued"), jobAttempts: z.literal(0), sessionStatus: z.literal("sanitization_pending"),
    bags: pendingBags }).strict(),
  z.object({ ...common, phase: z.literal("analysis-pending"), cohortStatus: z.literal("active"), publicationRevision: z.literal(1),
    jobStatus: z.literal("done"), jobAttempts: z.literal(1), sessionStatus: z.literal("published"),
    bags: publishedCohortBagSchema.extend({ grants: exactly(0) }) }).strict(),
]).superRefine((value, context) => {
  if (value.jobId !== value.sessionWorkerJobId || value.sessionId !== value.jobSourceBindingId
    || new Set(value.embryos.map(row => row.id)).size !== 2 || new Set(value.embryos.map(row => row.subjectId)).size !== 2
    || JSON.stringify(value.embryos.map(row => row.sampleOrdinal).sort()) !== "[0,1]"
    || value.embryos.some(row => row.status !== (value.phase === "processing" ? "pending" : "qc_pass")))
    context.addIssue({ code: "custom", message: "Exact current cohort, source and worker context required" });
});
export type LiveCohortDensity = z.infer<typeof liveCohortDensitySchema>;
