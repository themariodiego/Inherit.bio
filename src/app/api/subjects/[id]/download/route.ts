import { openSubjectDownload, subjectDownloadDependencies } from "@/lib/uploads/subject-original-download";

/**
 * `GET /api/subjects/[id]/download?file=...` (register api.subject-download):
 * a revocable chunk session for one original file of the person's own
 * record, with no signed URL. See `src/lib/uploads/subject-original-download.ts`.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return openSubjectDownload(request, id, subjectDownloadDependencies());
}
