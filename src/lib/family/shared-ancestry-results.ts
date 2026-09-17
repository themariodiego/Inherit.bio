import "server-only";
import { z } from "zod";
import type { Db } from "../genome/load";
import type { InputSourceView } from "../genome/input-sources";
import { ownAncestryCapturedContentSchema } from "../uploads/own-ancestry-captured-content";
import { capturedAncestryRows, type AncestryResultRow } from "../ancestry/captured-rows";
import { currentOwnUploadAccount } from "../uploads/own-upload-context";
import { familyCapability } from "./access";

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const count = z.number().int().nonnegative().safe();
const snapshot = z.object({ sourceBuild: z.enum(["GRCh37", "GRCh38"]), buildBasis: z.enum(["source-declared", "format-assumption"]),
  targetBuild: z.literal("GRCh38"), variantRowsMapped: count, variantRowsUnmapped: count,
  counts: z.object({ called: count, noCall: count, unsupported: count, failedFilter: count, blocks: count,
    singleSample: z.boolean(), buildClaim: z.boolean() }).strict().refine(v => Number.isSafeInteger(v.called + v.noCall)),
}).strict();
const source = z.object({ fileId: z.uuid(), fileType: z.string(), processedAt: z.iso.datetime({ offset: true }).nullable(),
  snapshot: z.unknown().transform(raw => { const parsed = snapshot.safeParse(raw); return parsed.success ? parsed.data : null; }),
}).strict();
const legacyRow = z.object({ kind: z.enum(["admixture", "mtdna", "ydna"]), result: z.unknown(), support_note: z.string().nullable(),
  file_id: z.uuid(), model_id: z.string().nullable(), model_version: z.string().nullable(), created_at: z.iso.datetime({ offset: true }),
}).strict();
const entry = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("canonical"), fileId: z.uuid(), completedAt: z.iso.datetime({ offset: true }),
    content: ownAncestryCapturedContentSchema, source }).strict(),
  z.object({ kind: z.literal("legacy"), fileId: z.uuid(), rows: z.array(legacyRow).min(1), source }).strict(),
]);
const pageSchema = z.object({ authority: hash, ownerAccountId: z.uuid(), subjectId: z.uuid(), legacyOnly: z.boolean(),
  sources: z.array(entry).max(100), fileCount: count.max(100), preparing: z.boolean(), preparedUnavailable: z.boolean(),
  nextAfter: z.uuid().nullable(), pageReceipt: hash,
}).strict();
const presentationSchema = z.object({ receipt: hash, requiresConfirmation: z.boolean() }).strict();
type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
export interface SharedAncestryOptions {
  subjectId: string; counterpartAccountId: string;
  /** Pause before the one retry of a capture whose locked confirmation came back unconfirmed. */
  retryDelayMs?: number;
}
/** D-125: one bounded retry, so a contested lock costs a round trip rather than a not-found page. */
export const CONTESTED_CONFIRMATION_RETRY_DELAY_MS = 250;
export interface SharedAncestryState {
  authorized: boolean; rows: AncestryResultRow[]; sources: InputSourceView[];
  fileCount: number; preparing: boolean; preparedUnavailable: boolean; confirmationRequired: boolean;
}
const denied = (): SharedAncestryState => ({ authorized: false, rows: [], sources: [], fileCount: 0,
  preparing: false, preparedUnavailable: false, confirmationRequired: false });

export async function prepareSharedAncestryGrant(db: Db, subjectId: string, recipientAccountId: string) {
  try {
    const actor = await currentOwnUploadAccount();
    if (!actor || (await familyCapability(actor.accountId, [recipientAccountId], "third_party_adult_analysis")).status !== "permitted") return null;
    const response = await (db.rpc.bind(db) as unknown as Rpc)("family_ancestry_grant_presentation_v1", {
      p_account_id: actor.accountId, p_session_id: actor.sessionId, p_subject_id: subjectId, p_recipient_account_id: recipientAccountId,
    });
    const parsed = presentationSchema.safeParse(response.data);
    return !response.error && parsed.success ? parsed.data : null;
  } catch { return null; }
}

