import { createAdminClient } from "@/lib/supabase/admin";
import { prepareOwnReportChoices } from "@/lib/uploads/prepare-own-report-choices";
import { OwnReportChoices } from "./own-report-choices";

export async function OwnReportChoicesEntry({ subject }: { subject: string }) {
  const view = await prepareOwnReportChoices(subject).catch(() => ({ kind: "unavailable" as const }));
  if (view.kind !== "ready") return null;
  // Metadata only, after resolving the signed-in account's own subject. Never
  // imply that prepared source rows are themselves an authorised report.
  const { data, error } = await createAdminClient().from("genome_files")
    .select("id, created_at, normalization_source_revision, upload_revision")
    .eq("subject_id", view.subjectId).not("single_logical_sample_verified_at", "is", null)
    .not("normalization_completed_at", "is", null).in("status", ["stored", "annotated"])
    .order("created_at", { ascending: false });
  if (error) return <p role="status">Report choices could not load. Refresh this page to try again.</p>;
  const files = (data ?? []).filter(file => file.normalization_source_revision === file.upload_revision)
    .map((file, index) => ({ id: file.id, label: `File ${index + 1} · uploaded ${file.created_at.slice(0, 10)}` }));
  if (files.length === 0) return null;
  return <OwnReportChoices view={view} files={files} />;
}
