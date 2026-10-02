import assert from "node:assert/strict";
import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseSigningKeys, type PublicSigningKey } from "./cloudflare-deploy-guard";

/** Offline TEST-LOCAL source validation; this never deploys or acknowledges storage. */
export const EMBRYO_GATEWAY_CONFIG = "workers/embryo-fragments/wrangler.json";
export const PREVIEW_JWKS_URL = "https://inherit-5ggisi9fd-mariodiego.vercel.app/.well-known/inherit-upload-jwks.json";
export const PREVIEW_EMBRYO_ORIGIN = "https://inherit-embryo-fragments-preview.mariodiego-dev.workers.dev";

export function expectedEmbryoGatewayConfig(signingPublicKeys: string) {
  return {
    name: "inherit-embryo-fragments", main: "worker.mjs",
    account_id: "165b6ad801f990d009e90b64b39f87dd", compatibility_date: "2026-09-08",
    workers_dev: false, preview_urls: false, routes: [], observability: { enabled: false },
    vars: { BUCKET_NAME: "", TOKEN_ISSUER: "", SIGNING_PUBLIC_KEYS: "[]" }, r2_buckets: [],
    env: { preview: {
      name: "inherit-embryo-fragments-preview", workers_dev: true, preview_urls: false,
      routes: [], observability: { enabled: false },
      vars: { BUCKET_NAME: "inherit-embryo-preview",
        TOKEN_ISSUER: "https://iofjhrtcyawjjhuxbgfd.supabase.co/auth/v1", SIGNING_PUBLIC_KEYS: signingPublicKeys },
      r2_buckets: [{ binding: "FRAGMENTS", bucket_name: "inherit-embryo-preview" }],
    } },
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function publicKeys(value: unknown): PublicSigningKey[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error();
  const keys = parseSigningKeys(JSON.stringify(value), "preview public list");
  if (new Set(keys.map(key => key.kid)).size !== keys.length) throw new Error();
  for (const item of value) {
    if (!record(item) || Object.keys(item).some(key => !["kty", "crv", "kid", "x", "y", "alg", "use"].includes(key))
      || (item.alg !== undefined && item.alg !== "ES256") || (item.use !== undefined && item.use !== "sig")) throw new Error();
    for (const coordinate of [item.x, item.y]) {
      if (typeof coordinate !== "string" || Buffer.from(coordinate, "base64url").toString("base64url") !== coordinate) throw new Error();
    }
    createPublicKey({ key: item, format: "jwk" });
  }
  return keys.sort((left, right) => left.kid.localeCompare(right.kid));
}

export interface PreviewSourceInput {
  target: string;
  config: unknown;
  /** Independently fetched public content; access, freshness and provenance are separately proved. */
  jwks: unknown;
}

export function embryoPreviewSourceFailures(input: PreviewSourceInput): string[] {
  if (input.target !== "preview") return ["Only the preview TEST-LOCAL source may be qualified; production remains held"];
  let committed: unknown;
  try {
    const candidate: unknown = structuredClone(input.config);
    if (!record(candidate) || !record(candidate.env) || !record(candidate.env.preview)
      || !record(candidate.env.preview.vars) || typeof candidate.env.preview.vars.SIGNING_PUBLIC_KEYS !== "string") throw new Error();
    const text = candidate.env.preview.vars.SIGNING_PUBLIC_KEYS;
    candidate.env.preview.vars.SIGNING_PUBLIC_KEYS = "[]";
    assert.deepEqual(candidate, expectedEmbryoGatewayConfig("[]"));
    committed = JSON.parse(text);
  } catch { return ["Preview configuration must have the exact closed account, issuer, bucket, routes and production-empty shape"]; }
  let keys: PublicSigningKey[], served: PublicSigningKey[];
  try {
    keys = publicKeys(committed);
    if (!record(input.jwks) || Object.keys(input.jwks).join(",") !== "keys") throw new Error();
    served = publicKeys(input.jwks.keys);
  } catch { return ["Both signing lists must be nonempty unique public P-256 keys, with no private or unknown fields"]; }
  try { assert.deepEqual(keys, served); }
  catch { return ["Preview public signing identities must exactly match the independently obtained current app JWKS"]; }
  return [];
}

function main() {
  const [target, jwksFile] = process.argv.slice(2);
  if (process.argv.length !== 4 || target !== "preview" || !jwksFile) throw new Error("Use preview and a separately verified public JWKS file");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const failures = embryoPreviewSourceFailures({ target,
    config: JSON.parse(readFileSync(path.join(root, EMBRYO_GATEWAY_CONFIG), "utf8")),
    jwks: JSON.parse(readFileSync(jwksFile, "utf8")) });
  if (failures.length) throw new Error(failures.join("; "));
  console.log("Preview TEST-LOCAL source guard passed; deployment, service readiness and hosted storage acknowledgement remain unproved");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(); }
  catch { console.error("Preview source guard refused; check the closed source and independently verified public JWKS"); process.exitCode = 1; }
}
