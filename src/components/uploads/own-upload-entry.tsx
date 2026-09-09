import { prepareOwnUpload } from "@/lib/uploads/prepare-own-upload";
import { readOwnUploadLimits } from "@/lib/uploads/own-upload-limits";
import { canonicalUploadsPaused } from "@/lib/uploads/canonical-upload-pause";
import { OWN_UPLOAD_COPY } from "@/copy/upload/consent";
import { OwnUploadFlow } from "./own-upload-flow";

export async function OwnUploadEntry() {
  // A preparation outage must not take the existing file controls down with it,
  // and an unreadable ceiling must not take the upload down: the page then
  // states no limit rather than a guessed one, and the server still refuses.
  const [view, limits] = await Promise.all([
    prepareOwnUpload().catch(() => ({ kind: "unavailable" as const })),
    readOwnUploadLimits(),
  ]);
  if (canonicalUploadsPaused() && view.kind !== "unavailable" && view.kind !== "underage") {
    return <p role="status">{OWN_UPLOAD_COPY.uploadsPaused}</p>;
  }
  return <OwnUploadFlow key={"token" in view ? view.token : view.kind} view={view} limits={limits} />;
}
