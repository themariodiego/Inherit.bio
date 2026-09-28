import { test as base, expect, type Browser, type BrowserContext } from "@playwright/test";
import { LOCAL_BROWSER_ORIGINS } from "../scripts/local-storage-browser-config";
import { paymentOrigin } from "../scripts/payment-origins";
import { TRACKER_HOST_FRAGMENTS, type ObservedRequests } from "./helpers";

/**
 * G1.7's state dimension: the network audit, run inside every browser test
 * that proves a (route, state) pair.
 *
 * `assertNoThirdParty` already runs after every navigation of the
 * register-derived accessibility sweep, in both themes and both auth modes,
 * but that sweep reaches each route only in the one state its `VISIT` URL
 * produces. The states the register declares are reached by the specs whose
 * titles prove them, so the audit has to ride inside those specs. A spec that
 * takes `test` from here gets it automatically: every request from every
 * context the test opens is recorded, including contexts made with
 * `browser.newContext()` or `browser.newPage()`, and after a test that passed
 * as expected each context is held to the same three checks as the sweep: no
 * origin outside this deployment, no tracker-like host, and none of
 * `window.fbq`, `window.gtag` or `window.dataLayer` on any page still open.
 * The rendered document is also read for a payment-processor origin (G5.7).
 * `gate:routes` refuses a spec that proves a pair without importing this.
 *
 * The allowed origins are this deployment's own: its Supabase API and the app
 * build served on its local ports. The sweep allows only the main port, but
 * the state specs also drive the same build on the jurisdiction-off and other
 * variant ports, and those are still the app itself.
 */
export const STATE_AUDIT_ORIGINS: ReadonlySet<string> = new Set(LOCAL_BROWSER_ORIGINS);

function watchContext(context: BrowserContext): ObservedRequests {
  const origins = new Set<string>();
  const urls: string[] = [];
  context.on("request", request => {
    const url = new URL(request.url());
    // data: and blob: are the page's own bytes; they reach no network.
    if (url.protocol === "data:" || url.protocol === "blob:") return;
    origins.add(url.origin);
    urls.push(request.url());
  });
  return { origins, urls };
}

/** A page that closed or navigated after the test's last step has no document to read. */
function goneMidRead(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Execution context was destroyed|Target page, context or browser has been closed|has been closed/.test(message);
}

async function auditContext(context: BrowserContext, observed: ObservedRequests, label: string): Promise<void> {
  const offenders = [...observed.origins].filter(origin => !STATE_AUDIT_ORIGINS.has(origin));
  expect(offenders, `${label}: unexpected third-party origins: ${offenders.join(", ")}\nURLs: `
    + observed.urls.filter(url => offenders.some(origin => url.startsWith(origin))).slice(0, 10).join("\n"))
    .toHaveLength(0);
  for (const url of observed.urls) {
    const host = new URL(url).hostname;
    for (const fragment of TRACKER_HOST_FRAGMENTS) {
      expect(host.includes(fragment), `${label}: tracker-like host ${host}`).toBe(false);
    }
  }
  for (const page of context.pages()) {
    if (page.isClosed() || !/^https?:/.test(page.url())) continue;
    try {
      for (const global of ["fbq", "gtag", "dataLayer"] as const) {
        const seen = await page.evaluate(
          name => typeof (window as never as Record<string, unknown>)[name], global);
        expect(seen, `${label}: window.${global} must be undefined on ${page.url()}`).toBe("undefined");
      }
      expect(paymentOrigin(await page.content()),
        `${label}: payment-processor origin in the rendered response of ${page.url()}`).toBeNull();
    } catch (error) {
      if (!goneMidRead(error)) throw error;
    }
  }
}

export const test = base.extend<{ stateNetworkAudit: void }>({
  stateNetworkAudit: [async ({ browser, context }, runTest, testInfo) => {
    const audited: [BrowserContext, ObservedRequests][] = [[context, watchContext(context)]];
    const target = browser as Browser & { newContext: Browser["newContext"] };
    const original = target.newContext;
    target.newContext = async (...options: Parameters<Browser["newContext"]>) => {
      const created = await original.apply(browser, options);
      audited.push([created, watchContext(created)]);
      return created;
    };
    try {
      await runTest();
    } finally {
      target.newContext = original;
    }
    // A failing test already reports its own cause; an audit finding on top
    // of it would only bury that. An expected failure is audited like a pass.
    if (testInfo.status !== testInfo.expectedStatus) return;
    const label = `network audit: ${testInfo.titlePath.slice(1).join(" › ")}`;
    for (const [context_, observed] of audited) await auditContext(context_, observed, label);
  }, { auto: true }],
});

export { expect };
