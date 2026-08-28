import { expect, test } from "@playwright/test";
import http from "node:http";
import { JOBS_SECRET, adminClient, createConfirmedUser } from "./helpers";

// A7 — the research-library pipeline, driven by a fixtured GWAS release:
// refresh drafts a template into the review queue; publishing it updates
// the public changelog and sends the opt-in digest (captured via a mock
// Resend API — the SDK honors RESEND_BASE_URL; production uses the real
// API, verified in the Resend dashboard).

const USER = { email: "digest-optin@e2e.local", password: "e2e-digest-pw" };
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
  await admin
    .from("profiles")
    .update({ digest_opt_in: true })
    .eq("id", userId);
  // Clean any leftover fixture template/changelog from previous runs.
  await admin.from("changelog_entries").delete().eq("template_slug", SLUG);
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
  const json = (await res.json()) as {
    results: { new_release: boolean; drafted: number }[];
  };
  expect(json.results[0].new_release).toBe(true);
  expect(json.results[0].drafted).toBe(1);

  const admin = adminClient();
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
  const replayJson = (await replay.json()) as {
    results: { new_release: boolean }[];
  };
  expect(replayJson.results[0].new_release).toBe(false);
});

test("unauthorized refresh is rejected", async ({ request }) => {
  const res = await request.post("/api/jobs/research-refresh", {
    data: {},
  });
  expect(res.status()).toBe(401);
});

test("publishing updates the changelog and sends the opt-in digest", async ({
  page,
  request,
}) => {
  const res = await request.post("/api/jobs/research-publish", {
    headers: { authorization: `Bearer ${JOBS_SECRET}` },
    data: { slug: SLUG },
  });
  expect(res.status()).toBe(200);
  const json = (await res.json()) as { published: boolean; digest_sent: number };
  expect(json.published).toBe(true);
  expect(json.digest_sent).toBeGreaterThanOrEqual(1);

  // Changelog page shows the entry.
  await page.goto("/changelog");
  await expect(page.getByText("E2E test trait")).toBeVisible();

  // The digest reached the (mock) Resend API addressed to the opted-in user.
  const digest = captured.find((e) =>
    (Array.isArray(e.to) ? e.to : [e.to]).includes(USER.email),
  );
  expect(digest, "digest email must have been sent").toBeTruthy();
  expect(`${digest!.subject} ${digest!.html ?? ""}`).toContain("E2E test trait");
});
