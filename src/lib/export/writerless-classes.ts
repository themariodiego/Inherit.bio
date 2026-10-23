import "server-only";
import { z } from "zod";

/**
 * The synchronous archive's pinned refusal for the five classes no production
 * writer fills (owner decision, 23 Oct 2026, "Export completeness",
 * docs/protocol/decisions.md): ancestry regions, attestation contradictions,
 * subject-control refusal authorities, suppressions and report artifacts.
 * The archive has no member for them, so it is complete only while none of
 * them holds a row in the requester's scope. `public.own_export_writerless_rows_v1`
 * counts them in the database under the same account and session gate as the
 * rest of the export.
 *
 * True only when the count answers and is zero. Any row, any error and any
 * answer of another shape is false, and the export answers 503 rather than
 * shipping an archive that leaves a row out without saying so.
 */
const reply = z.object({
  version: z.literal("export-writerless-classes-v1"),
  rows: z.number().int().nonnegative().safe(),
}).strict();

type Actor = { accountId: string; sessionId: string };
type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;

export async function writerlessClassesEmpty(rpc: Rpc, actor: Actor): Promise<boolean> {
  try {
    const { data, error } = await rpc("own_export_writerless_rows_v1",
      { p_account_id: actor.accountId, p_session_id: actor.sessionId });
    if (error) return false;
    const parsed = reply.safeParse(data);
    return parsed.success && parsed.data.rows === 0;
  } catch {
    return false;
  }
}
