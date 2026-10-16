import { z } from "zod";
import type { DensityStateCase } from "./density-capture-plan";

export function isClaimStartProcessingDensityState(row: DensityStateCase): boolean {
  return row.route.id === "rights.future-person-claim" && row.route.path === "/future-person/claim"
    && row.route.auth === "public" && row.route.stateProfile === "public-rights-flow"
    && row.state === "processing";
}

/** Existing Core doors, not a replacement intake or a completed claim seed. */
export const CLAIM_DENSITY_NATIVE_SOURCES = Object.freeze([
  "scripts/owned-linux-runtime.ts", "e2e/helpers/claim-review-fixture.ts",
  "src/app/(marketing)/future-person/claim/page.tsx", "src/app/api/future-person/claim/route.ts",
  "src/components/future-person/claim-form.tsx", "src/lib/future-person/claim-session.ts",
  "src/lib/future-person/claims-open.ts", "src/copy/rights/future-person-claim.ts",
]);

export const CLAIM_DENSITY_PROTECTED_TABLES = Object.freeze({
  profiles: "public.profiles", subjects: "public.subjects", principals: "public.subject_principals",
  consent: "public.consent_signatures", grants: "public.purpose_grants", files: "public.genome_files",
  estimates: "public.user_prs", variants: "public.user_variants", observedCalls: "public.report_observed_calls",
  ancestry: "public.ancestry_results", cohorts: "public.embryo_cohorts", embryos: "public.embryos",
  qc: "public.embryo_qc", scores: "public.embryo_scores", embryoVariants: "public.embryo_variants",
  futurePersonIdentity: "public.future_person_identity", publicClaims: "public.future_person_claims",
  publicClaimSessions: "public.future_person_claim_sessions", publicClaimDocuments: "public.future_person_claim_documents",
  publicAssignments: "public.future_person_claim_assignments", publicNotices: "public.future_person_claim_notices",
  publicReleases: "public.future_person_claim_release_credentials", publicObjections: "public.future_person_claim_objections",
  publicPackages: "public.future_person_claim_review_packages", recordKeys: "public.future_person_record_key_hashes",
  printRights: "public.future_person_record_key_print_rights", recoveryKeys: "public.future_person_recovery_key_hashes",
  accountBindings: "private.future_person_account_bindings", custody: "private.future_person_custody_slices",
  relocations: "private.future_person_object_relocations", relocationAttempts: "private.future_person_relocation_attempts",
  reviews: "private.claim_reviews", assignments: "private.claim_review_assignments", decisions: "private.claim_review_decisions",
  downloads: "private.claim_review_downloads", reads: "private.claim_review_reads",
  documentSessions: "private.claim_document_sessions", documentFragments: "private.claim_document_fragments",
  documents: "private.claim_documents", abuse: "public.abuse_events", security: "public.account_security_states",
});
const bag = z.object({ count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const protectedBags = z.object(Object.fromEntries(Object.keys(CLAIM_DENSITY_PROTECTED_TABLES)
  .map(name => [name, bag]))).strict();
export const claimStartDensityFactsSchema = z.object({
  protected: protectedBags, intakes: bag, counters: bag, audit: bag,
  auditMark: z.string().regex(/^(0|[1-9][0-9]*)$/),
  intake: z.object({ count: z.literal(1), sessionMatches: z.literal(true), keyMatches: z.literal(true),
    mode: z.literal("record-key"), live: z.literal(true), incomplete: z.literal(true),
    sealed: z.literal(true), hmacRevisionsCurrent: z.literal(true), deadlineIsOneDay: z.literal(true),
    originalClocks: z.literal(true) }).strict().nullable(),
  auditAppend: z.object({ prefix: bag, count: z.literal(1), exactStart: z.literal(true) }).strict().nullable(),
}).strict().refine(value => value.intake === null
  ? value.intakes.count === 0 && value.auditAppend === null
  : value.intakes.count === 1 && value.auditAppend !== null, "Fresh pending absence or one genuinely committed start required");
export type ClaimStartDensityFacts = z.infer<typeof claimStartDensityFactsSchema>;
