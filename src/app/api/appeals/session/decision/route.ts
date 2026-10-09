import { notFound, unavailable } from "@/lib/embryos/api";
import { testAppealIntakeOpen } from "@/lib/future-person/appeals-open";
import { publicAppealSessionHash } from "@/lib/future-person/public-appeal-session";
import { openAppealDecisionNotice } from "@/lib/future-person/public-appeal-review";
import { createAdminClient } from "@/lib/supabase/admin";
export async function GET(request: Request) {
 const url = new URL(request.url); const hash = publicAppealSessionHash(request);
 if (!testAppealIntakeOpen() || url.search || !hash || request.headers.get("sec-fetch-site") !== "same-origin") return notFound();
 const result = await createAdminClient().rpc("read_public_appeal_decision_notice_v1", { p_session_hash: hash }).retry(false).abortSignal(request.signal);
 if (result.error) return result.error.code === "42501" ? notFound() : unavailable();
 if (result.data === null) return notFound();
 const notice = openAppealDecisionNotice(result.data); if (!notice) return unavailable();
 // Native purpose selects either the original consumed evidence session or
 // its separate recipient-bound notice. Neither is a source/account lookup.
 return Response.json(notice, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
}
