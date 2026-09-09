import "server-only";
import { z } from "zod";
import { hasEmptyRequestBody } from "../empty-request-body";
import { currentOwnUploadAccount, ownUploadJson } from "./own-upload-context";
import { ownReportReadyEnvelope } from "./own-report-ready-envelope";
import { generateOwnReportResults } from "./own-report-execution";

const uuid = z.uuid().regex(/^[0-9a-f-]+$/);

/** HTTP authenticates the actor; execution independently rechecks the canonical
 * source/session/purpose authority before reading or committing any result. */
export async function generateOwnReports(request: Request, fileId: string) {
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") !== "same-origin") {
    return ownUploadJson({ error: "forbidden" }, 403);
  }
  if (new URL(request.url).search || !uuid.safeParse(fileId).success || !(await hasEmptyRequestBody(request))) {
    return ownUploadJson({ error: "invalid_request" }, 422);
  }
  let actor: Awaited<ReturnType<typeof currentOwnUploadAccount>>;
  try { actor = await currentOwnUploadAccount(); } catch { return ownUploadJson({ error: "unavailable" }, 503); }
  if (!actor) return ownUploadJson({ error: "unauthorized" }, 401);
  return generateOwnReportResults({ actor, fileId, signal: request.signal,
    readyMailEnvelope: () => ownReportReadyEnvelope(actor.accountId) });
}