/** A separate Family capability; never invokes an owning-account reader or falls back after denial. */
export async function loadSharedAncestrySnapshot(db: Db, options: SharedAncestryOptions, mode: "content" | "permission" = "content") {
  try {
    const actor = await currentOwnUploadAccount();
    if (!actor || !z.uuid().safeParse(options.subjectId).success || !z.uuid().safeParse(options.counterpartAccountId).success
      || actor.accountId === options.counterpartAccountId) throw new Error("unavailable");
    const scope = async () => {
      const now = await currentOwnUploadAccount();
      return now?.accountId === actor.accountId && now.sessionId === actor.sessionId
        && (await familyCapability(actor.accountId, [options.counterpartAccountId], "third_party_adult_analysis")).status === "permitted";
    };
    const rpc = db.rpc.bind(db) as unknown as Rpc;
    /** Every page of the current capture, validated; throws on any mismatch. */
    const capture = async () => {
      if (!await scope()) throw new Error("unavailable");
      const state = { ...denied(), authorized: true };
      const expected: { afterFile: string | null; receipt: string }[] = [];
      const seen = new Set<string>();
      let after: string | null = null, authority: string | null = null;
      do {
        if (expected.length >= 1000) throw new Error("unavailable");
        const response = await rpc("family_shared_ancestry_results_v1", { p_account_id: actor.accountId,
          p_session_id: actor.sessionId, p_subject_id: options.subjectId, p_after_file: after, p_mode: mode });
        const parsed = pageSchema.safeParse(response.data);
        if (response.error || !parsed.success) throw new Error("unavailable");
        const page = parsed.data;
        if (page.subjectId !== options.subjectId || page.ownerAccountId !== options.counterpartAccountId
          || (authority !== null && page.authority !== authority) || page.sources.length > page.fileCount
          || (page.nextAfter !== null && after !== null && page.nextAfter <= after)
          || (mode === "permission" && (page.sources.length || page.fileCount || page.preparing || page.preparedUnavailable || page.nextAfter))) throw new Error("unavailable");
        for (const item of page.sources) {
          if (seen.has(item.fileId) || item.source.fileId !== item.fileId || (after !== null && item.fileId <= after)
            || (page.nextAfter !== null && item.fileId > page.nextAfter)) throw new Error("unavailable");
          seen.add(item.fileId);
          if (item.kind === "canonical") {
            if (page.legacyOnly || item.content.source.fileId !== item.fileId || item.content.source.subjectId !== options.subjectId) throw new Error("unavailable");
            state.rows.push(...capturedAncestryRows(item.content, item.completedAt));
          } else {
            if (item.rows.some(row => row.file_id !== item.fileId)) throw new Error("unavailable");
            state.rows.push(...item.rows);
          }
          state.sources.push(item.source);
        }
        state.fileCount += page.fileCount; state.preparing ||= page.preparing;
        state.preparedUnavailable ||= page.preparedUnavailable; state.confirmationRequired ||= page.legacyOnly;
        authority = page.authority; expected.push({ afterFile: after, receipt: page.pageReceipt }); after = page.nextAfter;
      } while (after !== null);
      state.rows.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || a.file_id.localeCompare(b.file_id));
      return { state, expected };
    };
    /** One locked check covers every page, including empty results. */
    const confirmed = async (expected: { afterFile: string | null; receipt: string }[]) => {
      const response = await rpc("confirm_family_shared_ancestry_results_v1", { p_account_id: actor.accountId,
        p_session_id: actor.sessionId, p_subject_id: options.subjectId, p_mode: mode, p_expected: expected });
      return !response.error && response.data === true;
    };
    let current = await capture();
    let closed = false;
    return { ...current.state, confirm: async (): Promise<SharedAncestryState> => {
      if (closed) return denied();
      try {
        if (await scope()) {
          // Final awaited operation for this capture.
          if (await confirmed(current.expected)) return current.state;
          // D-125: an unconfirmed locked check can be a contested row lock or
          // a change that landed mid-request, and the page cannot tell which.
          // One fresh capture and one fresh locked check decide it again; a
          // genuine loss of authority denies here too. A scope failure above is
          // definitive and is never retried.
          await new Promise<void>(resolve => setTimeout(resolve, options.retryDelayMs ?? CONTESTED_CONFIRMATION_RETRY_DELAY_MS));
          const again = await capture();
          if (await confirmed(again.expected)) { current = again; return again.state; }
        }
      } catch { /* Current authority or the exact saved source changed. */ }
      closed = true; return denied();
    } };
  } catch { return { ...denied(), confirm: async () => denied() }; }
}
