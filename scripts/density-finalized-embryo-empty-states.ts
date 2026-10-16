import assert from "node:assert/strict";
import { z } from "zod";
import type { DensityStateCase } from "./density-capture-plan";
import { isUntouchedPendingInput, parsePendingEmbryoInput, pendingEmbryoInputSchema,
  pendingEmbryoScopeSchema } from "../src/lib/embryos/pending-input";

/** Full current source admission still belongs to the existing launcher and
 * capture driver. Missing any native producer/reader source leaves HOLD. */
export const FINALIZED_EMBRYO_EMPTY_DENSITY_SOURCES = [
  "e2e/density-embryo-empty-state-fixtures.ts", "e2e/participant-c-journey.ts",
  "e2e/helpers/claim-review-fixture.ts", "e2e/helpers/native-response-observer.ts",
  "scripts/ci-embryo-journey.ts", "scripts/local-e2e-project.ts", "scripts/owned-linux-runtime.ts",
  "src/lib/embryos/pending-input.ts", "src/lib/embryos/pending-input-read.ts",
  "src/lib/embryos/access.ts", "src/app/(app)/embryos/[embryoId]/page.tsx",
  "supabase/migrations/20261011010251_embryo_pending_input_read.sql",
] as const;

export function finalizedEmbryoEmptyDensityRecipe(row: DensityStateCase) {
  if (row.route.id !== "embryos.detail" || row.state !== "empty") return null;
  assert(row.route.path === "/embryos/[embryoId]" && row.route.kind === "page"
    && row.route.auth === "authenticated" && row.route.stateProfile === "product-result",
  "Exact registered embryo detail empty route required");
  return "finalized-no-file" as const;
}

const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const factsSchema = z.object({ pendingInput: pendingEmbryoInputSchema,
  nativeSessionId: z.uuid(), completeNativeBag: digest }).strict();
const expectedSchema = pendingEmbryoScopeSchema.extend({ nativeSessionId: z.uuid(), completeNativeBag: digest }).strict();
export type FinalizedEmbryoEmptyFacts = z.infer<typeof factsSchema>;

/** This is an internal check of actual reader output, never a native proof
 * producer. The existing observer must independently supply DensityStateProof.
 * snapshotAt is the native liveness clock; completeNativeBag binds every
 * stored column. The clock is not substituted for that complete row bag. */
export function checkedFinalizedEmbryoEmptyFacts(value: unknown, expected: z.infer<typeof expectedSchema>) {
  const actual = factsSchema.parse(value), selected = expectedSchema.parse(expected);
  const scope = { accountId: selected.accountId, cohortId: selected.cohortId,
    embryoId: selected.embryoId, subjectId: selected.subjectId };
  assert(parsePendingEmbryoInput(actual.pendingInput, scope) !== null
    && isUntouchedPendingInput(actual.pendingInput)
    && actual.nativeSessionId === selected.nativeSessionId
    && actual.pendingInput.sessions.length === 1
    && actual.pendingInput.sessions[0].id === selected.nativeSessionId
    && actual.completeNativeBag === selected.completeNativeBag,
  "Actual unchanged owner, subject, session and complete empty native bag required");
  return actual;
}
