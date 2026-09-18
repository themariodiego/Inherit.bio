import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import ledger from "../docs/route-dispositions.json";
import register from "../docs/route-register.json";
import { createConfirmedUser, signIn } from "./helpers";

/**
 * G2.3: every route the application served at the register's baseline commit
 * has exactly one disposition — kept, or a redirect to a named successor —
 * and here each disposition is asserted over HTTP against the running build.
 *
 * `docs/route-dispositions.json` is the list, measured from the baseline
 * commit rather than typed, and `pnpm gate:routes` holds it to the register
 * statically. What the gate cannot see is what a request gets, which is the
 * brief's actual requirement: a pre-existing page route may never 404 and
 * may never be gone; a redirect answers 308 to the successor the register
 * names; a kept endpoint is still served under the methods the register
 * declares. Those are the three assertions below, each over every entry of
 * its kind, and each soft so that one run names every route that fails
 * rather than the first.
 *
 * Nothing here is a state proof, so no title names a state id: this file
 * answers "is the old URL still alive and going where the register says",
 * which is a different question from what the page renders once it gets
 * there.
 */

type Disposition = "kept" | { redirect: string; expectedStatus?: number };
interface Entry { path: string; registerId: string; kind: string; auth?: string; disposition: Disposition }
const ROUTES = ledger.routes as Entry[];
const REGISTER = register.routes as { path: string; methods?: string[] }[];

const USER = { email: `dispositions-${randomUUID()}@e2e.local`, password: "e2e-dispositions-pw" };
/** A real seeded template, so `/reports/[slug]` redirects to a report that exists. */
const SLUG = "caffeine-metabolism-cyp1a2-rs762551";
/** An id nobody holds: every `[id]` endpoint answers for its auth rule before any lookup. */
const FILE_ID = randomUUID();

function concrete(path: string): string {
  return path.replace("[slug]", SLUG).replace("[id]", FILE_ID);
}

function isRedirect(entry: Entry): entry is Entry & { disposition: { redirect: string; expectedStatus?: number } } {
  return typeof entry.disposition === "object";
}

const REDIRECTS = ROUTES.filter(isRedirect);
const KEPT_PAGES = ROUTES.filter((entry) => entry.disposition === "kept" && entry.kind === "page");
const KEPT_ENDPOINTS = ROUTES.filter((entry) => entry.disposition === "kept" && entry.kind === "endpoint");

/** The path a redirect landed on, resolved against the request's own origin. */
function landing(response: { url(): string; headers(): Record<string, string> }): string {
  const location = response.headers()["location"] ?? "";
  return new URL(location, response.url()).pathname;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  // The ledger is not empty and holds every kind this file asserts, so a
  // ledger that lost its routes cannot pass by asserting nothing.
  expect(ROUTES.length).toBeGreaterThanOrEqual(30);
  expect(REDIRECTS.length).toBeGreaterThanOrEqual(5);
  expect(KEPT_PAGES.length).toBeGreaterThanOrEqual(10);
  expect(KEPT_ENDPOINTS.length).toBeGreaterThanOrEqual(10);
  await createConfirmedUser(USER.email, USER.password);
});

test("every pre-existing redirect answers its registered status to its named successor for a signed-in reader", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  for (const entry of REDIRECTS) {
    const from = concrete(entry.path);
    const to = concrete(entry.disposition.redirect);
    const response = await page.request.get(from, { maxRedirects: 0 });
    expect.soft(response.status(), `${from} status`).toBe(entry.disposition.expectedStatus ?? 308);
    expect.soft(landing(response), `${from} lands on its successor`).toBe(to);
  }
});

/**
 * Signed out, the same URLs must still be alive: the brief's "may never 404".
 * An authenticated legacy alias may answer the successor directly (308) or
 * send the reader to sign in first (307), and either keeps the old URL
 * working; a public alias answers the successor. A kept page answers, or
 * sends a signed-out reader to sign in — the same rule `e2e/a11y.spec.ts`
 * holds every authenticated page to.
 */
test("every pre-existing page route and redirect is alive for a signed-out reader and never answers not found", async ({ request }) => {
  await probeSignedOut(request);
});

async function probeSignedOut(request: APIRequestContext) {
  for (const entry of REDIRECTS) {
    const from = concrete(entry.path);
    const to = concrete(entry.disposition.redirect);
    const response = await request.get(from, { maxRedirects: 0 });
    expect.soft([307, 308], `${from} signed out redirects`).toContain(response.status());
    const landed = landing(response);
    if (entry.auth === "public") expect.soft(landed, `${from} public alias lands on its successor`).toBe(to);
    else expect.soft([to, "/auth/sign-in"], `${from} lands on its successor or on sign-in`).toContain(landed);
  }
  for (const entry of KEPT_PAGES) {
    const response = await request.get(entry.path, { maxRedirects: 0 });
    if (entry.auth === "authenticated") {
      expect.soft(response.status(), `${entry.path} sends a signed-out reader to sign in`).toBe(307);
      expect.soft(landing(response), `${entry.path} sign-in destination`).toMatch(/^\/auth\/sign-in/);
    } else {
      expect.soft(response.status(), `${entry.path} answers`).toBe(200);
      expect.soft(response.headers()["content-type"] ?? "", `${entry.path} is a page`).toMatch(/^text\/html/);
    }
  }
}

/**
 * A kept endpoint is served under every method the register declares. What
 * "served" means without a credential is that the handler answered — a
 * refusal, a redirect or a method it does not export — and never the
 * framework's not-found page, which is what a retired handler produces. The
 * refusal is asserted as not-HTML because the not-found page is HTML and a
 * handler's own refusal never is.
 */
test("every pre-existing endpoint is still served under each method the register declares", async ({ request }) => {
  for (const entry of KEPT_ENDPOINTS) {
    const registered = REGISTER.find((route) => route.path === entry.path);
    expect(registered?.methods?.length, `${entry.path} declares its methods`).toBeGreaterThan(0);
    for (const method of registered!.methods!) {
      const response = await request.fetch(concrete(entry.path), { method, maxRedirects: 0, failOnStatusCode: false });
      const status = response.status();
      expect.soft(status, `${method} ${entry.path} is served`).not.toBe(404);
      expect.soft(status, `${method} ${entry.path} does not fail`).toBeLessThan(500);
      if (status >= 400) {
        expect.soft(response.headers()["content-type"] ?? "", `${method} ${entry.path} refuses as a handler, not as the not-found page`)
          .not.toMatch(/^text\/html/);
      }
    }
  }
});
