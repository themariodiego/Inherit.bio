/** Small real HTTP/Chromium probe before a production build. No app, Auth,
 * Storage object or mock Storage response is used. It proves browser contexts
 * and APIRequest/route.fetch take their intended transports without rewriting
 * the caller's Origin, Sec-Fetch-Site, Authorization or cookie headers.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { chromium, request as playwrightRequest } from "@playwright/test";
import { chromiumStorageProxyArgs } from "./local-storage-browser-config";

export async function verifyBrowserTransport(proxy: string, forwarded: () => number): Promise<void> {
  const origin = "http://localhost:3100";
  const marker = "Bearer synthetic-local-transport";
  const server = http.createServer(async (request, response) => {
    if (request.url === "/__inherit_transport_page") {
      response.setHeader("content-type", "text/html");
      response.end('<!doctype html><html><head><link rel="icon" href="data:,"></head><body>Local transport fixture</body></html>');
      return;
    }
    if (!request.url?.startsWith("/__inherit_transport_")) { response.writeHead(404); response.end(); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ method: request.method, origin: request.headers.origin ?? null,
      site: request.headers["sec-fetch-site"] ?? null, authorizationUnchanged: request.headers.authorization === marker,
      cookieUnchanged: request.headers.cookie === "inherit_transport=synthetic",
      bodyUnchanged: Buffer.concat(chunks).toString() === "synthetic transport body" }));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(3100, resolve); });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let standalone: Awaited<ReturnType<typeof playwrightRequest.newContext>> | undefined;
  try {
    browser = await chromium.launch({ args: chromiumStorageProxyArgs(proxy) });
    for (const name of ["regular", "manual-context"]) {
      const context = await browser.newContext({ baseURL: origin });
      await context.addCookies([{ name: "inherit_transport", value: "synthetic", url: origin }]);
      const page = await context.newPage();
      await page.goto("/__inherit_transport_page");
      const beforeBrowser = forwarded();
      const result = await page.evaluate(async ({ name, marker }) => {
        const response = await fetch(`/__inherit_transport_${name}`, { method: "POST",
          headers: { authorization: marker }, body: "synthetic transport body" });
        return response.json();
      }, { name, marker });
      assert.deepEqual(result, { method: "POST", origin, site: "same-origin", authorizationUnchanged: true,
        cookieUnchanged: true, bodyUnchanged: true }, "Native browser headers/body must reach the real HTTP receiver unchanged");
      assert(forwarded() > beforeBrowser, "Every browser context must actually use the loopback proxy");

      const beforeApi = forwarded();
      const api = await page.request.post("/__inherit_transport_api", {
        headers: { authorization: marker }, data: "synthetic transport body",
      });
      assert.deepEqual(await api.json(), { method: "POST", origin: null, site: null, authorizationUnchanged: true,
        cookieUnchanged: true, bodyUnchanged: true }, "APIRequest must retain cookies without invented browser-origin headers");
      assert.equal(forwarded(), beforeApi, "APIRequest must remain direct HTTP, without a CONNECT proxy");

      await page.route("**/__inherit_transport_fetch", async route => route.fulfill({ response: await route.fetch() }));
      const beforeFetch = forwarded();
      const fetched = await page.evaluate(async marker => {
        const response = await fetch("/__inherit_transport_fetch", { method: "POST",
          headers: { authorization: marker }, body: "synthetic transport body" });
        return response.json();
      }, marker);
      // Chromium has not attached Sec-Fetch-Site at this interception stage.
      // Record that real limitation; never invent it in the transport. A
      // guarded browser-origin mutation must use native fetch in its spec.
      assert.deepEqual(fetched, { method: "POST", origin, site: null, authorizationUnchanged: true,
        cookieUnchanged: true, bodyUnchanged: true }, "route.fetch preserves its observed headers without manufacturing Sec-Fetch-Site");
      assert.equal(forwarded(), beforeFetch, "route.fetch must use direct APIRequest transport");
      await context.close();
    }
    standalone = await playwrightRequest.newContext({ baseURL: origin });
    const beforeStandalone = forwarded();
    const direct = await standalone.post("/__inherit_transport_standalone", {
      headers: { authorization: marker }, data: "synthetic transport body",
    });
    assert.deepEqual(await direct.json(), { method: "POST", origin: null, site: null, authorizationUnchanged: true,
      cookieUnchanged: false, bodyUnchanged: true }, "Standalone APIRequest preserves its own independent identity");
    assert.equal(forwarded(), beforeStandalone, "Standalone APIRequest must remain direct HTTP");
  } finally {
    await standalone?.dispose();
    await browser?.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
