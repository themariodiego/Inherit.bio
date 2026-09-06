/** Local production-browser proof with the installed Storage provider.
 * Run: node --import tsx scripts/run-upload-browser.mts
 * No key files, Auth rotation, database resets or application test switches.
 * The browser's HTTP proxy routes Storage to an isolated provider process;
 * the app continues using the normal local stack and its identical DB/backend.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import http, { type IncomingMessage } from "node:http";
import { createInterface } from "node:readline";

assert(!process.env.VERCEL && !process.env.CI, "Manual local Docker browser proof only");
assert(!process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK,
  "Loopback proxying must remain enabled");
const project = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8")
  .match(/^project_id = "([A-Za-z0-9_-]+)"$/m)?.[1];
assert(project, "Exact local project ID required");
const policy = execFileSync("docker", ["exec", "-i", `supabase_db_${project}`,
  "psql", "-XAtq", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], {
  input: "select json_build_object('issuer',auth_issuer,'array',maximum_array_bytes,'vcf',maximum_vcf_bytes,'account',maximum_account_bytes,'active',maximum_active_uploads) from private.upload_authorization_config where singleton;",
  encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 15_000,
}).trim();
const limits = JSON.parse(policy);
assert.equal(limits.issuer, "http://127.0.0.1:54321/auth/v1", "Existing local issuer must match; never changed here");
for (const key of ["array", "vcf", "account", "active"]) {
  assert(Number.isSafeInteger(limits[key]) && limits[key] > 0, "Existing server capacity policy required");
}
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const kid = randomUUID();
const signer = JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid });
const publicJwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig" };

// Provider credentials remain inside the container. Request Authorization is
// forwarded unchanged: neither the proxy nor this child grants permission.
const providerCode = String.raw`
const readline=require('node:readline');
const http=require('node:http');
const lines=readline.createInterface({input:process.stdin});
let app,origin;
const emit=(id,result)=>process.stdout.write('INHERIT_BROWSER_PROVIDER:'+JSON.stringify({id,result})+'\n');
lines.on('line',async line=>{
 let message;
 try{
  message=JSON.parse(line);
  if(message.init){
   const prior=JSON.parse(process.env.JWT_JWKS||'{"keys":[]}');
   process.env.JWT_JWKS=JSON.stringify({keys:[...prior.keys,message.init]});
   process.env.LOG_LEVEL='silent';
   process.env.PG_QUEUE_ENABLE='false';
   app=require('/app/dist/app.js').default({logger:false});
   origin=await app.listen({host:'127.0.0.1',port:0});
   emit(message.id,{ready:true});return;
  }
  if(message.close){await app.close();emit(message.id,{closed:true});process.exit(0);}
  if(!origin||!message.path.startsWith('/')||message.path.startsWith('//'))throw new Error('Invalid request');
  const result=await new Promise((resolve,reject)=>{
   const request=http.request(origin+message.path,{method:message.method,headers:message.headers},response=>{
    const chunks=[];let size=0;
    response.on('data',chunk=>{size+=chunk.length;if(size>67108864){response.destroy();reject(new Error('Response too large'));}else chunks.push(chunk);});
    response.on('error',reject);
    response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks).toString('base64')}));
   });
   request.on('error',reject);request.setTimeout(30000,()=>request.destroy(new Error('Request timed out')));
   request.end(Buffer.from(message.body,'base64'));
  });
  emit(message.id,result);
 }catch{emit(message?.id,{error:true});}
});
lines.on('close',async()=>{if(app)await app.close();process.exit(0);});
`;
const provider = spawn("docker", ["exec", "-i", `supabase_storage_${project}`, "node", "-e", providerCode],
  { stdio: ["pipe", "pipe", "pipe"] });
provider.stderr.resume(); // Never print provider logs or request credentials.
const reader = createInterface({ input: provider.stdout });
type ProviderResult = { ready?: boolean; closed?: boolean; error?: boolean;
  status?: number; headers?: http.OutgoingHttpHeaders; body?: string };
const pending = new Map<number, { resolve: (result: ProviderResult) => void;
  reject: (error: Error) => void; timer: NodeJS.Timeout }>();
let sequence = 0;
reader.on("line", line => {
  if (!line.startsWith("INHERIT_BROWSER_PROVIDER:")) return;
  const { id, result } = JSON.parse(line.slice("INHERIT_BROWSER_PROVIDER:".length));
  const request = pending.get(id);
  if (request) { clearTimeout(request.timer); pending.delete(id); request.resolve(result); }
});
provider.on("close", () => {
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Local provider exited")); }
  pending.clear();
});
function requestProvider(message: Record<string, unknown>): Promise<ProviderResult> {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("Local provider timeout")); }, 40_000);
    pending.set(id, { resolve, reject, timer });
    provider.stdin.write(JSON.stringify({ id, ...message }) + "\n");
  });
}
async function requestBytes(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const bytes of request) {
    size += bytes.length;
    assert(size <= 52_428_800, "Browser proof body exceeds local Storage capacity");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
function cleanHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const result = { ...headers };
  for (const key of ["connection", "proxy-connection", "proxy-authorization", "keep-alive", "transfer-encoding", "upgrade"]) delete result[key];
  return result;
}
async function gatewayCors(target: URL, origin: string, method: string, headers: http.IncomingHttpHeaders) {
  // CORS belongs to the real local gateway, not Storage's internal app. Read
  // its current preflight policy; do not invent a broader allowlist here.
  const preflight = await fetch(target, { method: "OPTIONS", redirect: "error",
    signal: AbortSignal.timeout(5000), headers: { Origin: origin,
      "Access-Control-Request-Method": method,
      "Access-Control-Request-Headers": Object.keys(headers).filter(name =>
        !["host", "origin", "connection", "content-length", "accept", "accept-encoding", "accept-language", "user-agent", "referer"].includes(name)
        && !name.startsWith("sec-")).join(","),
    } });
  assert(preflight.ok, "Local gateway preflight refused");
  const result: http.OutgoingHttpHeaders = {};
  for (const [name, value] of preflight.headers) {
    if (name.startsWith("access-control-") || name === "vary") result[name] = value;
  }
  return result;
}
let forwardedUploads = 0;
const proxy = http.createServer(async (request, response) => {
  try {
    const target = new URL(request.url ?? "");
    const allowed = ["http://127.0.0.1:54321", "http://localhost:3100", "http://localhost:3101"];
    if (!allowed.includes(target.origin) || target.username || target.password) {
      response.writeHead(403); response.end("Local test proxy destination refused"); return;
    }
    const headers = cleanHeaders(request.headers);
    if (target.origin === allowed[0] && target.pathname.startsWith("/storage/v1/") && request.method !== "OPTIONS") {
      const bytes = await requestBytes(request);
      headers["content-length"] = String(bytes.length);
      const result = await requestProvider({ method: request.method,
        path: target.pathname.slice("/storage/v1".length) + target.search,
        headers, body: bytes.toString("base64") });
      assert(!result.error && result.status && result.headers && result.body !== undefined,
        "Installed provider did not return an HTTP response");
      const output = Buffer.from(result.body, "base64");
      const responseHeaders = cleanHeaders(result.headers as http.IncomingHttpHeaders);
      if (request.headers.origin) {
        Object.assign(responseHeaders, await gatewayCors(target, request.headers.origin, request.method ?? "GET", request.headers));
      }
      responseHeaders["content-length"] = String(output.length);
      if (request.method === "POST" && /^\/storage\/v1\/object\/genomes\/[0-9a-f-]{36}$/.test(target.pathname)
        && result.status >= 200 && result.status < 300) forwardedUploads++;
      response.writeHead(result.status, responseHeaders); response.end(output);
      return;
    }
    // Ordinary Auth, app and PostgREST traffic reaches its unchanged endpoint.
    const upstream = http.request(target, { method: request.method, headers }, incoming => {
      response.writeHead(incoming.statusCode ?? 502, incoming.headers);
      incoming.pipe(response);
    });
    upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    upstream.setTimeout(60_000, () => upstream.destroy());
    request.pipe(upstream);
  } catch {
    if (!response.headersSent) response.writeHead(502);
    response.end("Local provider request failed");
  }
});
proxy.on("connect", (_request, socket) => socket.destroy()); // No external TLS tunnel.
let tests: ChildProcess | undefined;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (tests?.exitCode === null) tests.kill("SIGTERM");
  proxy.closeAllConnections();
  await new Promise<void>(resolve => proxy.close(() => resolve()));
  if (provider.exitCode === null) {
    await requestProvider({ close: true }).catch(() => {});
    provider.stdin.end();
  }
  reader.close();
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void stop().finally(() => process.exit(1)); });
}
try {
  assert((await requestProvider({ init: publicJwk })).ready, "Installed provider did not start");
  await new Promise<void>((resolve, reject) => {
    proxy.once("error", reject); proxy.listen(0, "127.0.0.1", resolve);
  });
  const address = proxy.address();
  assert(address && typeof address !== "string");
  // Check the gateway boundary before paying for a production build. A
  // deliberately invalid upload must remain refused by the actual provider,
  // while its CORS response follows the unchanged gateway's policy.
  for (const method of ["OPTIONS", "POST"]) {
    const boundary = await new Promise<{ status: number; origin?: string; allowedHeaders?: string }>((resolve, reject) => {
      const request = http.request({ hostname: "127.0.0.1", port: address.port, method,
        path: "http://127.0.0.1:54321/storage/v1/object/genomes/00000000-0000-4000-8000-000000000001",
        headers: { Origin: "http://localhost:3100", "Content-Length": "0",
          "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "apikey,authorization,content-type,x-upsert" } }, response => {
        response.resume(); response.on("end", () => resolve({ status: response.statusCode ?? 0,
          origin: response.headers["access-control-allow-origin"] as string | undefined,
          allowedHeaders: response.headers["access-control-allow-headers"] as string | undefined }));
      });
      request.on("error", reject); request.setTimeout(5000, () => request.destroy(new Error("Proxy boundary timeout"))); request.end();
    });
    assert(method === "OPTIONS" ? boundary.status === 200 : boundary.status >= 400 && boundary.status < 500,
      "Proxy must preserve actual gateway/provider HTTP decisions");
    const policy = await gatewayCors(new URL("http://127.0.0.1:54321/storage/v1/object/genomes/00000000-0000-4000-8000-000000000001"),
      "http://localhost:3100", "POST", {});
    assert.equal(boundary.origin, policy["access-control-allow-origin"], "Proxy must preserve gateway CORS policy");
    if (method === "OPTIONS") {
      const allowedHeaders = boundary.allowedHeaders?.toLowerCase().split(",").map(header => header.trim()) ?? [];
      assert(allowedHeaders.includes("apikey") || allowedHeaders.includes("*"),
        "The actual local gateway must allow the browser's public API-key header");
    }
  }
  console.log("Real local Storage browser proxy ready; issuer and Auth keys unchanged.");
  tests = spawn("corepack", ["pnpm", "exec", "playwright", "test", "--config=playwright.upload.config.ts"], {
    stdio: "inherit", env: { ...process.env, INHERIT_UPLOAD_SIGNING_JWK: signer,
      INHERIT_LOCAL_BROWSER_STORAGE_PROXY: `http://127.0.0.1:${address.port}` },
  });
  const code = await new Promise<number>(resolve => {
    tests!.once("error", () => resolve(1)); tests!.once("exit", code => resolve(code ?? 1));
  });
  assert.equal(code, 0, "Positive upload browser suite failed");
  assert(forwardedUploads > 0, "No browser upload crossed the actual provider proxy");
  console.log(`PASS ${forwardedUploads} browser upload(s) reached the installed provider through the loopback proxy.`);
} finally {
  await stop();
}
