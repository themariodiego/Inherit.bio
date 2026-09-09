import { NextResponse } from "next/server";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { assertPreparedMetadataBounds } from "@/lib/genome/prepared-source/canonical-manifest";
import { preparedOriginalDownloadSourceSchema, streamPreparedOriginalDownload } from "@/lib/uploads/prepared-original-download";

export const maxDuration = 300;
const stateSchema = z.object({ version: z.literal("own-original-download-state-v1"), fileId: z.uuid(),
  prepared: z.boolean(), retired: z.boolean(), expiresAt: z.iso.datetime({ offset: true }).nullable() }).strict();
const sourceReceipt = z.object({ source: preparedOriginalDownloadSourceSchema, originalName: z.string().min(1).max(1024) }).strict();
type Rpc = (name: string, args: Record<string, unknown>) => { abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }> };
const failure = (message: string, status: number) => new Response(message, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return failure("Unauthorized", 401);
  const { data: file } = await supabase.from("genome_files").select("bucket_path, original_name").eq("id", id).maybeSingle();
  if (!file) return failure("Not found", 404);
  const admin = createAdminClient(), rpc = admin.rpc.bind(admin) as unknown as Rpc;
  try {
    const initialSignal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
    const result = await rpc("own_original_download_state_v1", { p_account_id: user.id, p_file_id: id }).abortSignal(initialSignal);
    initialSignal.throwIfAborted();
    if (result.error) throw new Error("original_unavailable");
    assertPreparedMetadataBounds(result.data, 4096); const state = stateSchema.parse(result.data);
    if (state.fileId !== id) throw new Error("original_unavailable");
    if (state.retired) return failure("The original file is no longer available.", 410);
    if (!state.prepared) {
      // Ordinary legacy ownership/signing behavior remains unchanged.
      const { data, error } = await admin.storage.from("genomes").createSignedUrl(file.bucket_path, 300, { download: file.original_name });
      if (error || !data) return failure("Could not sign URL", 500);
      return NextResponse.redirect(data.signedUrl);
    }
    const actor = await getSensitiveAccountContext();
    if (!actor || actor.user.id !== user.id) return failure("Unauthorized", 401);
    const args = { p_account_id: actor.user.id, p_session_id: actor.sessionId, p_file_id: id };
    async function authorize(expected: unknown, signal: AbortSignal) {
      const response = await rpc("authorize_own_prepared_original_v1", { ...args, p_expected: expected }).abortSignal(signal);
      signal.throwIfAborted(); if (response.error) throw new Error("original_unavailable");
      assertPreparedMetadataBounds(response.data, 4096); const receipt = sourceReceipt.parse(response.data);
      if (receipt.source.fileId !== id || (expected !== null && !isDeepStrictEqual(receipt.source, expected))) throw new Error("original_unavailable");
      return receipt;
    }
    // Resolve current full source authority before sending HTTP headers.
    const authorized = await authorize(null, initialSignal);
    const controller = new AbortController(), signal = AbortSignal.any([request.signal, controller.signal]);
    const iterator = streamPreparedOriginalDownload({ source: authorized.source, signal,
      check: async (source, currentSignal) => { await authorize(source, currentSignal); } });
    const body = new ReadableStream<Uint8Array>({
      async pull(output) {
        try { const part = await iterator.next(); if (part.done) output.close(); else output.enqueue(part.value); }
        catch { controller.abort(); output.error(new Error("Original download did not complete.")); }
      },
      async cancel() { controller.abort(); try { await iterator.return(undefined); } catch { /* no provider details */ } },
    }, { highWaterMark: 0 });
    const name = encodeURIComponent(authorized.originalName).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    return new Response(body, { headers: { "Cache-Control": "private, no-store", "Content-Type": "application/octet-stream",
      "Content-Length": String(authorized.source.sizeBytes), "Content-Disposition": `attachment; filename*=UTF-8''${name}`,
      "X-Content-Type-Options": "nosniff" } });
  } catch { return failure("Original download is unavailable. Please try again.", 503); }
}
