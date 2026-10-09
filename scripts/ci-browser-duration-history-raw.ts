/** Explicit offline raw-history observation and append proposal. No network,
 * credentials, profile overwrite, legacy receipt synthesis or current CI proof. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync, type Stats } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { multiRunDurationSourceSchema, parseMultiRunBrowserDurationProfile, validateMultiRunDurationHistory,
  type MultiRunDurationHistory, type MultiRunDurationSource } from "./ci-browser-duration-history";
import { reserveOfflineOutput, writeReservedOfflineHistoryFile } from "./ci-browser-duration-history-io";
import { readOwnedCurrentCapture, type CurrentInputAdmission, type DirectoryIdentity, type EntryIdentity, type OriginalPin } from "./current-capture-io";
import { type CurrentCaptureAdmission } from "./current-capture-adapter";
import { admittedCurrentHistoricalSource } from "./current-historical-integration";

const sha = (raw: Buffer | string) => createHash("sha256").update(raw).digest("hex");
const absolute = z.string().min(1).refine(value => path.isAbsolute(value) && path.resolve(value) === value
  && !/[\x00-\x1f\x7f]/.test(value));
const pinSchema = z.object({ path: absolute, bytes: z.number().int().positive().safe().max(10_000_000),
  sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
export const rawHistoryAppendPlanSchema = z.object({ schemaVersion: z.literal(1),
  format: z.literal("hosted-reader-raw-v1"), existingHistory: pinSchema,
  inputAdmission: pinSchema, captureAdmission: pinSchema }).strict();
export type RawHistoryAppendPlan = z.infer<typeof rawHistoryAppendPlanSchema>;
function localUid(): number {
  assert(process.getuid, "A real local owner identity is required"); return process.getuid();
}
const shape = (s: Stats) => [s.dev, s.ino, s.uid, s.mode, s.nlink, s.size, s.mtimeMs, s.ctimeMs];
/** Base calibration is public source data; admission/plan files must be private.
 * Every file is canonical, singly linked and read through its original nofollow FD. */
function pinnedFile(input: OriginalPin, privateInput: boolean): Buffer {
  const pin = pinSchema.parse(input), before = lstatSync(pin.path);
  assert(realpathSync(pin.path) === pin.path && before.isFile() && !before.isSymbolicLink()
    && before.uid === localUid() && before.nlink === 1 && (before.mode & 0o022) === 0
    && (!privateInput || (before.mode & 0o777) === 0o600), "Canonical owned input custody differs");
  const fd = openSync(pin.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    assert.deepEqual(shape(fstatSync(fd)), shape(before), "Opened input FD differs");
    const bytes = Buffer.alloc(pin.bytes + 1); let count = 0;
    while (count < bytes.length) { const n = readSync(fd, bytes, count, bytes.length - count, count); if (!n) break; count += n; }
    const raw = bytes.subarray(0, count);
    assert(raw.length === pin.bytes && sha(raw) === pin.sha256, "Original pinned bytes differ");
    assert.deepEqual(shape(fstatSync(fd)), shape(before), "Input FD changed during read");
    assert.deepEqual(shape(lstatSync(pin.path)), shape(before), "Input named identity changed during read");
    return raw;
  } finally { closeSync(fd); }
}
function directory(file: string, privateRoot: boolean): DirectoryIdentity {
  absolute.parse(file); assert(realpathSync(file) === file, "Canonical directory required");
  const s = lstatSync(file);
  assert(s.isDirectory() && !s.isSymbolicLink() && s.uid === localUid()
    && (!privateRoot || (s.mode & 0o777) === 0o700), "Owned private directory required");
  return { path: file, dev: s.dev, ino: s.ino, uid: s.uid, mode: s.mode };
}
/** Genuine Node Stats observation only. Caller supplies independently reviewed
 * original byte pins. Observation cannot grant its own historical admission.
 * Do not serialize Python timestamps into this Node-visible identity contract. */
