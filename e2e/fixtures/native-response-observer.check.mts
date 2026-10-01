/** Isolated proof with real loopback HTTP and Chromium, no app or database.
 * Bundle with esbuild --bundle --packages=external --platform=node --format=esm
 * and run the resulting .mjs beside this repository's node_modules. */
import assert from "node:assert/strict";
import http from "node:http";
import { chromium } from "@playwright/test";
import { observeNativeResponses } from "../helpers/native-response-observer";

const expected = '{"status":"scanning"}';
const received: Array<{ path: string; method: string; body: string; origin?: string; site?: string }> = [];
const server = http.createServer(async (request, response) => {
  if (!request.url?.startsWith("/api/synthetic/")) {
    response.setHeader("content-type", "text/html");
    response.end('<!doctype html><title>Synthetic response observer</title><link rel="icon" href="data:,">'); return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString();
  received.push({ path: request.url, method: request.method!, body, origin: request.headers.origin,
    site: request.headers["sec-fetch-site"] as string });
  if(request.url==="/api/synthetic/put"&&request.method==="PUT") {
    response.writeHead(200,{"content-type":"application/json"});response.end('{"status":"saved"}');return;
  }
  if(request.url==="/api/synthetic/delete"&&request.method==="DELETE") {
    response.writeHead(204);response.end();return;
  }
  if(request.url==="/api/synthetic/empty204"||request.url==="/api/synthetic/empty205") {
    response.writeHead(request.url.endsWith("204")?204:205);response.end();return;
  }
  response.writeHead(202, { "content-type": "application/json" });
  response.end(body.includes("oversized") ? "x".repeat(4097) : expected);
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address(); assert(address && typeof address !== "string");
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
    const observed = await observeNativeResponses(page, { complete: "^/api/synthetic/complete$" });
    try {
      const actual = page.evaluate(async mode => {
        const response = await fetch("/api/synthetic/complete", { method: "POST",
          headers: { "content-type": "application/json" }, body: JSON.stringify({ synthetic: mode }) });
        const sameResponse = response === (window as Window & { originalReply?: Response }).originalReply;
        await response.body?.cancel();
        return { status: response.status, sameResponse };
      }, mode);
      if (mode === "normal") assert.deepEqual(await observed.read("complete"), { status: 202, text: expected });
      else await assert.rejects(observed.read("complete"), /bounded native response/);
      assert.deepEqual(await actual, { status: 202, sameResponse: true });
    } finally { await observed.dispose(); }
  }
  const two = await observeNativeResponses(page, { first: "^/api/synthetic/first$", second: "^/api/synthetic/second$" });
  try {
    await page.evaluate(async () => {
      for (const path of ["first", "second"]) {
        const response = await fetch(`/api/synthetic/${path}`, { method: "POST",
          headers: { "content-type": "application/json" }, body: JSON.stringify({ synthetic: path }) });
        if (await response.text() !== '{"status":"scanning"}') throw new Error("App response changed");
      }
    });
    for (const key of ["first", "second"]) assert.deepEqual(await two.read(key), { status: 202, text: expected });
  } finally { await two.dispose(); }
  const duplicate = await observeNativeResponses(page, { duplicate: "^/api/synthetic/duplicate$" });
  try {
    const action = () => page.evaluate(async () => {
      const response = await fetch("/api/synthetic/duplicate", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ synthetic: "duplicate" }) });
      return { status: response.status, text: await response.text(),
        sameResponse: response === (window as Window & { originalReply?: Response }).originalReply };
    });
    assert.deepEqual(await action(), { status: 202, text: expected, sameResponse: true });
    assert.deepEqual(await duplicate.read("duplicate"), { status: 202, text: expected });
    // The duplicate arrives AFTER the first response promise settled and was
    // read: rejecting that settled promise alone cannot catch this order.
    assert.deepEqual(await action(), { status: 202, text: expected, sameResponse: true });
    await assert.rejects(duplicate.read("duplicate"), /Duplicate native response observation/);
  } finally { await duplicate.dispose(); }
  for(const status of [204,205]) {
    const empty=await observeNativeResponses(page,{empty:`^/api/synthetic/empty${status}$`});
    try {
      const actual=await page.evaluate(async status=>{
        const response=await fetch(`/api/synthetic/empty${status}`,{method:"POST",
          headers:{"content-type":"application/json"},body:JSON.stringify({synthetic:`empty${status}`})});
        return {status:response.status,bytes:(await response.arrayBuffer()).byteLength,
          sameResponse:response===(window as Window & {originalReply?:Response}).originalReply};
      },status);
      assert.deepEqual(actual,{status,bytes:0,sameResponse:true});
      assert.deepEqual(await empty.read("empty"),{status,text:""});
    } finally {await empty.dispose();}
  }
  const unused = await observeNativeResponses(page, { unused: "^/api/synthetic/unused$" });
  const unusedRead = unused.read("unused"); void unusedRead.catch(() => {});
  await unused.dispose(); await assert.rejects(unusedRead, /observer disposed/);
  for(const method of ["PUT","DELETE"] as const) {
    const path=`/api/synthetic/${method.toLowerCase()}`;
    const selected=await observeNativeResponses(page,{selected:`^${path}$`},method);
    try {
      // A POST to the identical path must not satisfy the selected method.
      await page.evaluate(async path=>{const response=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({synthetic:"excluded"})});if(await response.text()!== '{"status":"scanning"}')throw new Error("Excluded request changed");},path);
      const actual=await page.evaluate(async ({path,method})=>{
        const input=new Request(path,{method,...(method==="PUT"?{headers:{"content-type":"application/json"},body:JSON.stringify({synthetic:"put"})}:{})});
        const response=await fetch(input);
        return {status:response.status,text:await response.text(),sameResponse:response===(window as Window & {originalReply?:Response}).originalReply};
      },{path,method});
      const reply=method==="PUT"?{status:200,text:'{"status":"saved"}'}:{status:204,text:""};
      assert.deepEqual(actual,{...reply,sameResponse:true});assert.deepEqual(await selected.read("selected"),reply);
    } finally {await selected.dispose();}
  }
  assert.deepEqual(received, [...["normal", "oversized", "first", "second", "duplicate", "duplicate", "empty204", "empty205"].map(mode => ({
    path: `/api/synthetic/${["normal", "oversized"].includes(mode) ? "complete" : mode}`,
    method: "POST", body: JSON.stringify({ synthetic: mode }), origin, site: "same-origin",
  })),...["PUT","DELETE"].flatMap(method=>[
    {path:`/api/synthetic/${method.toLowerCase()}`,method:"POST",body:JSON.stringify({synthetic:"excluded"}),origin,site:"same-origin"},
    {path:`/api/synthetic/${method.toLowerCase()}`,method,body:method==="PUT"?JSON.stringify({synthetic:"put"}):"",origin,site:"same-origin"},
  ])]);
  assert.equal(await page.evaluate(() => (window as Window & { fetchCalls?: number }).fetchCalls), 12);
  assert.equal(await page.evaluate(() => "__inheritNativeResponseObserver" in window), false);
  console.log("PASS native response observer: exact POST/PUT/DELETE bytes and empty 204/205, original response identity, unchanged browser headers/body, selected-method isolation, bounded rejection, multiple observations, duplicate rejection after first body settled and unused cleanup.");
} finally {
  await browser.close(); server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
