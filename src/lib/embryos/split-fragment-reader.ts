import "server-only";
import { z } from "zod";
import { EmbryoFragmentStorageError, embryoStoredFragmentSchema, readEmbryoFragment } from "./fragment-storage";
import { EmbryoSplitFragmentMismatch, type EmbryoFragmentReader } from "./split-worker";

/** The R2 landed identity `read_embryo_split_fragment_v1` issues. */
const r2LandedSchema = z.object({ backend: z.literal("r2"), stored: embryoStoredFragmentSchema }).strict();

/**
 * The worker's fragment seam over the R2 fragment store
 * (docs/embryo-fragment-storage.md). SQL has already established, under the
 * live claim, that this exact landed fragment may be read now, and names its
 * version; `readEmbryoFragment` reads that version to EOF and checks size and
 * SHA-256. Anything that is not an R2 landing of exactly this (session,
 * sequence, ordinal, size, digest) is a mismatch, as is a version the store no
 * longer holds. Only transport trouble is left to retry.
 */
export function r2EmbryoFragmentReader(read: typeof readEmbryoFragment = readEmbryoFragment): EmbryoFragmentReader {
  return async (ref, signal) => {
    const landed = r2LandedSchema.safeParse(ref.landed);
    if (!landed.success) throw new EmbryoSplitFragmentMismatch();
    const { receipt } = landed.data.stored;
    if (receipt.sessionId !== ref.sessionId || receipt.sequence !== ref.sequence || receipt.ordinal !== ref.ordinal
      || receipt.byteCount !== ref.byteCount || receipt.sha256 !== ref.sha256) throw new EmbryoSplitFragmentMismatch();
    try {
      return await read({ stored: landed.data.stored, signal });
    } catch (error) {
      if (error instanceof EmbryoFragmentStorageError
        && (error.code === "integrity_mismatch" || error.code === "conflict" || error.code === "invalid_request")) {
        throw new EmbryoSplitFragmentMismatch();
      }
      throw error;
    }
  };
}
