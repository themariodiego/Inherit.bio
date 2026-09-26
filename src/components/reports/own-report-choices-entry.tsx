import { loadOwnReportChoicesPanel } from "@/lib/uploads/prepare-own-report-choices";
import { OwnReportChoices } from "./own-report-choices";

export async function OwnReportChoicesEntry({ subject }: { subject: string }) {
  const panel = await loadOwnReportChoicesPanel(subject);
  if (panel.kind === "files-unavailable") return <p role="status">Report choices could not load. Refresh this page to try again.</p>;
  if (panel.kind !== "ready") return null;
  return <OwnReportChoices view={panel.view} files={panel.files} />;
}
