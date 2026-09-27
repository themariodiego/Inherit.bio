import "server-only";
import { isDeepStrictEqual as equal } from "node:util";
import { z } from "zod";
import { currentOwnUploadAccount } from "@/lib/uploads/own-upload-context";
import { OWN_REPORT_PURPOSES, type OwnReportPurpose } from "@/lib/uploads/own-report-purpose";
import type { Db } from "./load";
import type { ReportCall } from "./report-calls";
import { assertPreparedMetadataBounds } from "./prepared-source/canonical-manifest";
import { preparedReportSourceSchema } from "./prepared-source/report-call-pages";
import { readOwnPreparedRsidCalls } from "./prepared-source/selected-rsid-calls";

const uuid = z.uuid().regex(/^[0-9a-f-]+$/), hash = z.string().regex(/^[0-9a-f]{64}$/);
const actorSchema = z.object({ accountId: uuid, sessionId: uuid }).strict();
const selection = z.object({ fileId: uuid, subjectId: uuid, sourceRevision: z.number().int().positive().safe(),
  sourceSha256: hash, decodedSha256: hash, normalizedAt: z.iso.datetime({ offset: true }) }).strict();
const sourceSchema = z.discriminatedUnion("backend", [
  z.object({ backend: z.literal("database-v1"), selection, receipt: hash }).strict(),
  z.object({ backend: z.literal("prepared-object-v1"),
    selection: selection.extend({ preparedSource: preparedReportSourceSchema }).strict(), receipt: hash }).strict(),
]);
export class OwnReportReadError extends Error {
  constructor(readonly code: "invalid_request" | "unavailable" | "too_large" | "aborted") {
    super(code); this.name = "OwnReportReadError";
  }
}
export interface OwnReportReadScope {
  signal: AbortSignal;
  wait<T>(pending: PromiseLike<T>): Promise<T>;
  consumeEvidence(count: number, serializedBytes: number): void;
  close(): void;
}

/** One finite deadline and evidence budget across every prepared file/chunk.
 * Charge original evidence, including duplicates, before resolving report calls.
 * A depleted or closed scope cannot be reused for later files. */
export function createOwnReportReadScope(): OwnReportReadScope {
  const controller = new AbortController(), signal = controller.signal;
  let count = 0, bytes = 0, failure: OwnReportReadError | undefined;
  const timer = setTimeout(() => controller.abort(), 30_000); timer.unref();
  const active = () => { if (failure) throw failure; if (signal.aborted) throw new OwnReportReadError("aborted"); };
  return {
    signal,
    async wait<T>(pending: PromiseLike<T>): Promise<T> {
      const promise = Promise.resolve(pending);
      if (signal.aborted) { void promise.catch(() => {}); active(); }
      let abort = () => {};
      const cancelled = new Promise<never>((_, reject) => {
        abort = () => reject(failure ?? new OwnReportReadError("aborted")); signal.addEventListener("abort", abort, { once: true });
      });
      try { const value = await Promise.race([promise, cancelled]); active(); return value; }
      finally { signal.removeEventListener("abort", abort); }
    },
    consumeEvidence(records, serializedBytes) {
      active();
      if (!Number.isSafeInteger(records) || records < 0 || !Number.isSafeInteger(serializedBytes) || serializedBytes < 0) {
        failure = new OwnReportReadError("invalid_request"); controller.abort(); throw failure;
      }
      count += records; bytes += serializedBytes;
      if (count > 10000 || bytes > 2_000_000) { failure = new OwnReportReadError("too_large"); controller.abort(); throw failure; }
    },
    close() { clearTimeout(timer); controller.abort(); },
  };
}

type OwnReportCallSource = { backend: "database-v1"; confirm(): Promise<void> }
  | { backend: "prepared-object-v1"; read(rsids: readonly number[]): Promise<ReportCall[]>; confirm(): Promise<void> };

/** Select the exact source of a completed report under its current report grant.
 * The service RPC pins result/run/grant/source/member identity. Store authority
 * alone cannot authorize this read. Any malformed response or later change
 * refuses the file; a prepared source never falls back to database rows.
 * The caller must retain confirm() until its final whole-result authority fence. */
export async function loadOwnReportCallSource(db: Db, fileId: string, purpose: OwnReportPurpose,
  scope: OwnReportReadScope, expectedSubjectId: string): Promise<OwnReportCallSource> {
  uuid.parse(fileId); uuid.parse(expectedSubjectId); z.enum(OWN_REPORT_PURPOSES).parse(purpose);
  const actor = actorSchema.parse(await scope.wait(currentOwnUploadAccount()));
  const checkActor = async () => {
    if (!equal(actor, await scope.wait(currentOwnUploadAccount()))) throw new OwnReportReadError("unavailable");
  };
  const resolve = async (expected: string | null) => {
    await checkActor();
    const { data, error } = await scope.wait(db.rpc("own_report_call_source_v1", {
      p_account_id: actor.accountId, p_session_id: actor.sessionId, p_file_id: fileId,
      p_purpose: purpose, p_expected: expected,
    }).abortSignal(scope.signal));
    if (error) throw new OwnReportReadError("unavailable");
    assertPreparedMetadataBounds(data, 4096);
    const parsed = sourceSchema.safeParse(data);
    if (!parsed.success || parsed.data.selection.fileId !== fileId || parsed.data.selection.subjectId !== expectedSubjectId) {
      throw new OwnReportReadError("unavailable");
    }
    await checkActor(); return parsed.data;
  };
  const captured = await resolve(null);
  const confirm = async () => {
    if (!equal(captured, await resolve(captured.receipt))) throw new OwnReportReadError("unavailable");
  };
  if (captured.backend === "database-v1") return { backend: captured.backend, confirm };
  return {
    backend: captured.backend, confirm,
    async read(rawRsids) {
      const rsids = z.array(z.number().int().positive().safe()).parse(rawRsids);
      if (new Set(rsids).size !== rsids.length) throw new OwnReportReadError("invalid_request");
      const calls: ReportCall[] = [];
      await confirm();
      for (let offset = 0; offset < rsids.length; offset += 50) {
        const chunk = rsids.slice(offset, offset + 50);
        calls.push(...await scope.wait(readOwnPreparedRsidCalls(actor, captured.selection, chunk, {
          signal: scope.signal, checkOperation: confirm, consumeEvidence: scope.consumeEvidence,
        })));
      }
      await confirm(); return calls;
    },
  };
}
