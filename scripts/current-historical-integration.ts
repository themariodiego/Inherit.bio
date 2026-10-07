/** Genuine original byte custody -> stock ZIP decode ->
 * explicit admitted raw historical semantics. No legacy DTO, proposal or CLI. */
import assert from "node:assert/strict";
import { readOwnedCurrentCapture, type CurrentInputAdmission } from "./current-capture-io";
import { type CurrentCaptureAdmission } from "./current-capture-adapter";
import { decodeHistoricalZip } from "./ci-browser-duration-history-io";
import { historicalDurationSource, type HistoricalCaptureInput } from "./ci-browser-duration-history";

export function readAdmittedCurrentHistoricalInput(io: CurrentInputAdmission,
  admission: CurrentCaptureAdmission): HistoricalCaptureInput {
  // Both complete admission files require separate genuine SOURCE/PLAN review;
  // a captured schema status or recomputed hash cannot confer approval.
  assert.deepEqual(admission.capturePin, io.captureReceipt, "IO and semantic original capture pins differ");
  assert(admission.request.runAttempt === io.runAttempt, "IO and semantic run attempts differ");
  const original = readOwnedCurrentCapture(io);
  return { captureFormat: "hosted-reader-raw-v1", captureAdmission: admission,
    run: original.run, jobs: original.jobs, artifacts: original.artifacts,
    testedCommit: original.testedCommit, captureReceipt: original.captureReceipt,
    manifest: { bytes: original.manifestZip,
      value: decodeHistoricalZip(original.manifestZip, "ci-browser-manifest.json") },
    shards: original.shardZips.map(bytes => ({ bytes,
      value: decodeHistoricalZip(bytes, "ci-browser-shard.json") })) };
}
export function admittedCurrentHistoricalSource(io: CurrentInputAdmission, admission: CurrentCaptureAdmission) {
  return historicalDurationSource(readAdmittedCurrentHistoricalInput(io, admission));
}
