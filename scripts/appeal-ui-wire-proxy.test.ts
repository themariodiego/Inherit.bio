import { createServer, request } from "node:http";
import type { Socket } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { APPEAL_UI_ENDPOINT, APPEAL_UI_ORIGIN, createAppealUiWireProxy } from "../e2e/helpers/appeal-ui-wire-proxy";

const forwarded: { method: string | undefined; url: string | undefined; rawHeaders: string[] }[] = [];
const body = Buffer.from([0, 255, 10, 65, 194, 163]);
const sockets = new Set<Socket>();
const app = createServer((incoming, response) => {
  forwarded.push({ method: incoming.method, url: incoming.url, rawHeaders: [...incoming.rawHeaders] });
  response.writeHead(200, "Synthetic fixture", ["Content-Type", "application/octet-stream",
    "Content-Length", String(body.length), "X-Synthetic", "first", "X-Synthetic", "second",
    "Set-Cookie", "fixture-one=synthetic", "Set-Cookie", "fixture-two=synthetic"]);
  response.end(body);
});
app.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
type Proxy = Awaited<ReturnType<typeof createAppealUiWireProxy>>;
let proxy: Proxy | undefined;

function send(owned: Proxy, method: string, target: string, raw = "", headers: string[] = []) {
  return new Promise<{ status: number | undefined; statusText: string | undefined; rawHeaders: string[]; body: Buffer }>((resolve, reject) => {
    const address = new URL(owned.server);
    const outgoing = request({ hostname: address.hostname, port: address.port, method, path: target,
      headers: ["Host", "localhost:3102", "Connection", "close", ...headers] }, response => {
      const pieces: Buffer[] = [];
      response.on("data", piece => pieces.push(Buffer.from(piece)));
      response.once("error", reject);
      response.once("end", () => resolve({ status: response.statusCode, statusText: response.statusMessage,
        rawHeaders: response.rawHeaders, body: Buffer.concat(pieces) }));
    });
    outgoing.once("error", reject);
    outgoing.end(raw);
  });
}

describe.sequential("fixed-origin appeal UI wire proxy", () => {
  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      app.once("error", reject);
      app.listen(3102, "127.0.0.1", () => { app.removeListener("error", reject); resolve(); });
    });
  });
  afterEach(async () => { if (proxy) { const owned = proxy; proxy = undefined; await owned.close(); } });
  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => app.close(error => error ? reject(error) : resolve()));
  });

  it("forwards complete GET bytes and raw response pairs with the actual Host and Cookie", async () => {
    proxy = await createAppealUiWireProxy("received");
    const before = forwarded.length;
    const reply = await send(proxy, "GET", `${APPEAL_UI_ORIGIN}/synthetic?fixture=one`, "", ["Cookie", "synthetic=e2e.local"]);
    expect(reply.status).toBe(200);
    expect(reply.statusText).toBe("Synthetic fixture");
    expect(reply.body).toEqual(body);
    expect(reply.rawHeaders.slice(0, 12)).toEqual(["Content-Type", "application/octet-stream", "Content-Length", "6",
      "X-Synthetic", "first", "X-Synthetic", "second", "Set-Cookie", "fixture-one=synthetic", "Set-Cookie", "fixture-two=synthetic"]);
    expect(forwarded.length).toBe(before + 1);
    expect(forwarded[before]).toEqual({ method: "GET", url: "/synthetic?fixture=one",
      rawHeaders: ["Host", "localhost:3102", "Connection", "close", "Cookie", "synthetic=e2e.local"] });
  });

  it.each(["received", "invalid"] as const)("holds the actual POST and sends the controlled %s reply without forwarding", async outcome => {
    proxy = await createAppealUiWireProxy(outcome);
    const before = forwarded.length;
    let settled = false;
    const response = send(proxy, "POST", APPEAL_UI_ENDPOINT, '{"synthetic":true}',
      ["Content-Type", "application/json", "Origin", APPEAL_UI_ORIGIN, "Sec-Fetch-Site", "same-origin"]);
    void response.then(() => { settled = true; }, () => undefined);
    const incoming = await proxy.incoming;
    expect(incoming.url()).toBe(APPEAL_UI_ENDPOINT);
    expect(incoming.method()).toBe("POST");
    expect(await incoming.allHeaders()).toMatchObject({ origin: APPEAL_UI_ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json" });
    expect(incoming.postDataJSON()).toEqual({ synthetic: true });
    expect(settled).toBe(false);
    expect(proxy.count()).toBe(1);
    proxy.release();
    const reply = await response;
    expect(reply.status).toBe(outcome === "received" ? 202 : 422);
    expect(reply.body.toString()).toBe(outcome === "received" ? '{"status":"received"}' : '{"error":"invalid_request","issues":["request"]}');
    expect(forwarded.length).toBe(before);
  });

  it("refuses nonlocal targets, other methods and appeal query variants without forwarding", async () => {
    proxy = await createAppealUiWireProxy("received");
    const before = forwarded.length;
    for (const [method, target] of [["GET", "http://example.invalid/"], ["DELETE", APPEAL_UI_ENDPOINT],
      ["POST", `${APPEAL_UI_ENDPOINT}?variant=one`], ["POST", `${APPEAL_UI_ORIGIN}/other`]]) {
      expect((await send(proxy, method!, target!)).status).toBe(403);
    }
    expect(forwarded.length).toBe(before);
    expect(proxy.count()).toBe(0);
  });

  it("refuses CONNECT without opening a tunnel", async () => {
    proxy = await createAppealUiWireProxy("received");
    const address = new URL(proxy.server);
    const before = forwarded.length;
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const outgoing = request({ hostname: address.hostname, port: address.port, method: "CONNECT", path: "example.invalid:443" });
      outgoing.once("connect", (response, socket) => { socket.destroy(); resolve(response.statusCode); });
      outgoing.once("error", reject);
      outgoing.end();
    });
    expect(status).toBe(403);
    expect(forwarded.length).toBe(before);
  });

  it("releases a held handler and closes its owned listener without a native POST", async () => {
    proxy = await createAppealUiWireProxy("received");
    const owned = proxy, before = forwarded.length;
    const response = send(owned, "POST", APPEAL_UI_ENDPOINT, "{}");
    const terminal = Promise.allSettled([response]);
    await owned.incoming;
    await owned.close();
    proxy = undefined;
    expect((await terminal).length).toBe(1);
    await expect(send(owned, "GET", `${APPEAL_UI_ORIGIN}/synthetic`)).rejects.toMatchObject({ code: "ECONNREFUSED" });
    expect(forwarded.length).toBe(before);
    expect(owned.count()).toBe(1);
  });
});
