import { expect, test, type Page } from "@playwright/test";
import { adminClient, createConfirmedUser, signIn } from "./helpers";

// A14 — the network audit as an E2E test over REAL rendered pages: the set
// of request origins on landing, dashboard, and a report page must be
// exactly the first-party allowlist. Fonts are self-hosted via next/font,
// so not even Google Fonts appears at runtime. Also asserts no Meta pixel
// (window.fbq) and no known tracker hosts. This is the CI gate version of
// the incumbent's failure mode (a Meta pixel visible only in the live DOM).

const ALLOWED_ORIGINS = new Set([
  "http://localhost:3100", // the app itself
  "http://127.0.0.1:54321", // this deployment's own Supabase API
]);

const TRACKER_HOST_FRAGMENTS = [
  "facebook", "fbcdn", "doubleclick", "google-analytics", "googletagmanager",
  "googleadservices", "googlesyndication", "clarity.ms", "hotjar", "segment",
  "mixpanel", "amplitude", "sentry", "datadog", "fullstory", "intercom",
  "hubspot", "linkedin", "tiktok", "snapchat", "pinterest", "criteo",
  "adsrvr", "taboola", "outbrain", "quantserve", "scorecardresearch",
];

const USER = { email: "netaudit@e2e.local", password: "e2e-netaudit-pw" };

test.beforeAll(async () => {
  await createConfirmedUser(USER.email, USER.password);
});

function watchRequests(page: Page): { origins: Set<string>; urls: string[] } {
  const origins = new Set<string>();
  const urls: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.protocol === "data:" || url.protocol === "blob:") return;
    origins.add(url.origin);
    urls.push(req.url());
  });
  return { origins, urls };
}

async function assertClean(
  page: Page,
  observed: { origins: Set<string>; urls: string[] },
  label: string,
) {
  const offenders = [...observed.origins].filter(
    (o) => !ALLOWED_ORIGINS.has(o),
  );
  expect(
    offenders,
    `${label}: unexpected third-party origins: ${offenders.join(", ")}\nURLs: ${observed.urls.filter((u) => offenders.some((o) => u.startsWith(o))).slice(0, 10).join("\n")}`,
  ).toHaveLength(0);

  for (const u of observed.urls) {
    const host = new URL(u).hostname;
    for (const frag of TRACKER_HOST_FRAGMENTS) {
      expect(host.includes(frag), `${label}: tracker-like host ${host}`).toBe(
        false,
      );
    }
  }

  const fbq = await page.evaluate(() => typeof (window as never as { fbq?: unknown }).fbq);
  expect(fbq, `${label}: window.fbq must be undefined`).toBe("undefined");
  const gtag = await page.evaluate(() => typeof (window as never as { gtag?: unknown }).gtag);
  expect(gtag, `${label}: window.gtag must be undefined`).toBe("undefined");
}

test("landing page contacts no third-party origin", async ({ page }) => {
  const observed = watchRequests(page);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await assertClean(page, observed, "landing");
});

test("providers page contacts no third-party origin", async ({ page }) => {
  const observed = watchRequests(page);
  await page.goto("/providers");
  await page.waitForLoadState("networkidle");
  await assertClean(page, observed, "providers");
});

test("dashboard contacts no third-party origin", async ({ page }) => {
  const observed = watchRequests(page);
  await signIn(page, USER.email, USER.password);
  await page.waitForLoadState("networkidle");
  await assertClean(page, observed, "dashboard");
});

test("a report page contacts no third-party origin", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  await page.goto("/reports");
  await page.waitForLoadState("networkidle");
  const firstReport = page.locator('a[href^="/reports/"]').first();
  const observed = watchRequests(page);
  if ((await firstReport.count()) > 0) {
    await firstReport.click();
    await page.waitForLoadState("networkidle");
  }
  await assertClean(page, observed, "report");
});

test("legal pages contact no third-party origin", async ({ page }) => {
  const observed = watchRequests(page);
  for (const route of ["/privacy", "/terms", "/about"]) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
  }
  await assertClean(page, observed, "legal");
});
