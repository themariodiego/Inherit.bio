import { execFile } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium, type Browser } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONTROL_ATTRIBUTE, isNavigationRace, openLiveSession, pageSource, snapshotDocument, windowLines,
  type LiveSessionOptions } from "./live-browser";

// A tiny synthetic site. Nothing here is the product or a participant.
const pages: Record<string, (outside: string, cookie: string) => string> = {
  "/": outside => `<title>Home</title><main><h1>Welcome</h1><p>Plain words here.</p>
    <p hidden>Hidden words.</p><a href="/second">Second page</a>
    <form action="/second" method="get"><label>Friend email <input name="email"></label><button>Send</button></form>
    <img src="${outside}/pixel" alt=""><button disabled>Not yet</button></main>`,
  "/second": () => `<title>Second</title><main><h2>Second heading</h2><a href="/">Back home</a></main>`,
  "/third": () => `<title>Third</title><main><p>Reached by typing.</p></main>`,
  "/mail": () => `<title>Mailed</title><main><p>Opened from an email.</p></main>`,
  "/cookie": (_outside, cookie) => `<title>Cookie</title><main><p>Cookie: ${cookie || "none"}</p></main>`,
  // A page whose own script breaks the reader. That is not a page loading.
  "/refusing": () => `<title>Refusing</title><script>Element.prototype.matches = () => {
    throw new Error("synthetic snapshot refusal"); };</script><main><p>Unreadable.</p></main>`,
};
let browser: Browser, app: http.Server, outside: http.Server, origin = "", outsideOrigin = "", outsideHits = 0;
const listen = (server: http.Server) => new Promise<string>(resolve => server.listen(0, "127.0.0.1",
  () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
beforeAll(async () => {
  outside = http.createServer((_request, response) => { outsideHits++; response.end(); });
  outsideOrigin = await listen(outside);
  app = http.createServer((request, response) => {
    const page = pages[new URL(request.url ?? "/", "http://localhost").pathname] as ((outside: string, cookie: string) => string) | undefined;
    response.writeHead(page ? 200 : 404, { "content-type": "text/html" })
      .end(page ? page(outsideOrigin, request.headers.cookie ?? "") : "missing");
  });
  origin = await listen(app);
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  await new Promise(resolve => app?.close(resolve)); await new Promise(resolve => outside?.close(resolve));
});

const options = (overrides: Partial<LiveSessionOptions> = {}): LiveSessionOptions => ({ browser, sessionId: "s1", baseURL: origin,
  allowedOrigins: [origin], startPath: "/", textLimit: 4000, actionTimeoutMs: 3000,
  complete: async ({ paths }) => paths.includes("/second"), ...overrides });

describe("a live participant session", () => {
  it("shows visible text and controls, counts real click and submit events, and records entries separately", async () => {
    const session = await openLiveSession(options({ inbox: [{ subject: "A synthetic email", text: "Open this.",
      links: [{ id: "m1", label: "Open the review", url: `${origin}/mail` }] }] }));
    try {
      const first = await session.observe() as { path: string; visibleText: string; controls: string[] };
      expect(first.path).toBe("/");
      expect(first.visibleText).toContain("# Welcome");
      expect(first.visibleText).not.toContain("Hidden words");
      expect(first.visibleText).toMatch(/\[c0 link\] Second page/);
      expect(first.visibleText).toMatch(/\[c1 text field\] Friend email/);
      expect(first.visibleText).toMatch(/\[c3 button\] Not yet \(disabled\)/);
      expect(first.visibleText).toContain("[m1 mailed-link] Open the review");
      expect(first.controls).toEqual(["c0", "c1", "c2", "c3", "m1"]);

      await session.act({ kind: "submit", target: "c1", value: "friend@example.com" });
      expect((await session.observe() as { visibleText: string }).visibleText).toContain("only accepts made-up email addresses");
      expect(session.diagnostics().refusedValues).toBe(1);
      await session.act({ kind: "submit", target: "c1", value: "friend@e2e.local" });
      expect(session.paths()).toEqual(["/", "/second"]);
      await session.act({ kind: "click", target: "c9" });
      expect((await session.observe() as { visibleText: string }).visibleText).toContain("That did not work");
      await session.act({ kind: "click", target: (await session.observe() as { controls: string[] }).controls[0] });
      await session.act({ kind: "entry", path: "/third", channel: "typed-url" });
      await session.act({ kind: "click", target: "m1" });
      const record = await session.record();
      // Three counted events: pressing Enter in a form with a default button
      // dispatches that button's click and then the form's submit, exactly as
      // it does under e2e/task-depth.spec.ts, and "Back home" is one click.
      expect(record).toEqual({ completed: true, path: ["/", "/second", "/", "/third", "/mail"], actions: 3, entries: 2,
        confirmationExclusions: [] });
      expect(session.diagnostics()).toMatchObject({ entryChannels: ["typed-url", "mailed-link"], failedActions: 1,
        typedEmails: ["friend@e2e.local"] });
      expect(outsideHits).toBe(0);
    } finally { await session.close(); }
  }, 60_000);

  it("gives every session a fresh context and runs preparation before counting starts", async () => {
    const first = await openLiveSession(options({ sessionId: "a", startPath: "/cookie", prepare: async page => {
      await page.goto("/"); await page.getByRole("link", { name: "Second page" }).click();
      await page.evaluate(() => { document.cookie = "prepared=1; path=/"; });
    } }));
    const second = await openLiveSession(options({ sessionId: "b", startPath: "/cookie" }));
    try {
      const text = async (session: typeof first) => (await session.observe() as { visibleText: string }).visibleText;
      expect(await text(first)).toContain("Cookie: prepared=1");
      expect(await text(second)).toContain("Cookie: none");
      expect((await first.record()).actions).toBe(0);
      expect(first.paths()).toEqual(["/cookie"]);
    } finally { await first.close(); await second.close(); }
  }, 60_000);

  it("shows the same first view and counts actions when tsx loads the session module, as the owned launcher does", async () => {
    // tsx keeps function names by wrapping named inner functions in a
    // module-scope helper that does not exist in the page. Vitest's transform
    // does not, so the probe drives the same synthetic site from a tsx child.
    const probe = fileURLToPath(new URL("./live-browser-tsx-probe.mts", import.meta.url));
    const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", probe, origin],
      { timeout: 45_000, maxBuffer: 1024 * 1024 });
    type View = { path: string; visibleText: string; controls: string[] };
    const result = JSON.parse(stdout) as { first: View; second: View; record: unknown; diagnostics: { failedActions: number } };
    expect(result.first.path).toBe("/");
    expect(result.first.visibleText.split("\n")[0]).toBe("Page title: Home");
    expect(result.first.visibleText).not.toContain("The page is still loading.");
    expect(result.first.visibleText).toContain("# Welcome");
    expect(result.first.visibleText).toMatch(/\[c0 link\] Second page/);
    expect(result.first.visibleText).toMatch(/\[c1 text field\] Friend email/);
    expect(result.first.visibleText).toMatch(/\[c3 button\] Not yet \(disabled\)/);
    expect(result.first.controls).toEqual(["c0", "c1", "c2", "c3"]);
    const local = await openLiveSession(options());
    try { expect(result.first).toEqual(await local.observe()); } finally { await local.close(); }
    expect(result.second.path).toBe("/second");
    expect(result.second.visibleText).toContain("## Second heading");
    expect(result.diagnostics.failedActions).toBe(0);
    // One real click on "Second page", counted by the installed listener.
    expect(result.record).toEqual({ completed: true, path: ["/", "/second"], actions: 1, entries: 0, confirmationExclusions: [] });
    expect(outsideHits).toBe(0);
  }, 60_000);

  it("reads the same snapshot from its source text as from the function itself", async () => {
    // Vitest adds no `__name`, so the function form still runs here.
    const context = await browser.newContext({ baseURL: origin });
    try {
      await context.route(`${outsideOrigin}/**`, route => route.abort("blockedbyclient"));
      const [direct, sent] = [await context.newPage(), await context.newPage()];
      for (const page of [direct, sent]) await page.goto("/", { waitUntil: "domcontentloaded" });
      const expected = await direct.evaluate(snapshotDocument, CONTROL_ATTRIBUTE);
      expect(expected).toMatchObject({ title: "Home", controls: ["c0", "c1", "c2", "c3"] });
      expect(await sent.evaluate<typeof expected>(pageSource(snapshotDocument, CONTROL_ATTRIBUTE))).toEqual(expected);
      // The identity binding stays local: the page gains no global.
      expect(await sent.evaluate("typeof globalThis.__name")).toBe("undefined");
    } finally { await context.close(); }
    expect(outsideHits).toBe(0);
  }, 60_000);

  it("fails the session when the page cannot be read for any reason but a navigation", async () => {
    const session = await openLiveSession(options({ startPath: "/refusing" }));
    try {
      await expect(session.observe()).rejects.toThrow("synthetic snapshot refusal");
    } finally { await session.close(); }
  }, 60_000);

  it("treats only playwright-core's navigation messages as a page still loading", () => {
    // What playwright-core 1.62.1 gives page.evaluate when a navigation
    // replaces the document mid-read, with and without the final stop.
    for (const message of ["page.evaluate: Execution context was destroyed, most likely because of a navigation.",
      "page.evaluate: Execution context was destroyed, most likely because of a navigation"])
      expect(isNavigationRace(new Error(message))).toBe(true);
    // A page error, a closed tab and anything unprefixed must stop the session.
    for (const message of ["page.evaluate: ReferenceError: __name is not defined",
      "page.evaluate: Error: Execution context was destroyed, most likely because of a navigation",
      "page.evaluate: Target page, context or browser has been closed", "page.evaluate: Frame was detached",
      "Execution context was destroyed, most likely because of a navigation."])
      expect(isNavigationRace(new Error(message))).toBe(false);
    expect(isNavigationRace("page.evaluate: Execution context was destroyed, most likely because of a navigation.")).toBe(false);
  });

  it("windows long pages by lines and scrolls through them", () => {
    const lines = Array.from({ length: 10 }, (_, index) => `line ${index} ${"x".repeat(20)}`);
    expect(windowLines(lines, 0, 60)).toMatchObject({ start: 0, end: 2 });
    expect(windowLines(lines, 8, 60)).toMatchObject({ start: 8, end: 10 });
    expect(windowLines(["y".repeat(500)], 0, 60).lines[0]).toHaveLength(60);
  });
});
