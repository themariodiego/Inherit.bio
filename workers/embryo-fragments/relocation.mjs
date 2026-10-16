// Exact locked bind/attempt locators only. Distinct audience; no request body,
// listing, client source path or fragment-writing authority.
const AUDIENCE = "inherit-subject-relocation-v1", MAX_BYTES = 4004096;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuid = new RegExp(`^${UUID}$`), oldKey = new RegExp(`^embryo/${UUID}$`);
const version = /^[0-9a-f]{32}$/, hash = /^[0-9a-f]{64}$/;
const EMPTY_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const EMPTY_ETAG = "d41d8cd98f00b204e9800998ecf8427e";
const claims = ["operation", "bindingId", "relocationId", "attemptId", "accountId", "bucket", "oldKey",
  "oldVersion", "oldEtag", "newKey", "byteCount", "sha256", "newVersion", "newEtag", "expiresAt",
  "iss", "aud", "iat", "nbf", "exp"];
const base64 = value => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const decode = value => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(base64(value)));
const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
const json = (value, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
async function authorize(request, env) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ") || header.length > 4096) throw new Error();
  const parts = header.slice(7).split(".");
  if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) throw new Error();
  const h = decode(parts[0]), c = decode(parts[1]);
  if (!h || h.alg !== "ES256" || h.typ !== "JWT" || typeof h.kid !== "string" || !uuid.test(h.kid)
    || Object.keys(h).sort().join(",") !== "alg,kid,typ") throw new Error();
  const jwk = JSON.parse(env.SIGNING_PUBLIC_KEYS).find(k => k.kid === h.kid);
  if (!jwk || jwk.d || jwk.kty !== "EC" || jwk.crv !== "P-256") throw new Error();
  const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
    { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  if (!await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, base64(parts[2]),
    new TextEncoder().encode(parts[0] + "." + parts[1]))) throw new Error();
  const now = Math.floor(Date.now() / 1000);
  if (!c || Array.isArray(c) || Object.keys(c).some(k => !claims.includes(k))
    || c.iss !== env.TOKEN_ISSUER || c.aud !== AUDIENCE || c.bucket !== env.BUCKET_NAME
    || !/^inherit-embryo-[a-z0-9-]{1,40}$/.test(c.bucket)
    || !["copy", "get", "dispose-old", "dispose-new"].includes(c.operation)
    || ["bindingId", "relocationId", "attemptId", "accountId"].some(k => typeof c[k] !== "string" || !uuid.test(c[k]))
    || typeof c.oldKey !== "string" || !oldKey.test(c.oldKey)
    || ["oldVersion", "oldEtag"].some(k => typeof c[k] !== "string" || !version.test(c[k]))
    || c.newKey !== `claimant/${c.accountId}/${c.attemptId}`
    || !Number.isSafeInteger(c.byteCount) || c.byteCount < 1 || c.byteCount > MAX_BYTES
    || typeof c.sha256 !== "string" || !hash.test(c.sha256)
    || !Number.isSafeInteger(c.iat) || !Number.isSafeInteger(c.nbf) || c.nbf !== c.iat || c.iat > now
    || !Number.isSafeInteger(c.exp) || c.exp <= now || c.exp <= c.iat || c.exp - c.iat > 30
    || typeof c.expiresAt !== "string" || !Number.isFinite(Date.parse(c.expiresAt))
    || c.exp * 1000 > Date.parse(c.expiresAt)) throw new Error();
  if (["get", "dispose-old"].includes(c.operation)) {
    if (["newVersion", "newEtag"].some(k => typeof c[k] !== "string" || !version.test(c[k]))) throw new Error();
  } else if (c.newVersion !== undefined || c.newEtag !== undefined) throw new Error();
  return c;
}
function exact(object, c, providerVersion, etag) {
  return Boolean(object && object.size === c.byteCount && object.version === providerVersion && object.etag === etag
    && object.customMetadata?.state !== "tombstone" && object.checksums?.sha256 && hex(object.checksums.sha256) === c.sha256);
}
async function complete(object, c) {
  const reader = object.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength; if (size > c.byteCount) throw new Error(); chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (size !== c.byteCount) throw new Error();
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (hex(await crypto.subtle.digest("SHA-256", bytes)) !== c.sha256) throw new Error();
  return bytes;
}
async function marker(binding, key, current) {
  let written = current;
  if (!(current?.customMetadata?.state === "tombstone" && current.size === 0 && current.etag === EMPTY_ETAG))
    written = await binding.put(key, new Uint8Array(), {
      customMetadata: { state: "tombstone" }, httpMetadata: { cacheControl: "no-store" },
    });
  const observed = await binding.get(key);
  if (!written || !observed || observed.version !== written.version || observed.etag !== EMPTY_ETAG
    || observed.size !== 0 || (await observed.arrayBuffer()).byteLength !== 0) throw new Error();
  return json({ disposition: "payload-tombstoned", providerVersion: observed.version,
    etag: EMPTY_ETAG, byteCount: 0, sha256: EMPTY_SHA });
}
const relocationGateway = {
  async fetch(request, env) {
    let c;
    try {
      const url = new URL(request.url);
      if (url.pathname !== "/relocation" || url.search) throw new Error();
      c = await authorize(request, env);
      if (request.method !== (c.operation === "get" ? "GET" : "PUT") || request.body) throw new Error();
    } catch { return new Response(null, { status: 404 }); }
    try {
      if (c.operation === "copy") {
        const source = await env.FRAGMENTS.get(c.oldKey);
        if (!exact(source, c, c.oldVersion, c.oldEtag)) { await source?.body?.cancel(); return json({ error: "unavailable" }, 409); }
        const bytes = await complete(source, c);
        if (c.exp <= Math.floor(Date.now() / 1000)) return new Response(null, { status: 404 });
        let object = await env.FRAGMENTS.head(c.newKey);
        if (!object) object = await env.FRAGMENTS.put(c.newKey, bytes, {
          onlyIf: new Headers({ "If-None-Match": "*" }), sha256: c.sha256,
          httpMetadata: { contentType: "application/octet-stream", cacheControl: "no-store" },
        }) ?? await env.FRAGMENTS.head(c.newKey);
        if (!object || !exact(object, c, object.version, object.etag)) return json({ error: "unavailable" }, 409);
        return json({ providerVersion: object.version, etag: object.etag, byteCount: object.size });
      }
      if (c.operation === "get") {
        const object = await env.FRAGMENTS.get(c.newKey);
        if (!exact(object, c, c.newVersion, c.newEtag)) { await object?.body?.cancel(); return json({ error: "unavailable" }, 409); }
        return new Response(object.body, { status: 200, headers: { "Cache-Control": "no-store",
          "Content-Type": "application/octet-stream", "Content-Length": String(c.byteCount),
          "X-Inherit-Object-Version": object.version, ETag: object.httpEtag } });
      }
      const key = c.operation === "dispose-old" ? c.oldKey : c.newKey;
      const current = await env.FRAGMENTS.head(key);
      if (c.operation === "dispose-old" && current?.customMetadata?.state !== "tombstone"
        && !exact(current, c, c.oldVersion, c.oldEtag)) return json({ error: "unavailable" }, 409);
      // Only a terminal SQL disposition mints this capability. Permanent
      // markers fence every late create-only write after an attempt drains.
      return await marker(env.FRAGMENTS, key, current);
    } catch { return json({ error: "unavailable" }, 503); }
  },
};
export default relocationGateway;
