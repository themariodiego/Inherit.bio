import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { adminClient, ingestFileAs, signIn } from "./helpers";

test("a processed self-upload queues one report-ready notice without deadline renewal", async ({ page }) => {
  const email = `mail-expiry-${randomUUID()}@e2e.local`;
  const password = "e2e-mail-expiry-password";
  const admin = adminClient();
  // A unique synthetic identity needs no lookup or mutation of other accounts.
  const { error: createError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  expect(createError).toBeNull();
  await signIn(page, email, password);
  const fileId = await ingestFileAs(page, email, password,
    path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"), "vcf");
  const readNotice = () => admin.from("mail_outbox")
    .select("id,state,created_at,expires_at,contact_reference_id")
    .eq("target_id", fileId).eq("target_kind", "genome_file")
    .eq("purpose", "report.ready").eq("template_id", "report-ready");
  const { data: notices, error: noticeError } = await readNotice();
  expect(noticeError).toBeNull();
  expect(notices).toHaveLength(1);
  const notice = notices![0];
  expect(notice.state).toBe("queued");
  const retention = Date.parse(notice.expires_at) - Date.parse(notice.created_at);
  expect(retention).toBeGreaterThan(29 * 86_400_000);
  expect(retention).toBeLessThanOrEqual(30 * 86_400_000);

  // Run the actual processing route twice. Neither the route nor this test
  // calls the mail worker or a provider; semantic replay cannot renew expiry.
  const replay = await page.request.post(`/api/files/${fileId}/process`);
  expect(replay.ok()).toBe(true);
  const { data: replayNotices, error: replayError } = await readNotice();
  expect(replayError).toBeNull();
  expect(replayNotices).toEqual(notices);
  const { count: attempts, error: attemptError } = await admin
    .from("mail_provider_attempts").select("id", { head: true, count: "exact" })
    .eq("outbox_id", notice.id);
  expect(attemptError).toBeNull();
  expect(attempts).toBe(0);
  await page.goto("/genome/me/reports");
  await expect(page.getByRole("heading", { name: "Reports", exact: true })).toBeVisible();
});
