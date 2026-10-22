import { claimantNotFound, claimantSessionHash } from "@/lib/future-person/rights";
import { isCanonicalId } from "@/lib/future-person/review";
import { nativeRequesterStatement, openRequesterCorrectionStatement, requesterStatementsOpen } from "@/lib/future-person/requester-statement";
import { createAdminClient } from "@/lib/supabase/admin";
import { closedResponse } from "@/lib/embryos/guards";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params, url = new URL(request.url), sessionHash = claimantSessionHash(request);
  if (!requesterStatementsOpen() || !sessionHash || !isCanonicalId(id) || url.search || request.body !== null
    || request.headers.get("sec-fetch-site") !== "same-origin") return claimantNotFound();
  const admin = createAdminClient();
  const read = await admin.rpc("read_requester_correction_statement_v1", { p_hash: sessionHash, p_id: id });
  const frame = nativeRequesterStatement.safeParse(read.data);
  if (read.error || !frame.success || frame.data.scope.caseId !== id) return claimantNotFound();
  const args = { p_hash: sessionHash, p_id: id, p_expected: frame.data.binding };
  const before = await admin.rpc("check_requester_correction_statement_v1", args);
  if (before.error || before.data !== true) return claimantNotFound();
  const dto = openRequesterCorrectionStatement(frame.data, id);
  if (!dto) return claimantNotFound();
  const response = await closedResponse("api.future-person-own-correction-statement", ["correctionId", "statement"], dto, 200,
    { "Content-Disposition": 'attachment; filename="my-correction-statement.json"', "Referrer-Policy": "no-referrer" });
  const after = await admin.rpc("check_requester_correction_statement_v1", args);
  if (after.error || after.data !== true) return claimantNotFound();
  return response;
}
