/** Read stored revisions without reinterpreting them under today's estimator. */
import { z } from "zod";
import { ownAncestryContentSchema as historicalSchema } from "./own-ancestry-content";
import { ownAncestryContentV3Schema } from "./own-ancestry-content-v3";
import { ownAncestryContentV4Schema } from "./own-ancestry-content-v4";
import { ownAncestryContentV5Schema } from "./own-ancestry-content-v5";
// Revision 5 (the Neanderthal estimate) is accepted first, then 4, 3 and the
// historical revisions. Readers that do not surface the estimate ignore the
// `neanderthal` block; only the ancestry page's own loader reads it.
export const ownAncestryCapturedContentSchema = z.union([ownAncestryContentV5Schema, ownAncestryContentV4Schema, ownAncestryContentV3Schema, historicalSchema]);
export type OwnAncestryCapturedContent = z.infer<typeof ownAncestryCapturedContentSchema>;
