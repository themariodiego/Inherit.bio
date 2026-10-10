import "server-only";
import type { Zip64Spool } from "./archive-zip64";
import type {RequesterStatementRuntime} from "./requester-statement-runtime";
/** Central records only: actual ZIP64 code passes a 74..329-byte directory
 * record here, never an archive payload. No file or durable wrapping key exists.
 * The explicit bound refuses an oversized whole archive before READY. */
export function createRequesterStatementMemorySpool(runtime?:RequesterStatementRuntime): Zip64Spool {
 const buffers: Uint8Array[] = [], replayCopies: Uint8Array[] = [];let size = 0, disposed = false, replayed = false;
 const unavailable = () => new Error("requester_statement_spool_unavailable");
 return Object.freeze({
  async append(record: Uint8Array, signal: AbortSignal) {
   if (disposed || replayed || signal.aborted || !(record instanceof Uint8Array)
     || record.byteLength < 74 || record.byteLength > 329 || size + record.byteLength > 4_000_000) throw unavailable();
   const copy=Uint8Array.from(record);runtime?.own(copy);buffers.push(copy);size += record.byteLength;
  },
  replay(signal: AbortSignal) {
   if (disposed || replayed || signal.aborted) throw unavailable();replayed = true;let index = 0;
   return new ReadableStream<Uint8Array>({ pull(controller) {
    if (disposed || signal.aborted) { controller.error(unavailable());return; }
    if (index === buffers.length) { controller.close();return; }
    // Ownership transfers a distinct zeroable copy, leaving the source guarded.
    const copy = Uint8Array.from(buffers[index++]);runtime?.own(copy);replayCopies.push(copy);controller.enqueue(copy);
   } }, { highWaterMark: 0 });
  },
  async dispose() { disposed = true;for (const bytes of [...buffers, ...replayCopies]){if(runtime)runtime.clear(bytes);else bytes.fill(0);}buffers.length = 0;replayCopies.length = 0;size = 0; },
 });
}
