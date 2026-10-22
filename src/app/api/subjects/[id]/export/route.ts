import {pollSubjectExport,postSubjectExport,subjectExportHttpDependencies} from "@/lib/exports/subject-export-http";

/**
 * `POST /api/subjects/[id]/export` and `GET` (register api.subject-export):
 * one record's own archive, on the account producer, under the owner's
 * two-step decision of 16 October 2026. POST `create` enqueues and
 * `open-ready` opens the download session; GET polls the record's own
 * cookie-bound export. While the record has live joint results the request
 * is refused with the stated reason `jointResults` (invalid-request-v1).
 * See `src/lib/exports/subject-export-http.ts`.
 */
export const maxDuration=60;
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 const {id}=await context.params;
 return postSubjectExport(request,id,subjectExportHttpDependencies());
}
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
 const {id}=await context.params;
 return pollSubjectExport(request,id,subjectExportHttpDependencies());
}
