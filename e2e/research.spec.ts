import { expect, test } from "@playwright/test";
import http from "node:http";
import { randomUUID } from "node:crypto";
import {
  JOBS_SECRET,
  adminClient,
  createConfirmedUser,
  dueMailCount,
  jobRanCleanly,
  signIn,
} from "./helpers";

// A7 — the research-library pipeline, driven by a fixtured GWAS release:
// refresh drafts a template into the review queue; publishing it updates
// the public changelog and queues the opt-in digest; the mail worker submits
// it to a mock
// Resend API — the SDK honors RESEND_BASE_URL; production uses the real
// API, verified in the Resend dashboard).

const USER = { email: `digest-optin-${randomUUID()}@e2e.local`, password: "e2e-digest-pw" };
const SLUG = "auto-e2e-test-trait-rs11223344";

interface CapturedEmail {
  to: string[] | string;
  subject: string;
  html?: string;
}

const captured: CapturedEmail[] = [];
let resendMock: http.Server;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  resendMock = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      if (req.method === "POST" && req.url?.includes("/emails")) {
        captured.push(JSON.parse(body) as CapturedEmail);
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ id: `mock-${captured.length}` }));
      } else {
        res.writeHead(200).end("{}");
      }
    });
  });
  await new Promise<void>((r) => resendMock.listen(8124, "127.0.0.1", r));

  const userId = await createConfirmedUser(USER.email, USER.password);
  const admin = adminClient();
  const optIn = await admin
    .from("profiles")
    .update({ digest_opt_in: true })
    .eq("id", userId).select("id,digest_opt_in").single();
  expect(optIn.error).toBeNull();
  expect(optIn.data).toEqual({ id: userId, digest_opt_in: true });
  // Clean any leftover fixture template/changelog from previous runs. The
  // review rows go first: `template_reviews.template_id` is `on delete
  // restrict`, so an approval left behind by an earlier run would keep the
  // template it approved alive and this run would publish that one instead.
  await admin.from("changelog_entries").delete().eq("template_slug", SLUG);
  await admin.from("template_reviews").delete().eq("template_id", SLUG);
  await admin.from("report_templates").delete().eq("slug", SLUG);
  await admin
    .from("research_releases")
    .delete()
    .eq("release_key", "e2e-release-1");
});

test.afterAll(async () => {
  await new Promise<void>((r) => resendMock.close(() => r()));
});

test("a fixtured release drafts a template into the review queue", async ({
  request,
}) => {
  const res = await request.post("/api/jobs/research-refresh", {
    headers: { authorization: `Bearer ${JOBS_SECRET}` },
    data: {
      fixture: {
        source: "gwas_catalog",
        release_key: "e2e-release-1",
        associations: [
          {
            rsid: 11223344,
            trait: "E2E test trait",
            gene: "TESTGENE",
            chrom: 7,
            pos38: 1234567,
            ref: "A",
            alt: "G",
            effect_allele: "G",
            pmid: "12345678",
            study_label: "E2E et al., Test Journal 2026",
            effect_size: "OR 1.10",
          },
        ],
      },
    },
  });
  expect(res.status()).toBe(200);
  // D-086: the job used to answer with the release key, whether the release
  // was new and how many drafts it wrote. `machine-job-result-v1` allows the
  // outcome and nothing else, so what it did is read from the database it
  // wrote to — which is the stronger observation anyway.
  expect(await res.json()).toEqual({ status: "complete", outcome: "completed" });

  const admin = adminClient();
  const { data: release } = await admin
    .from("research_releases")
    .select("source, summary")
    .eq("release_key", "e2e-release-1")
    .single();
  expect(release?.source).toBe("gwas_catalog");
  expect(release?.summary).toMatchObject({ drafted: 1, associations: 1 });
  const { data: draft } = await admin
    .from("report_templates")
    .select("slug, status, evidence, citations")
    .eq("slug", SLUG)
    .single();
  expect(draft?.status).toBe("review");
  expect(draft?.evidence).toBe("preliminary");

  // Idempotent: replaying the same release drafts nothing new.
  const replay = await request.post("/api/jobs/research-refresh", {
    headers: { authorization: `Bearer ${JOBS_SECRET}` },
    data: {
      fixture: {
        source: "gwas_catalog",
        release_key: "e2e-release-1",
        associations: [],
      },
    },
  });
  // A release already in the ledger is no work at all, and the contract's
  // three outcomes say so directly: this is the idempotency claim, not a
  // weaker version of it.
  expect(await replay.json()).toEqual({ status: "complete", outcome: "no_work" });
  const { count: releases } = await admin
    .from("research_releases")
    .select("id", { count: "exact", head: true })
    .eq("release_key", "e2e-release-1");
  expect(releases).toBe(1);
});

