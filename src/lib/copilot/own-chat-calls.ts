import "server-only";
import { z } from "zod";
import { ownChatCallSchema, ownChatProjectionSchema, type OwnChatCall, type OwnChatProjection } from "./own-chat-content";
import type { OwnCopilotAuthority } from "./own-provider-authority";
import { readOwnPreparedCopilotCalls, PreparedCopilotReadError } from "./own-prepared-calls";

export class OwnChatCallsError extends Error {
  constructor(readonly code: "invalid_request" | "unavailable" | "too_large" | "aborted") {
    super(code); this.name = "OwnChatCallsError";
  }
}
type Result = { state: "available"; calls: OwnChatCall[] } | { state: "source_unavailable" };

/** Resolve the entire selected source union before returning raw calls.
 * The database selector is restricted to database/legacy sources; an object
 * source never falls back to its historical rows. One 30s scope and one
 * 10000-record/2MB budget cover all sources, including discarded duplicates.
 * Failure returns no partial calls. Even source_unavailable requires a final
 * current whole-projection check; a changed projection rejects the operation. */
export async function readOwnChatCalls(rawRsids: readonly number[], options: {
  authority: OwnCopilotAuthority; projection: OwnChatProjection;
  readDatabasePage: (offset: number, signal: AbortSignal) => Promise<unknown>;
  check: (signal: AbortSignal) => Promise<void>; signal?: AbortSignal;
}): Promise<Result> {
  const deadline = new AbortController(), signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  const timer = setTimeout(() => deadline.abort(), 30_000); timer.unref();
  const active = () => { if (signal.aborted) throw new OwnChatCallsError("aborted"); };
  async function wait<T>(pending: Promise<T>): Promise<T> {
    if (signal.aborted) { void pending.catch(() => {}); active(); }
    let abort = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new OwnChatCallsError("aborted")); signal.addEventListener("abort", abort, { once: true });
    });
    try { const value = await Promise.race([pending, cancelled]); active(); return value; }
    finally { signal.removeEventListener("abort", abort); }
  }
  try {
    active();
    const parsed = z.array(z.number().int().positive().safe()).min(1).max(50).safeParse(rawRsids);
    if (!parsed.success || new Set(parsed.data).size !== parsed.data.length) throw new OwnChatCallsError("invalid_request");
    const rsids = parsed.data, requested = new Set(rsids), projection = ownChatProjectionSchema.parse(options.projection);
    const actor = { accountId: options.authority.accountId, sessionId: options.authority.sessionId }, subjectId = options.authority.subjectId;
    const checkOperation = async () => { active(); await wait(options.check(signal)); active(); };
    const unavailable = async (): Promise<Result> => { await checkOperation(); return { state: "source_unavailable" }; };
    let evidenceCount = 0, evidenceBytes = 0, budgetExceeded = false;
    const consumeEvidence = (count: number, bytes: number) => {
      active(); evidenceCount += count; evidenceBytes += bytes;
      if (evidenceCount > 10000 || evidenceBytes > 2_000_000) { budgetExceeded = true; throw new OwnChatCallsError("too_large"); }
    };
    await checkOperation();
    if (projection.unavailableSources.length) return await unavailable();
    const databaseIds = new Set([...projection.sources.filter(s => !s.preparedSource), ...projection.legacySources].map(s => s.id));
    const calls: OwnChatCall[] = [];
    if (databaseIds.size) {
      for (let offset = 0; ; ) {
        await checkOperation();
        const page = z.array(ownChatCallSchema).max(1000).parse(await wait(options.readDatabasePage(offset, signal)));
        if (page.some(r => !databaseIds.has(r.file_id) || !requested.has(r.rsid))) throw new OwnChatCallsError("unavailable");
        consumeEvidence(page.length, Buffer.byteLength(JSON.stringify(page)));
        if (!page.length) break;
        calls.push(...page); offset += page.length;
      }
    }
    for (const source of projection.sources) {
      if (!source.preparedSource) continue;
      await checkOperation();
      try {
        const rows = z.array(ownChatCallSchema).max(10000).parse(await wait(readOwnPreparedCopilotCalls(actor, {
          fileId: source.id, subjectId, sourceRevision: source.revision, sourceSha256: source.sha256,
          decodedSha256: source.decodedSha256, normalizedAt: source.normalizedAt, preparedSource: source.preparedSource,
        }, rsids, { signal, checkOperation, consumeEvidence })));
        if (rows.some(r => r.file_id !== source.id || !requested.has(r.rsid))) throw new OwnChatCallsError("unavailable");
        calls.push(...rows);
      } catch (error) {
        if (budgetExceeded) throw new OwnChatCallsError("too_large");
        if (error instanceof PreparedCopilotReadError && error.code === "source_unavailable") return await unavailable();
        throw error;
      }
    }
    if (calls.length > 10000 || Buffer.byteLength(JSON.stringify(calls)) > 2_000_000) throw new OwnChatCallsError("too_large");
    await checkOperation(); return { state: "available", calls };
  } catch (error) {
    if (signal.aborted) throw new OwnChatCallsError("aborted");
    if (error instanceof OwnChatCallsError) throw error;
    throw new OwnChatCallsError("unavailable");
  } finally { clearTimeout(timer); deadline.abort(); }
}