export function observeCurrentRawInput(root: string, runAttempt: number, originalPins: readonly OriginalPin[]): CurrentInputAdmission {
  assert(Number.isSafeInteger(runAttempt) && runAttempt > 0 && originalPins.length === 12, "Exact original input count/attempt required");
  const d = directory(root, true), p = directory(path.dirname(root), false);
  const names = readdirSync(root).sort(); assert(names.length > 0 && names.length <= 4096, "Observed namespace bound");
  const namespace: EntryIdentity[] = names.map(name => {
    assert(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name), "Direct safe namespace names required");
    const s = lstatSync(path.join(root, name));
    assert(s.isFile() && !s.isSymbolicLink() && s.uid === localUid() && s.dev === d.dev
      && (s.mode & 0o777) === 0o600 && s.nlink === 1, "Owned regular600 namespace required");
    return { name, dev: s.dev, ino: s.ino, uid: s.uid, mode: s.mode, nlink: s.nlink,
      size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs };
  });
  const [captureReceipt, run, jobs, artifacts, testedCommit, ...zipPins] = originalPins.map(pin => pinSchema.parse(pin));
  const observed: CurrentInputAdmission = { schemaVersion: 1, format: "hosted-reader-raw-v1", runAttempt,
    directory: d, parent: p, namespace, captureReceipt, metadata: { run, jobs, artifacts, testedCommit }, zipPins };
  readOwnedCurrentCapture(observed); // Bounded original-byte custody, never semantic approval.
  assert.deepEqual(directory(root, true), d); assert.deepEqual(directory(path.dirname(root), false), p);
  return observed;
}
/** A third source may only add conservative evidence. No eviction, replacement,
 * weight normalization or source-row rewriting is supported. */
export function appendHistoricalSource(originalRaw: string, input: MultiRunDurationSource): MultiRunDurationHistory {
  const original = parseMultiRunBrowserDurationProfile(originalRaw).value;
  assert(original.sources.length === 2, "Append requires exactly two preserved sources; maximum remains three");
  const source = multiRunDurationSourceSchema.parse(input);
  const result: MultiRunDurationHistory = { schemaVersion: 2, estimator: original.estimator,
    sources: [...original.sources, source] };
  validateMultiRunDurationHistory(result);
  assert.deepEqual(result.sources.slice(0, 2), original.sources, "Prior source rows must remain whole-exact");
  return result;
}
/** Only fresh proposal files are written. Call after separately admitted genuine
 * Node-visible IO/bridge positives and current source/plan qualification. */
export function writeRawHistoryAppend(planPin: OriginalPin, outputDirectory: string, sourceDirectory: string): void {
  const planRaw = pinnedFile(planPin, true), plan = rawHistoryAppendPlanSchema.parse(JSON.parse(planRaw.toString("utf8")));
  const original = pinnedFile(plan.existingHistory, false);
  const ioRaw = pinnedFile(plan.inputAdmission, true), captureRaw = pinnedFile(plan.captureAdmission, true);
  // Closed admission validation belongs to the unchanged IO/semantic modules.
  const io = JSON.parse(ioRaw.toString("utf8")) as CurrentInputAdmission;
  const admission = JSON.parse(captureRaw.toString("utf8")) as CurrentCaptureAdmission;
  const source = admittedCurrentHistoricalSource(io, admission);
  const value = appendHistoricalSource(original.toString("utf8"), source), raw = JSON.stringify(value, null, 2) + "\n";
  const recheck = () => {
    assert(pinnedFile(planPin, true).equals(planRaw));
    assert(pinnedFile(plan.existingHistory, false).equals(original));
    assert(pinnedFile(plan.inputAdmission, true).equals(ioRaw));
    assert(pinnedFile(plan.captureAdmission, true).equals(captureRaw));
    readOwnedCurrentCapture(io);
  };
  recheck();
  const output = reserveOfflineOutput(outputDirectory, [sourceDirectory, io.directory.path,
    planPin.path, plan.existingHistory.path, plan.inputAdmission.path, plan.captureAdmission.path]);
  recheck(); writeReservedOfflineHistoryFile(output, "browser-duration-profile-v2.proposal.json", raw);
  const audit = { schemaVersion: 1, status: "offline-raw-append-proposal-only", existingHistory: plan.existingHistory,
    inputAdmission: plan.inputAdmission, captureAdmission: plan.captureAdmission,
    profileSha256: sha(raw), sources: value.sources, newSourceOriginalReceiptSha256: source.metadata.captureReceiptSha256,
    priorSourcesPreserved: true, noSourceEviction: true, noBaselineAcceptance: true,
    noCurrentDiscoveryOrExecutionProof: true, noCurrentProfileOverwrite: true };
  recheck(); writeReservedOfflineHistoryFile(output, "history-source-audit.json", JSON.stringify(audit, null, 2) + "\n");
  recheck();
}