test("unauthorized refresh is rejected", async ({ request }) => {
  const res = await request.post("/api/jobs/research-refresh", {
    data: {},
  });
  expect(res.status()).toBe(401);
});

// D-101: the drain publishes what the review queue approved and takes no
// input. Naming a target is how the route used to work, and the register has
// always forbidden it.
test("a publish request that names a template is refused", async ({ request }) => {
  const admin = adminClient();
  const named = await request.post("/api/jobs/research-publish", {
    headers: { authorization: `Bearer ${JOBS_SECRET}` },
    data: { slug: SLUG },
  });
  expect(named.status()).toBe(400);
  expect(await named.json()).toEqual({ error: "invalid_request" });

  const queried = await request.post("/api/jobs/research-publish?slug=" + SLUG, {
    headers: { authorization: `Bearer ${JOBS_SECRET}` },
  });
  expect(queried.status()).toBe(400);

  const unauthorized = await request.post("/api/jobs/research-publish");
  expect(unauthorized.status()).toBe(401);

  // Neither refusal published anything.
  const { data: still } = await admin
    .from("report_templates")
    .select("status")
    .eq("slug", SLUG)
    .single();
  expect(still?.status).toBe("review");
});

// The template drafted above sits in the review queue with no decision on it.
// A drain must leave it there: an approval is the only thing that publishes.
test("an unapproved draft is not due, and the drain publishes nothing", async ({
  request,
}) => {
  const admin = adminClient();
  const res = await request.post("/api/jobs/research-publish", {
    headers: { authorization: `Bearer ${JOBS_SECRET}` },
  });
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: "complete", outcome: "no_work" });
  const { data: unpublished } = await admin
    .from("report_templates")
    .select("status")
    .eq("slug", SLUG)
    .single();
  expect(unpublished?.status).toBe("review");
  const { count: entries } = await admin
    .from("changelog_entries")
    .select("id", { count: "exact", head: true })
    .eq("template_slug", SLUG);
  expect(entries ?? 0).toBe(0);
});

