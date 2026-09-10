import { z } from "zod";
import { chromToNumber } from "@/lib/genome/types";
import { createClient } from "@/lib/supabase/server";

/**
 * User variants within a genomic region, for the embedded genome browser.
 * RLS-scoped; serves only the requesting user's own data.
 *
 * This route was a GET carrying `file`, `chrom`, `start` and `end` in the
 * query string. `docs/route-register.json#routes` registers it as a POST whose
 * `policy.transport` reads "subject-region-cursor-and-nonce-are-body-only-and-
 * forbidden-in-the-URL-query-path-logs-analytics-traces-errors-referrers-and-
 * audit-detail", and a GET cannot carry a body — so a person's file identifier
 * and the exact stretch of their genome they were reading travelled in a URL,
 * which is written to server logs, referrers and traces by default. That is the
 * defect this shape closes, and it is why the parameters move into the body
 * rather than being renamed.
 *
 * Two registered bounds were also wider in code than on paper: the span cap was
 * 10 Mb against a registered 1 Mb, and the page was 5,000 rows against a
 * registered 500. Both now read the registered numbers. Narrowing them is safe
 * for the one caller: `locusAround` asks for a 10 kb window.
 *
 * What is still not built, so that this comment is not read as conformance:
 * `authRequirements` also names an `X-Inherit-CSRF` token bound to the
 * authenticated session and a one-time browse operation nonce, and
 * `successResponseContract` `raw-region-v1` names a server-signed opaque
 * `nextCursor` and a subject-shaped body. Those need a nonce-minting
 * presentation and a signing key this route cannot invent. The same-origin
 * half of the requirement is enforced here because it needs neither.
 */

/** The registered bounds, read from docs/route-register.json#api.browse-region. */
const MAXIMUM_SPAN_BASES = 1_000_000;
const MAXIMUM_ROWS_PER_PAGE = 500;

/** Closed: an unknown field is a different request, not a tolerated one. */
const regionRequest = z.object({
  file: z.uuid(),
  chromosome: z.string().min(1).max(5),
  start: z.number().int().positive().safe(),
  end: z.number().int().positive().safe(),
}).strict();

/** Authenticated user data, per docs/route-register.json#sensitiveResponseHeaders. */
function response(body: unknown, status: number) {
  return Response.json(body, { status, headers: {
    "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store",
    "Vercel-CDN-Cache-Control": "no-store", "Pragma": "no-cache",
    "Referrer-Policy": "same-origin", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "frame-ancestors 'none'", "X-Frame-Options": "DENY",
  } });
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin
    || request.headers.get("sec-fetch-site") !== "same-origin") {
    return response({ error: "forbidden" }, 403);
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return response({ error: "unauthorized" }, 401);

  const parsed = regionRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return response({ error: "invalid_request" }, 422);
  const { file, chromosome, start, end } = parsed.data;
  const chrom = chromToNumber(chromosome);
  if (!chrom || end < start) return response({ error: "invalid_request" }, 422);
  if (end - start > MAXIMUM_SPAN_BASES) return response({ error: "region_too_large" }, 422);

  const { data, error } = await supabase
    .from("user_variants")
    .select("rsid, chrom, pos, ref, alt, genotype")
    .eq("file_id", file)
    .eq("chrom", chrom)
    .gte("pos", start)
    .lte("pos", end)
    .order("pos")
    .limit(MAXIMUM_ROWS_PER_PAGE);
  // The database's own message can name a column or a constraint; the reader
  // gets a coded outcome and the detail stays server-side.
  if (error) return response({ error: "unavailable" }, 503);

  const variants = data ?? [];
  return response({ variants, truncated: variants.length === MAXIMUM_ROWS_PER_PAGE }, 200);
}
