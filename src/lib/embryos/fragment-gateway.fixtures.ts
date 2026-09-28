/** Test-local stand-in for the embryo fragment bucket: an in-memory R2 binding
 * behind the real `workers/embryo-fragments` gateway. No provider, network or
 * hosted R2 is involved, and nothing here proves anything about them. Tests
 * only; production code must never import this module. */
import { createHash, generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import gateway from "../../../workers/embryo-fragments/worker.mjs";

export const EMBRYO_FIXTURE_ORIGIN = "https://embryo.fragments.test";
export const EMBRYO_FIXTURE_BUCKET = "inherit-embryo-test";
export const EMBRYO_FIXTURE_SUPABASE_URL = "https://synthetic.invalid";
export const EMBRYO_FIXTURE_ISSUER = `${EMBRYO_FIXTURE_SUPABASE_URL}/auth/v1`;

type Stored = { bytes: Uint8Array; version: string; etag: string; sha256?: string; tombstone: boolean };
type PutOptions = { onlyIf?: Headers; sha256?: string; customMetadata?: { state?: string };
  httpMetadata?: { contentType?: string; cacheControl?: string } };
const digest = (algorithm: string, bytes: Uint8Array) => createHash(algorithm).update(bytes).digest("hex");

/** The R2 binding surface the gateway uses: head, get and put with the
 * create-only condition, a verified SHA-256 checksum and custom metadata.
 * `beforeCommit` lets a test interleave another write with a PUT whose body
 * has arrived but has not committed yet. */
export function createEmbryoFragmentBinding() {
  const values = new Map<string, Stored>();
  let beforeCommit: ((key: string) => Promise<void> | void) | undefined;
  const view = (value: Stored) => ({
    version: value.version, etag: value.etag, httpEtag: `"${value.etag}"`, size: value.bytes.length,
    checksums: value.sha256 ? { sha256: Uint8Array.from(Buffer.from(value.sha256, "hex")).buffer } : {},
    customMetadata: value.tombstone ? { state: "tombstone" } : {},
    body: new Response(Uint8Array.from(value.bytes).buffer).body!,
    arrayBuffer: async () => Uint8Array.from(value.bytes).buffer,
  });
  const binding = {
    head: async (key: string) => { const value = values.get(key); return value ? view(value) : null; },
    get: async (key: string) => { const value = values.get(key); return value ? view(value) : null; },
    put: async (key: string, body: Uint8Array | ReadableStream<Uint8Array>, options: PutOptions = {}) => {
      const bytes = body instanceof Uint8Array ? Uint8Array.from(body) : new Uint8Array(await new Response(body).arrayBuffer());
      if (options.sha256 && digest("sha256", bytes) !== options.sha256) throw new Error("checksum mismatch");
      await beforeCommit?.(key);
      // No await between the condition and the commit, as R2's atomic create.
      if (options.onlyIf?.get("If-None-Match") === "*" && values.has(key)) return null;
      const value: Stored = { bytes, version: randomUUID().replaceAll("-", ""), etag: digest("md5", bytes),
        sha256: options.sha256, tombstone: options.customMetadata?.state === "tombstone" };
      values.set(key, value);
      return view(value);
    },
  };
  return { binding, values, onBeforeCommit(hook: typeof beforeCommit) { beforeCommit = hook; } };
}

/** A synthetic ES256 signer whose private JWK can be handed to the app's
 * minting code through INHERIT_UPLOAD_SIGNING_JWK, and whose public half is
 * what the gateway trusts. */
export function createEmbryoFixtureSigner() {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" }), kid = randomUUID();
  const privateJwk = { ...(pair.privateKey.export({ format: "jwk" }) as Record<string, string>), kid };
  const publicJwk = { ...(pair.publicKey.export({ format: "jwk" }) as Record<string, string>), kid };
  return { kid, privateKey: pair.privateKey as KeyObject, privateJwk, publicJwk };
}

/** The real gateway over the in-memory binding. `fetch` answers only the
 * fixture origin, as a stubbed global fetch would route it. */
export function createEmbryoFragmentGateway(publicJwk: Record<string, string>) {
  const store = createEmbryoFragmentBinding();
  const env = { FRAGMENTS: store.binding, BUCKET_NAME: EMBRYO_FIXTURE_BUCKET, TOKEN_ISSUER: EMBRYO_FIXTURE_ISSUER,
    SIGNING_PUBLIC_KEYS: JSON.stringify([publicJwk]) };
  return {
    ...store, env,
    fetch: (request: Request) => gateway.fetch(request, env),
  };
}