test("publishing updates the changelog and sends the opt-in digest", async ({
  page,
  request,
}) => {
  const admin = adminClient();
  // A human reviewer approves the draft. This is the act the drain waits for,
  // and the only input it reads: the review row, never the request. The row is
  // written with the service key because there is no reviewer surface to write
  // it through — filed as D-107. This test stands in for that reviewer; it does
  // not stand in for the review.
  const reviewer = await admin
    .from("subject_principals")
    .insert({ principal_kind: "reviewer" })
    .select("id")
    .single();
  expect(reviewer.error).toBeNull();
  const approval = await admin.from("template_reviews").insert({
    template_id: SLUG,
    reviewer_principal_id: reviewer.data!.id,
    review_revision: 1,
    decision: "approve",
    evidence_review_due: "2027-09-13",
  });
  expect(approval.error).toBeNull();

  const res = await request.post("/api/jobs/research-publish", {
    headers: { authorization: `Bearer ${JOBS_SECRET}` },
  });
  expect(res.status()).toBe(200);
  // D-086: the answer used to name the slug it had published and count the
  // subscribers it had queued a digest for. Both are what
  // `machine-job-result-v1` forbids, so the outcome is all that comes back
  // and the effects are read from the database.
  expect(await res.json()).toEqual({ status: "complete", outcome: "completed" });
  const { data: published } = await admin
    .from("report_templates")
    .select("status")
    .eq("slug", SLUG)
    .single();
  expect(published?.status).toBe("published");
  const { count: digests } = await admin
    .from("mail_outbox")
    .select("id", { count: "exact", head: true })
    .eq("purpose", "research.digest");
  expect(digests ?? 0).toBeGreaterThanOrEqual(1);

  // The global worker claims at most 25 ordinary rows in queue order. Earlier
  // source-ready notices remain genuine work; a successful batch is not a promise
  // that this newly queued digest was included. Continue only successful batches
  // with due work and progress, without selecting/deleting/reordering any row.
  // As with the invitation journeys, this needs a disposable local queue and
  // the fixed capture provider; it must not drain an unreviewed shared queue.
  // D-086 again: the drain's reply no longer carries a queue depth, because a
  // queue depth is a count of people waiting on mail. The loop reads the
  // outbox directly instead — the same query the route used to run, moved to
  // the one caller entitled to the answer.
  for (let batch = 0; batch < 10; batch++) {
    const before = await dueMailCount(admin);
    const drain = await request.post("/api/jobs/mail", {
      headers: { authorization: `Bearer ${JOBS_SECRET}` },
    });
    // `jobRanCleanly` refuses `completed_with_failures`, which is what this
    // loop's `expect(drainJson.failed).toBe(0)` meant before D-086. It needs
    // the disposable local queue this test already documents a need for: an
    // undeliverable row left behind by another journey fails it, exactly as
    // the `failed` reading did.
    const outcome = await jobRanCleanly(drain, `research mail batch ${batch + 1}`);
    const after = await dueMailCount(admin);
    await test.info().attach(`research-mail-batch-${batch + 1}`, {
      body: JSON.stringify({ outcome, dueBefore: before, dueAfter: after, delivered: captured.length }),
      contentType: "application/json",
    });
    expect(outcome).toBe("completed");
    expect(after, "a batch that delivered nothing would loop forever").toBeLessThan(before);
    if (captured.some(email => [email.to].flat().includes(USER.email))) break;
    expect(after, "a missing digest needs remaining due queue work").toBeGreaterThan(0);
  }

  // Changelog page shows the entry (heading carries the report title).
  await page.goto("/changelog");
  await expect(
    page.getByRole("heading", { name: /E2E test trait/ }),
  ).toBeVisible();

  // The digest reached the (mock) Resend API addressed to the opted-in user.
  const digest = captured.find((e) =>
    (Array.isArray(e.to) ? e.to : [e.to]).includes(USER.email),
  );
  expect(digest, "digest email must have been sent").toBeTruthy();
  expect(`${digest!.subject} ${digest!.html ?? ""}`).toContain("E2E test trait");

  // The fixture IS published (changelog above, direct link below) but must
  // NOT appear in the user-facing report library — auto-e2e-* slugs are
  // excluded there unconditionally.
  await signIn(page, USER.email, USER.password);
  await page.goto(`/genome/me/reports/${SLUG}`);
  await expect(
    page.getByRole("heading", { name: /E2E test trait/ }),
  ).toBeVisible();
  // The fixture is an estimate, so the check reads the estimate group: with
  // the Medicines variant calls seeded (ADR 0021) the list opens on the
  // estimate group, named explicitly so the check never depends on the list’s default.
  await page.goto("/genome/me/reports?layer=estimate");
  await expect(page.locator(`a[href="/genome/me/reports/${SLUG}"]`)).toHaveCount(0);
  await expect(page.getByText("E2E test trait")).toHaveCount(0);
});
