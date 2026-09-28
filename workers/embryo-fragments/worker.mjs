// Embryo fragment gateway: one private R2 bucket, create-only writes, exact
// version reads and permanent empty markers. There is no public upload,
// listing, delete, token or CORS interface. Only the application's
// current-authority adapters mint the 30-second capabilities it accepts, and
// their audience is not the prepared-object gateway's: neither gateway can
// reach the other's objects. Not deployed; see README.md beside this file.
const EMPTY_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const MAX_FRAGMENT_BYTES = 4004096;
const AUDIENCE = "inherit-embryo-fragment-v1";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const key = /^embryo\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const bucket = /^inherit-embryo-[a-z0-9-]{1,40}$/;
const version = /^[0-9a-f]{32}$/;
const sha256 = /^[0-9a-f]{64}$/;
const CLAIMS = ["operation", "bucket", "objectKey", "byteCount", "sha256", "expiresAt", "providerVersion", "etag",
  "iss", "aud", "iat", "nbf", "exp"];
const base64 = value => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const decode = value => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(base64(value)));
const hex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, "0")).join("");
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
  const publicKey = await crypto.subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
    { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  if (!await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, base64(parts[2]),
    new TextEncoder().encode(parts[0] + "." + parts[1]))) throw new Error();
  const now = Math.floor(Date.now() / 1000);
  if (!c || Array.isArray(c) || Object.keys(c).some(k => !CLAIMS.includes(k))
    || c.iss !== env.TOKEN_ISSUER || c.aud !== AUDIENCE
    || !bucket.test(env.BUCKET_NAME) || c.bucket !== env.BUCKET_NAME
    || !["put", "get", "tombstone"].includes(c.operation)
    || typeof c.objectKey !== "string" || !key.test(c.objectKey)
    || !Number.isSafeInteger(c.byteCount) || c.byteCount < 1 || c.byteCount > MAX_FRAGMENT_BYTES
    || typeof c.sha256 !== "string" || !sha256.test(c.sha256)
    || !Number.isSafeInteger(c.iat) || !Number.isSafeInteger(c.nbf) || c.nbf !== c.iat || c.iat > now
    || !Number.isSafeInteger(c.exp) || c.exp <= now || c.exp <= c.iat || c.exp - c.iat > 30
    || typeof c.expiresAt !== "string" || !Number.isFinite(Date.parse(c.expiresAt))
    || c.exp * 1000 > Date.parse(c.expiresAt)) throw new Error();
  if (c.operation === "get") {
    if (typeof c.providerVersion !== "string" || !version.test(c.providerVersion)
      || typeof c.etag !== "string" || !version.test(c.etag)) throw new Error();
  } else if (c.providerVersion !== undefined || c.etag !== undefined) throw new Error();
  return c;
}

// An object already at the key counts as this write only if it is exactly the
// capability's content: same size and the SHA-256 R2 verified when it was
// written. That lets a writer whose response was lost resume. A marker or any
// other content is a conflict and reveals nothing.
function identical(object, c) {
  const stored = object?.checksums?.sha256;
  return Boolean(object && stored && object.size === c.byteCount && object.customMetadata?.state !== "tombstone"
    && hex(stored) === c.sha256 && version.test(object.version) && version.test(object.etag));
}
const written = (object, created) => json({ providerVersion: object.version, etag: object.etag,
  byteCount: object.size, created });

const embryoFragmentGateway = {
  async fetch(request, env) {
    let c;
    try {
      const url = new URL(request.url);
      if (url.pathname !== "/fragment" || url.search) throw new Error();
      c = await authorize(request, env);
      if (request.method !== (c.operation === "get" ? "GET" : "PUT")) throw new Error();
    } catch { return new Response(null, { status: 404 }); }
    try {
      if (c.operation === "put") {
        if (request.headers.get("content-length") !== String(c.byteCount) || !request.body) return json({ error: "invalid_body" }, 400);
        const existing = await env.FRAGMENTS.head(c.objectKey);
        if (existing) {
          void request.body.cancel().catch(() => {});
          return identical(existing, c) ? written(existing, false) : json({ error: "already_exists" }, 409);
        }
        // The provider checks the checksum and commits only if no object exists.
        // A permanently retained empty marker fences even an in-flight PUT.
        const object = await env.FRAGMENTS.put(c.objectKey, request.body, {
          onlyIf: new Headers({ "If-None-Match": "*" }), sha256: c.sha256,
          httpMetadata: { contentType: "application/octet-stream", cacheControl: "no-store" },
        });
        if (!object) {
          const raced = await env.FRAGMENTS.head(c.objectKey);
          return identical(raced, c) ? written(raced, false) : json({ error: "already_exists" }, 409);
        }
        if (object.size !== c.byteCount) return json({ error: "integrity_mismatch" }, 500);
        return written(object, true);
      }
      if (c.operation === "tombstone") {
        // No checksum, account, cohort or source metadata survives in the marker.
        const tombstone = await env.FRAGMENTS.put(c.objectKey, new Uint8Array(), {
          customMetadata: { state: "tombstone" }, httpMetadata: { cacheControl: "no-store" },
        });
        const observed = await env.FRAGMENTS.get(c.objectKey);
        if (!observed || observed.version !== tombstone.version || observed.size !== 0
          || (await observed.arrayBuffer()).byteLength !== 0) return json({ error: "integrity_mismatch" }, 500);
        return json({ disposition: "payload-tombstoned", providerVersion: observed.version,
          etag: observed.etag, byteCount: 0, sha256: EMPTY_SHA });
      }
      const object = await env.FRAGMENTS.get(c.objectKey);
      if (!object) return new Response(null, { status: 404 });
      if (object.version !== c.providerVersion || object.etag !== c.etag || object.size !== c.byteCount) {
        await object.body.cancel(); return json({ error: "integrity_mismatch" }, 409);
      }
      return new Response(object.body, { status: 200, headers: { "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store", "Content-Length": String(c.byteCount),
        "X-Inherit-Object-Version": object.version, ETag: object.httpEtag } });
    } catch { return json({ error: "unavailable" }, 503); }
  },
};

export default embryoFragmentGateway;
