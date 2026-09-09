// R2 binding gateway. There is no public upload, listing, delete, or token API.
// Only the application's current-authority adapters mint these 30s capabilities.
const EMPTY_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const version = /^[0-9a-f]{32}$/;
const sha256 = /^[0-9a-f]{64}$/;
const base64 = value => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const decode = value => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(base64(value)));
const json = (value, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

async function authorize(request, env) {
  const authorization = request.headers.get("authorization");
  if (!authorization || authorization.length > 4096 || !authorization.startsWith("Bearer ")) throw new Error();
  const parts = authorization.slice(7).split(".");
  if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) throw new Error();
  const header = decode(parts[0]), c = decode(parts[1]);
  if (!header || header.alg !== "ES256" || header.typ !== "JWT" || !uuid.test(header.kid)
    || Object.keys(header).sort().join(",") !== "alg,kid,typ") throw new Error();
  const keys = JSON.parse(env.SIGNING_PUBLIC_KEYS);
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk || jwk.d || jwk.kty !== "EC" || jwk.crv !== "P-256") throw new Error();
  const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
    { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  if (!await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, base64(parts[2]),
    new TextEncoder().encode(parts[0] + "." + parts[1]))) throw new Error();
  const now = Math.floor(Date.now() / 1000);
  if (!c || Array.isArray(c) || Object.keys(c).some(k => !["operation","bucket","objectKey","byteCount","sha256",
    "expiresAt","providerVersion","etag","start","end","iss","aud","iat","nbf","exp"].includes(k))
    || c.iss !== env.TOKEN_ISSUER || c.aud !== "inherit-prepared-object-v1" || c.bucket !== env.BUCKET_NAME
    || !["put","get","tombstone"].includes(c.operation)
    || typeof c.objectKey !== "string" || !c.objectKey.startsWith("prepared/") || !uuid.test(c.objectKey.slice(9))
    || !Number.isSafeInteger(c.byteCount) || c.byteCount < 1 || c.byteCount > 8388608 || !sha256.test(c.sha256)
    || !Number.isSafeInteger(c.iat) || !Number.isSafeInteger(c.nbf) || c.nbf !== c.iat || c.iat > now
    || !Number.isSafeInteger(c.exp) || c.exp <= now || c.exp <= c.iat || c.exp - c.iat > 30
    || !Number.isFinite(Date.parse(c.expiresAt)) || c.exp * 1000 > Date.parse(c.expiresAt)) throw new Error();
  if (c.operation === "get") {
    if (!version.test(c.providerVersion) || !version.test(c.etag)) throw new Error();
    if (c.start !== undefined || c.end !== undefined) {
      if (!Number.isSafeInteger(c.start) || !Number.isSafeInteger(c.end) || c.start < 0
        || c.end < c.start || c.end >= c.byteCount) throw new Error();
    }
  } else if ([c.providerVersion,c.etag,c.start,c.end].some(v => v !== undefined)) throw new Error();
  return c;
}

export default {
  async fetch(request, env) {
    let c;
    try {
      const url = new URL(request.url);
      if (url.pathname !== "/artifact" || url.search) throw new Error();
      c = await authorize(request, env);
      if (request.method !== (c.operation === "get" ? "GET" : "PUT")) throw new Error();
    } catch { return new Response(null, { status: 404 }); }
    try {
      if (c.operation === "put") {
        if (request.headers.get("content-length") !== String(c.byteCount) || !request.body) return json({ error: "invalid_body" }, 400);
        // Avoid R2 cancelling an already-satisfied conditional stream early
        // (large request bodies can surface that as "Network connection lost").
        // The atomic onlyIf below remains mandatory for the race after HEAD.
        if (await env.ARTIFACTS.head(c.objectKey)) return json({ error: "already_exists" }, 409);
        // The provider checks the checksum and commits only if no object exists.
        // A permanently retained zero-byte tombstone fences even an in-flight PUT.
        const object = await env.ARTIFACTS.put(c.objectKey, request.body, {
          onlyIf: new Headers({ "If-None-Match": "*" }), sha256: c.sha256,
          httpMetadata: { contentType: "application/octet-stream", cacheControl: "no-store" },
        });
        if (!object) return json({ error: "already_exists" }, 409);
        if (object.size !== c.byteCount) return json({ error: "integrity_mismatch" }, 500);
        return json({ providerVersion: object.version, etag: object.etag, byteCount: object.size });
      }
      if (c.operation === "tombstone") {
        // No original checksum/account/source metadata survives in the marker.
        const tombstone = await env.ARTIFACTS.put(c.objectKey, new Uint8Array(), {
          customMetadata: { state: "tombstone" }, httpMetadata: { cacheControl: "no-store" },
        });
        const observed = await env.ARTIFACTS.get(c.objectKey);
        if (!observed || observed.version !== tombstone.version || observed.size !== 0
          || (await observed.arrayBuffer()).byteLength !== 0) return json({ error: "integrity_mismatch" }, 500);
        return json({ disposition: "payload-tombstoned", providerVersion: observed.version,
          etag: observed.etag, byteCount: 0, sha256: EMPTY_SHA });
      }
      const ranged = c.start !== undefined;
      const object = await env.ARTIFACTS.get(c.objectKey, ranged ? { range: { offset: c.start, length: c.end - c.start + 1 } } : undefined);
      if (!object) return new Response(null, { status: 404 });
      if (object.version !== c.providerVersion || object.etag !== c.etag || object.size !== c.byteCount) {
        await object.body.cancel(); return json({ error: "integrity_mismatch" }, 409);
      }
      const headers = { "Content-Type": "application/octet-stream", "Cache-Control": "no-store",
        "Content-Length": String(ranged ? c.end - c.start + 1 : c.byteCount),
        "X-Inherit-Object-Version": object.version, ETag: object.httpEtag };
      if (ranged) headers["Content-Range"] = `bytes ${c.start}-${c.end}/${c.byteCount}`;
      return new Response(object.body, { status: ranged ? 206 : 200, headers });
    } catch { return json({ error: "unavailable" }, 503); }
  },
};
