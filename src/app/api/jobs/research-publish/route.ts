import { NextResponse } from "next/server";
import { hasEmptyRequestBody } from "@/lib/empty-request-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueAccountMail } from "@/lib/mail-outbox";
import { machineJobDrained } from "@/lib/jobs/machine-result";

export const maxDuration = 300;

/**
 * Publishes the report templates a human reviewer has approved: status ->
 * published, a changelog entry, and an opt-in digest for each subscriber.
 * Operator-authorized with JOBS_SECRET.
 *
 * D-101, closed 2026-09-13: this route used to read `{ slug }` from the
 * request body and publish whichever template the caller named, refusing with
 * 400 when the field was absent. The register has always described the
 * opposite — `requestContract: { body: "forbidden", query: "forbidden" }`,
 * `policy.mode: "machine-reviewed-publication-only"` — and the register was
 * right: operator-selected publication was never the intent, and a caller
 * naming a target could publish a draft no reviewer had approved. The request
 * now selects nothing. `claim_due_research_publication_v1` decides what is
 * due, one template per call, oldest approval first, and the loop drains.
 */

/** Templates published in one invocation. The next drain takes the rest. */
const BATCH = 5;

function authorized(request: Request): boolean {
  const secret = process.env.JOBS_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

async function requestHasSelectors(request: Request): Promise<boolean> {
  return (
    new URL(request.url).search.length > 0 ||
    request.headers.has("transfer-encoding") ||
    Number(request.headers.get("content-length") ?? "0") > 0 ||
    !(await hasEmptyRequestBody(request))
  );
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (await requestHasSelectors(request)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const admin = createAdminClient();
  let processed = 0;
  let failed = 0;

  for (let index = 0; index < BATCH; index++) {
    // The claim publishes the template inside its own transaction, so a
    // second drain running concurrently cannot pick up the same one and
    // write the changelog entry twice.
    const { data, error } = await admin.rpc("claim_due_research_publication_v1");
    if (error) {
      // The publication guards are database constraints: an approved template
      // whose evidence level may not be published raises here and stays in
      // the review queue. Stopping rather than skipping keeps the failure at
      // the head of the queue where a reviewer will meet it, and every drain
      // reports `completed_with_failures` until they do.
      console.error("[research-publish] claiming an approved template failed");
      failed++;
      break;
    }
    const template = data?.[0];
    if (!template) break;
    processed++;

    const { data: changelog, error: changelogError } = await admin
      .from("changelog_entries")
      .insert({
        title: `New report: ${template.title}`,
        body: template.summary,
        template_slug: template.slug,
      })
      .select("id")
      .single();
    if (changelogError || !changelog) {
      // The database's own message can carry column values and constraint
      // text, so it goes to the server log and the caller gets a coded 503.
      console.error("[research-publish] changelog write failed");
      return NextResponse.json({ error: "publish_incomplete" }, { status: 503 });
    }

    failed += await queueDigests(admin, changelog.id, template);
  }

  // D-086: the answer used to name the slug this run published and count the
  // subscribers it had queued a digest for. `machine-job-result-v1` forbids
  // both. Publishing is one unit of work; each queued digest is another.
  return machineJobDrained({ done: processed, failed });
}

/** Queues the opt-in digest for one published template; returns the failures. */
async function queueDigests(
  admin: ReturnType<typeof createAdminClient>,
  changelogId: string,
  template: { slug: string; title: string; summary: string },
): Promise<number> {
  const { data: optIns } = await admin
    .from("profiles")
    .select("id")
    .eq("digest_opt_in", true);
  if (!optIns || optIns.length === 0) return 0;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  let failed = 0;
  for (const profile of optIns) {
    const { data: userData } = await admin.auth.admin.getUserById(profile.id);
    const email = userData?.user?.email;
    if (!email) continue;
    try {
      await enqueueAccountMail({
        accountId: profile.id,
        email,
        mail: {
          id: "research-digest",
          payload: {
            entries: [
              {
                title: template.title,
                summary: template.summary,
                url: `${siteUrl}/genome/me/reports/${template.slug}`,
              },
            ],
            manageUrl: `${siteUrl}/settings`,
          },
        },
        purpose: "research.digest",
        targetKind: "changelog_entry",
        targetId: changelogId,
        semanticKey: `research:${template.slug}:${profile.id}`,
      });
    } catch {
      console.error("[mail] research-digest enqueue failed");
      failed++;
    }
  }
  return failed;
}
