/**
 * The path brief A.6 names for the rejection codes (`src/lib/genome/
 * ingest-errors.ts`). The one home of the codes and their sentences is
 * `src/copy/upload/errors.ts` (docs/canonical-artifacts.md, "Genetic-ingest
 * rejection IDs and user-facing messages"); this module re-exports it so
 * the ingest code reads from the brief's path without a second definition.
 */
export {
  EMBRYO_QC_REFUSAL_CODES,
  EMBRYO_REASON_PARTS,
  INGEST_REFUSAL_CODES,
  INGEST_REFUSALS,
  ingestRefusal,
  isIngestRefusalCode,
  type EmbryoQcRefusalCode,
  type IngestRefusalCode,
  type IngestRefusalSlots,
} from "@/copy/upload/errors";
