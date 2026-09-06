import { UPLOADS_PAUSED_MESSAGE } from "@/copy/upload/pause";

/** A tab loaded before the pause must use the live issuance response. */
export async function uploadIssuanceError(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  return response.status === 503 && body !== null && typeof body === "object"
    && "error" in body && body.error === "uploads_paused"
    ? UPLOADS_PAUSED_MESSAGE : "Could not authorize this upload.";
}
