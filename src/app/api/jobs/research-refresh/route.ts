import { createAdminClient } from "@/lib/supabase/admin";
import {
  draftFromAssociation,
  type AssociationInput,
} from "@/lib/research/draft";
import {
  RELEASE_FETCHERS,
  type ResearchSource,
} from "@/lib/research/sources";
import { machineJobDrained } from "@/lib/jobs/machine-result";

export const maxDuration = 300;

interface FixturePayload {
  source: ResearchSource;
  release_key: string;
  associations: AssociationInput[];
}

function authorized(request: Request, secrets: (string | undefined)[]): boolean {
  const auth = request.headers.get("authorization");
  for (const secret of secrets) {
    if (secret && auth === `Bearer ${secret}`) return true;
  }
  return false;
}
// Manual/operator calls use JOBS_SECRET; Vercel Cron sends CRON_SECRET.
const liveSecrets = () => [process.env.JOBS_SECRET, process.env.CRON_SECRET];

// Vercel Cron invokes with GET; live mode only (no fixture body).
export async function GET(request: Request) {
  if (!authorized(request, liveSecrets())) {
    return new Response("Unauthorized", { status: 401 });
  }
  return runRefresh(null);
}

// Scheduled research-library job (Vercel Cron in production, callable
// manually). Detects new upstream releases, records them, and drafts new
// report templates into the review queue. A fixture body lets the E2E suite
// drive the same code path deterministically.
export async function POST(request: Request) {
  // Unauthenticated callers are refused before the body is read at all.
  if (!authorized(request, liveSecrets())) {
    return new Response("Unauthorized", { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as
    | { fixture?: FixturePayload }
    | null;
  // A fixture body is operator input, not a schedule's, so it needs the
  // operator secret specifically (brief G8.2(b), `docs/fixture-paths.md`).
  // The cron secret drives the live path and nothing else.
  if (body?.fixture && !authorized(request, [process.env.JOBS_SECRET])) {
    return new Response("Unauthorized", { status: 401 });
  }
  return runRefresh(body?.fixture ?? null);
}

/**
 * D-086: this used to answer with one object per source — the release key it
 * had recorded, whether the release was new, how many templates it drafted,
 * and on failure the raw `Error.message`. `machine-job-result-v1` names both
 * of those, the target row and the error free text, as never-returned. The
 * message now goes to the server log, where a diagnosis belongs, and the
 * response says only whether the job ran and whether anything failed.
 */
async function runRefresh(fixture: FixturePayload | null) {
  const admin = createAdminClient();
  let done = 0;
  let failed = 0;

  if (fixture) {
    const outcome = await processRelease(admin, fixture.source, fixture.release_key, fixture.associations);
    done += outcome.recorded + outcome.drafted;
    failed += outcome.failed;
  } else {
    for (const source of Object.keys(RELEASE_FETCHERS) as ResearchSource[]) {
      try {
        const info = await RELEASE_FETCHERS[source]();
        // Live mode records the release; association drafting from live GWAS
        // data is fixture-shaped and can be fed through the fixture path by
        // an operator — the release ledger is what drives "new this month".
        const outcome = await processRelease(admin, source, info.releaseKey, []);
        done += outcome.recorded + outcome.drafted;
        failed += outcome.failed;
      } catch {
        // The source name is a fixed catalog key, not anybody's data; the
        // upstream error text stays out of both the response and this line.
        console.error("[research-refresh] release read or draft failed", { source });
        failed++;
      }
    }
  }

  return machineJobDrained({ done, failed });
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

  // A release already in the ledger is not work; the caller reports no_work
  // for it rather than replaying the drafts.
  if (existing) return { recorded: 0, drafted: 0, failed: 0 };

  let drafted = 0;
  let failed = 0;
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
    // A refused upsert used to vanish: `drafted` simply did not advance and
    // nothing else recorded it. It is counted now, so the job reports
    // completed_with_failures rather than a clean run.
    if (error) failed++;
    else drafted++;
  }

  await admin.from("research_releases").insert({
    source,
    release_key: releaseKey,
    summary: { drafted, associations: associations.length },
  });

  return { recorded: 1, drafted, failed };
}
