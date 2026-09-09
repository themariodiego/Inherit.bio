import "server-only";
import { z } from "zod";
import { decodeCanonicalBlock } from "./canonical-codec";
import { validateCanonicalContainerDescriptor, type CanonicalContainerDescriptor } from "./canonical-containers";
import { preparedObjectKeySchema } from "./storage-common";
import { PreparedStorageReadError, readPreparedStorageRange, type PreparedStorageReadOptions } from "./storage-reader";

/** Read one canonical block from a validated, independently authorized immutable
 * container selection. Shared transport checks authority before I/O and after
 * complete hash/schema verification. A multi-block report/export still needs its
 * own final exact-manifest authority check before commit or data release. */
export async function readCanonicalStorageBlock(selection: {
  objectKey: string; container: CanonicalContainerDescriptor; blockSequence: number;
}, options: PreparedStorageReadOptions) {
  let container: CanonicalContainerDescriptor, objectKey: string, sequence: number;
  try {
    objectKey = preparedObjectKeySchema.parse(selection.objectKey);
    sequence = z.number().int().nonnegative().safe().parse(selection.blockSequence);
    container = validateCanonicalContainerDescriptor(selection.container);
  } catch { throw new PreparedStorageReadError("invalid_selection"); }
  const block = container.blocks.find(entry => entry.descriptor.sequence === sequence);
  if (!block) throw new PreparedStorageReadError("invalid_selection");
  return readPreparedStorageRange({ objectKey, offset: block.offset, length: block.length, total: container.byteCount }, {
    ...options, decode: (bytes, signal) => decodeCanonicalBlock((async function* () { yield bytes; })(), block.descriptor, { signal }),
  });
}
