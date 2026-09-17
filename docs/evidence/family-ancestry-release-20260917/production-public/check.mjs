// Public, anonymous production checks in real Chromium. No account is created,
// no form is submitted, nothing is written. Records status, final URL, title,
// console errors, page errors, failed requests and horizontal overflow at a
// desktop and a phone viewport, plus the heading and status text a reader sees.
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
const base = process.env.BASE_URL || "https://www.inherit.bio";
const routes = ["/", "/auth/sign-in", "/privacy", "/genome/me/ancestry", "/family", "/family/invite", "/family/permissions", "/about"];
const viewports = [{ name: "desktop", width: 1280, height: 800 }, { name: "mobile", width: 390, height: 844 }];
const exe = process.env.CHROMIUM_PATH;
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: process.env.NO_PROXY } : undefined;
const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), ...(proxy ? { proxy } : {}) });
const receipt = { base, observedAt: new Date().toISOString(), chromium: browser.version(), routes: [] };
for (const route of routes) {
  for (const vp of viewports) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, javaScriptEnabled: true });
    const page = await context.newPage();
    const consoleErrors = [], pageErrors = [], failedRequests = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
    page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 300)));
    page.on("requestfailed", (r) => failedRequests.push(`${r.method()} ${r.url().slice(0, 200)} ${r.failure()?.errorText ?? ""}`));
    let status = null, serverHeaders = {};
    try {
      const response = await page.goto(base + route, { waitUntil: "networkidle", timeout: 45000 });
      status = response?.status() ?? null;
      const h = response?.headers() ?? {};
      serverHeaders = { server: h["server"], xVercelCache: h["x-vercel-cache"], xVercelId: h["x-vercel-id"] ? "present" : "absent", contentType: h["content-type"] };
    } catch (e) { pageErrors.push("navigation: " + String(e).slice(0, 300)); }
    await page.waitForTimeout(750);
    const facts = await page.evaluate(() => {
      const doc = document.documentElement;
      const h1 = document.querySelector("h1");
      const statuses = Array.from(document.querySelectorAll('[role="status"]')).map((n) => n.textContent?.trim().slice(0, 160)).filter(Boolean);
      const buildIdMatch = Array.from(document.scripts).map((s) => s.src).find((s) => s.includes("/_next/static/"));
      const buildId = buildIdMatch ? (buildIdMatch.match(/_next\/static\/([^/]+)\//) || [])[1] : null;
      return { title: document.title, h1: h1?.textContent?.trim().slice(0, 160) ?? null, statuses,
        horizontalOverflow: doc.scrollWidth > doc.clientWidth + 1, scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth,
        buildId, bodyTextLength: document.body?.innerText?.length ?? 0 };
    });
    receipt.routes.push({ route, viewport: vp.name, status, finalUrl: page.url(), ...facts, serverHeaders,
      consoleErrors, pageErrors, failedRequests: failedRequests.slice(0, 10) });
    await context.close();
  }
}
await browser.close();
const out = process.env.OUT || "receipt.json";
writeFileSync(out, JSON.stringify(receipt, null, 2));
const bad = receipt.routes.filter((r) => r.pageErrors.length || r.consoleErrors.length || r.horizontalOverflow || !(r.status && r.status < 400));
console.log(JSON.stringify({ checked: receipt.routes.length, problems: bad.map((r) => ({ route: r.route, viewport: r.viewport, status: r.status, pageErrors: r.pageErrors, consoleErrors: r.consoleErrors, overflow: r.horizontalOverflow })) }, null, 2));
