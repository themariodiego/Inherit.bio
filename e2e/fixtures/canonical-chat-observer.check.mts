/** Isolated observer proof: real loopback HTTP/Chromium, no app or database.
 * Bundle this entrypoint with esbuild --bundle --packages=external --platform=node
 * --format=esm, then run its .mjs output beside this repository's node_modules.
 * Avoid tsx's keepNames transform, which adds closure helpers to page.evaluate.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { chromium } from "@playwright/test";
import { observeNextChatResponse } from "./canonical-copilot-browser";

const expected = '{"error":"copilot_unavailable"}';
const received: Array<{ method: string; body: string; origin?: string; site?: string }> = [];
const server = http.createServer(async (request, response) => {
  if (request.url !== "/api/chat") {
    response.setHeader("content-type", "text/html");
    response.end('<!doctype html><title>Synthetic response observer</title><link rel="icon" href="data:,">'); return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString();
  received.push({ method: request.method!, body, origin: request.headers.origin, site: request.headers["sec-fetch-site"] as string });
  response.writeHead(403, { "content-type": "application/json" });
  response.end(body.includes("oversized") ? "x".repeat(4097) : expected);
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(origin);
  await page.evaluate(() => {
    const target = window as Window & { originalReply?: Response; fetchCalls?: number };
    const native = window.fetch;
    target.fetchCalls = 0;
    window.fetch = async (...args) => {
      target.fetchCalls!++;
      return target.originalReply = await native.apply(window, args);
    };
  });
  for (const mode of ["normal", "oversized"]) {
    const observed = await observeNextChatResponse(page);
    try {
      const actual = page.evaluate(async mode => {
        const response = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ synthetic: mode }) });
        const sameResponse = response === (window as Window & { originalReply?: Response }).originalReply;
        await response.body?.cancel();
        return { status: response.status, sameResponse };
      }, mode);
      if (mode === "normal") assert.deepEqual(await observed.read(), { status: 403, text: expected });
      else await assert.rejects(observed.read(), /bounded native chat response/);
      assert.deepEqual(await actual, { status: 403, sameResponse: true });
    } finally { await observed.dispose(); }
  }
  const unused = await observeNextChatResponse(page);
  const unusedRead = unused.read();
  void unusedRead.catch(() => {});
  await unused.dispose();
  await assert.rejects(unusedRead, /observer disposed/);
  assert.deepEqual(received, ["normal", "oversized"].map(mode => ({ method: "POST", body: JSON.stringify({ synthetic: mode }), origin, site: "same-origin" })));
  assert.equal(await page.evaluate(() => (window as Window & { fetchCalls?: number }).fetchCalls), 2);
  assert.equal(await page.evaluate(() => "__inheritChatObserver" in window), false);
  console.log("PASS native response observer: exact 403 bytes, original response returned, one native request per action, unchanged browser headers/body, size refusal and unused cleanup.");
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
