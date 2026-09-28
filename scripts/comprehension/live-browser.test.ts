import http from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openLiveSession, windowLines, type LiveSessionOptions } from "./live-browser";

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

  it("windows long pages by lines and scrolls through them", () => {
    const lines = Array.from({ length: 10 }, (_, index) => `line ${index} ${"x".repeat(20)}`);
    expect(windowLines(lines, 0, 60)).toMatchObject({ start: 0, end: 2 });
    expect(windowLines(lines, 8, 60)).toMatchObject({ start: 8, end: 10 });
    expect(windowLines(["y".repeat(500)], 0, 60).lines[0]).toHaveLength(60);
  });
});
