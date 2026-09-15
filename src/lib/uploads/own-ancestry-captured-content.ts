/** Read stored revisions without reinterpreting them under today's estimator. */
import { z } from "zod";
import { ownAncestryContentSchema as historicalSchema } from "./own-ancestry-content";
import { ownAncestryContentV3Schema } from "./own-ancestry-content-v3";
export const ownAncestryCapturedContentSchema = z.union([ownAncestryContentV3Schema, historicalSchema]);
export type OwnAncestryCapturedContent = z.infer<typeof ownAncestryCapturedContentSchema>;
