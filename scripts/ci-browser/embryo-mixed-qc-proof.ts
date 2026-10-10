import { z } from "zod";

/** Exact one-chunk/two-ordinal real publication, including the failed
 * ordinal's absence of both canonical source and canonical part. */
const publication = z.object({ jobs: z.literal(1), sessions: z.literal(1), cohorts: z.literal(1),
  sources: z.literal(1), parts: z.literal(1), allPartsCurrent: z.literal(true),
  pendingOrdinals: z.literal(0), pendingVariants: z.literal(0), scores: z.literal(0),
  ordinals: z.tuple([
    z.object({ ordinal: z.literal(0), status: z.literal("qc_pass"), sources: z.literal(1), parts: z.literal(1) }).strict(),
    z.object({ ordinal: z.literal(1), status: z.literal("qc_fail"), sources: z.literal(0), parts: z.literal(0) }).strict(),
  ]),
}).strict();
export function assertMixedQcPublication(value: unknown) { return publication.parse(value); }
