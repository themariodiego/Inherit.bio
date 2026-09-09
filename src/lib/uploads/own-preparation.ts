import "server-only";
import { z } from "zod";
import { createAdminClient } from "../supabase/admin";
import { currentOwnUploadAccount, ownUploadJson } from "./own-upload-context";
import { hasEmptyRequestBody } from "../empty-request-body";
import { subjectNormalizationReceipt, subjectQueuedPreparationReceipt } from "./subject-upload-contract";
const uuid = z.uuid().regex(/^[0-9a-f-]+$/);
const statusSchema = z.object({ version: z.literal("own-preparation-status-v1"), fileId: uuid, jobId: uuid.nullable(),
  status: z.enum(["not_applicable", "not_requested", "preparing", "prepared", "failed"]) }).strict().refine(value =>
  ["not_applicable", "not_requested"].includes(value.status) ? value.jobId === null : value.jobId !== null);
const enqueueSchema = z.object({ version: z.literal("own-preparation-job-v1"), jobId: uuid, fileId: uuid,
  state: z.enum(["queued", "claimed"]), jobDeadline: z.iso.datetime({ offset: true }) }).strict();
/** Quick metadata-only dispatch. SQL and server flags BOTH have to allow this
 * backend. No source bytes, worker secret, provider URL or analysis runs here. */
export async function prepareOwnWgsFile(request: Request, file: { id: string; file_type: string; single_logical_sample_verified_at: unknown }) {
  if (process.env.INHERIT_PREPARED_WGS_ENABLED !== "true" || !["vcf", "gvcf"].includes(file.file_type)
    || file.single_logical_sample_verified_at == null) return null;
  if (!uuid.safeParse(file.id).success || new URL(request.url).search || request.headers.get("origin") !== new URL(request.url).origin
    || request.headers.get("sec-fetch-site") !== "same-origin" || !(await hasEmptyRequestBody(request))) {
    return ownUploadJson({ error: "invalid_request" }, 400);
  }
  try {
    const actor = await currentOwnUploadAccount(); if (!actor) return ownUploadJson({ error: "unauthorized" }, 401);
    const admin = createAdminClient();
    // Kept local until generated database typings include these additive RPCs.
    const rpc = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;
    const args = { p_account_id: actor.accountId, p_session_id: actor.sessionId, p_file_id: file.id };
    const current = await rpc("own_preparation_status_v1", args);
    if (current.error) return ownUploadJson({ error: current.error.code === "42501" ? "not_found" : "preparation_unavailable" }, current.error.code === "42501" ? 404 : 503);
    const parsed = statusSchema.safeParse(current.data);
    if (!parsed.success || parsed.data.fileId !== file.id) return ownUploadJson({ error: "preparation_unavailable" }, 503);
    const status = parsed.data;
    if (status.status === "not_applicable") return null;
    if (status.status === "failed") return ownUploadJson({ error: "preparation_unavailable" }, 503);
    if (status.status === "prepared") return ownUploadJson(subjectNormalizationReceipt.parse({ fileId: file.id,
      status: "normalization_complete", analysisState: "not_generated" }));
    let jobId = status.jobId;
    if (status.status === "not_requested") {
      if (jobId !== null) return ownUploadJson({ error: "preparation_unavailable" }, 503);
      const result = await rpc("enqueue_own_preparation_v1", args);
      if (result.error) return ownUploadJson({ error: result.error.code === "42501" ? "not_found" : "preparation_unavailable" }, result.error.code === "42501" ? 404 : 503);
      const queued = enqueueSchema.safeParse(result.data);
      if (!queued.success || queued.data.fileId !== file.id || Date.parse(queued.data.jobDeadline) <= Date.now()) {
        return ownUploadJson({ error: "preparation_unavailable" }, 503);
      }
      jobId = queued.data.jobId;
    }
    if (!jobId) return ownUploadJson({ error: "preparation_unavailable" }, 503);
    return ownUploadJson(subjectQueuedPreparationReceipt.parse({ fileId: file.id, jobId, status: "preparing", analysisState: "not_generated" }), 202);
  } catch { return ownUploadJson({ error: "preparation_unavailable" }, 503); }
}
