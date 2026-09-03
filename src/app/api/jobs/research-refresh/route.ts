import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  draftFromAssociation,
  type AssociationInput,
} from "@/lib/research/draft";
import {
  RELEASE_FETCHERS,
  type ResearchSource,
} from "@/lib/research/sources";

export const maxDuration = 300;

interface FixturePayload {
  source: ResearchSource;
  release_key: string;
  associations: AssociationInput[];
}

function authorized(request: Request): boolean {
  const auth = request.headers.get("authorization");
  // Manual/operator calls use JOBS_SECRET; Vercel Cron sends CRON_SECRET.
  for (const secret of [process.env.JOBS_SECRET, process.env.CRON_SECRET]) {
    if (secret && auth === `Bearer ${secret}`) return true;
  }
  return false;
}

// Vercel Cron invokes with GET; live mode only (no fixture body).
export async function GET(request: Request) {
  if (!authorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }
  return runRefresh(null);
}

// Scheduled research-library job (Vercel Cron in production, callable
// manually). Detects new upstream releases, records them, and drafts new
// report templates into the review queue. A fixture body lets the E2E suite
// drive the same code path deterministically.
export async function POST(request: Request) {
  if (!authorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as
    | { fixture?: FixturePayload }
    | null;
  return runRefresh(body?.fixture ?? null);
}

async function runRefresh(fixture: FixturePayload | null) {
  const admin = createAdminClient();
  const body = fixture ? { fixture } : null;

  const results: Record<string, unknown>[] = [];

  if (body?.fixture) {
    const f = body.fixture;
    const outcome = await processRelease(admin, f.source, f.release_key, f.associations);
    results.push({ source: f.source, ...outcome });
  } else {
    for (const source of Object.keys(RELEASE_FETCHERS) as ResearchSource[]) {
      try {
        const info = await RELEASE_FETCHERS[source]();
        // Live mode records the release; association drafting from live GWAS
        // data is fixture-shaped and can be fed through the fixture path by
        // an operator — the release ledger is what drives "new this month".
        const outcome = await processRelease(admin, source, info.releaseKey, []);
        results.push({ source, ...outcome });
      } catch (err) {
        results.push({
          source,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return NextResponse.json({ results });
}

async function processRelease(
  admin: ReturnType<typeof createAdminClient>,
  source: ResearchSource,
  releaseKey: string,
  associations: AssociationInput[],
) {
  const { data: existing } = await admin
    .from("research_releases")
    .select("id")
    .eq("source", source)
    .eq("release_key", releaseKey)
    .maybeSingle();

  if (existing) return { release_key: releaseKey, new_release: false, drafted: 0 };

  let drafted = 0;
  for (const assoc of associations) {
    const draft = draftFromAssociation(assoc, `${source} ${releaseKey}`);
    const { error } = await admin.from("report_templates").upsert(
      {
        slug: draft.slug,
        category: draft.category,
        title: draft.title,
        summary: draft.summary,
        status: "review",
        evidence: draft.evidence,
        layer: draft.layer,
        estimate_kind: draft.estimate_kind,
        variants: draft.variants as never,
        pgs_id: draft.pgs_id,
        citations: draft.citations as never,
      },
      { onConflict: "slug", ignoreDuplicates: true },
    );
    if (!error) drafted++;
  }

  await admin.from("research_releases").insert({
    source,
    release_key: releaseKey,
    summary: { drafted, associations: associations.length },
  });

  return { release_key: releaseKey, new_release: true, drafted };
}
