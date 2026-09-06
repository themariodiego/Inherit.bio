import { prepareOwnUpload } from "@/lib/uploads/prepare-own-upload";
import { OwnUploadFlow } from "./own-upload-flow";

export async function OwnUploadEntry() {
  // A preparation outage must not take the existing file controls down with it.
  const view = await prepareOwnUpload().catch(() => ({ kind: "unavailable" as const }));
  return <OwnUploadFlow key={"token" in view ? view.token : view.kind} view={view} />;
}
