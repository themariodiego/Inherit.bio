import { finalizeSubjectUpload } from "@/lib/uploads/subject-finalization";

export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return finalizeSubjectUpload(request, (await context.params).id);
}
