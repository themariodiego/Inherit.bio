/**
 * The embryo-ingest limits — the runtime mirror of
 * `docs/route-register.json#payloadBoundaryContract` (ADR 0016: the register
 * owns every fixed function-body, ingest-chunk and embryo-session number).
 * `src/lib/genome/ingest-limits.test.ts` asserts each value equals the
 * register's, so a drift fails the unit suite; no route, component or copy
 * carries a second copy of these numbers. The `{n}` of the `too_large`
 * refusal for an embryo ingest reads `megabytesOf` over the input ceiling.
 */

/** `payloadBoundaryContract.ingestChunkMaximumBytes`. */
export const INGEST_CHUNK_MAXIMUM_BYTES = 4_000_000;

/** `payloadBoundaryContract.embryoIngestSessionLimits`. */
export const EMBRYO_INGEST_SESSION_LIMITS = {
  maximumUncompressedInputBytes: 200_000_000,
  maximumChunks: 50,
  maximumLogicalRecords: 10_000_000,
  maximumSampleColumns: 64,
  maximumLogicalLineBytes: 1_000_000,
  maximumConcurrentSessionsPerAccount: 2,
  maximumConcurrentSessionsPerCohort: 1,
} as const;

/** Whole megabytes (decimal, as the contract counts bytes) for the `too_large` sentence. */
export function megabytesOf(bytes: number): number {
  return Math.floor(bytes / 1_000_000);
}
