import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import https from "node:https";
import net from "node:net";
import { Resolver } from "node:dns/promises";
import nodeModule from "node:module";
// The installed Node declarations predate this Node 22 API. Require the actual
// runtime capability instead of silently substituting a transport implementation.
const { stripTypeScriptTypes } = nodeModule as typeof nodeModule & { stripTypeScriptTypes?: (source: string) => string };
assert(typeof stripTypeScriptTypes === "function", "Node 22 TypeScript stripping is required");
// Next resolves its server-only marker internally; it is not a standalone
// dependency. Omit exactly that marker for this isolated Node probe, retaining
// every byte of the actual classifier, resolver and pinned transport source.
const source = readFileSync("/app/src/lib/copilot/model-endpoint.ts", "utf8");
const marker = 'import "server-only";\n';
assert(source.startsWith(marker), "Unexpected model module preamble");
const probeModule = "/tmp/inherit-ci-model-endpoint.mjs";
writeFileSync(probeModule, stripTypeScriptTypes(source.slice(marker.length)), { mode: 0o600, flag: "wx" });
const { normalizeModelEndpoint, modelRuntime, resolveModelEndpoint, createPinnedModelFetch } =
  await import(probeModule) as typeof import("../../src/lib/copilot/model-endpoint");
assert(process.getuid!() > 0);
assert.equal(process.versions.node.split(".")[0], "22");
assert.match(readFileSync("/proc/self/status", "utf8"), /^CapEff:\s+0+$/m);
const gateway = process.argv[2];
const endpoint = normalizeModelEndpoint("https://model.copilot.test:8123/v1");
assert.equal(endpoint.providerClass, "cloud");
assert.equal(modelRuntime().localAllowed, false);
assert.equal((await resolveModelEndpoint(endpoint)).address, "203.0.114.10");
let count = 0;
const server = https.createServer({ key: readFileSync("/tls/fixture/model.key"), cert: readFileSync("/tls/fixture/model.crt") }, (request, response) => {
  count++; assert.equal(request.url, "/v1/chat/completions");
  response.writeHead(200, { "content-type": "application/json" }).end('{"synthetic":true}');
});
const connect = (host: string, port: number) => new Promise<boolean>(resolve => {
  const socket = net.connect({ host, port });
  const finish = (success: boolean) => { socket.destroy(); resolve(success); };
  socket.once("connect", () => finish(true)); socket.once("error", () => finish(false));
  socket.setTimeout(500, () => finish(false));
});
try {
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(8123, "203.0.114.10", resolve); });
  const response = await createPinnedModelFetch(endpoint, async () => true)(`${endpoint.baseUrl}/chat/completions`, { method: "POST", body: "{}" });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { synthetic: true });
  await assert.rejects(createPinnedModelFetch(endpoint, async () => false)(`${endpoint.baseUrl}/chat/completions`, { method: "POST", body: "{}" }), /authority_unavailable/);
  // Explicit unrelated trust anchor must not accept our ephemeral leaf.
  await assert.rejects(new Promise<void>((resolve, reject) => {
    https.get(`${endpoint.baseUrl}/chat/completions`, { ca: [] }, result => { result.resume(); resolve(); }).on("error", reject);
  }));
  assert.equal(count, 1, "Permission and TLS denials must not reach the fixture");
  assert.equal(await connect(gateway, 8000), true);
  const resolver = new Resolver({ timeout: 250, tries: 1 });
  resolver.setServers(["127.0.0.11"]);
  await assert.rejects(resolver.resolve4("blocked.invalid"));
  // These attempts occur only after DROP rules are installed. No external
  // provider is contacted; all packets to these destinations must be dropped.
  assert.deepEqual(await Promise.all([connect(gateway, 8001), connect(gateway, 5432), connect("192.0.2.1", 443), connect("2001:db8::1", 443)]), [false, false, false, false]);
  console.log("PASS isolated actual model policy, TLS, permission recheck and egress boundary");
} finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
