import { prepareOwnUpload } from "@/lib/uploads/prepare-own-upload";
import { canonicalUploadsPaused } from "@/lib/uploads/canonical-upload-pause";
import { OWN_UPLOAD_COPY } from "@/copy/upload/consent";
import { OwnUploadFlow } from "./own-upload-flow";

export async function OwnUploadEntry() {
  // A preparation outage must not take the existing file controls down with it.
  const view = await prepareOwnUpload().catch(() => ({ kind: "unavailable" as const }));
  if (canonicalUploadsPaused() && view.kind !== "unavailable" && view.kind !== "underage") {
    return <p role="status">{OWN_UPLOAD_COPY.uploadsPaused}</p>;
  }
  return <OwnUploadFlow key={"token" in view ? view.token : view.kind} view={view} />;
}
