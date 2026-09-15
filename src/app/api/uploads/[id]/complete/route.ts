import { finalizeSubjectUploadV2 } from "@/lib/uploads/subject-finalization";

export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return finalizeSubjectUploadV2(request, (await context.params).id);
}
