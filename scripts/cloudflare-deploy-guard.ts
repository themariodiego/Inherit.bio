import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Deploy-time guard for the Cloudflare Workers (ADR-0030). It runs in
 * `.github/workflows/deploy-cloudflare.yml` before wrangler does, and answers
 * the two questions the configuration files cannot answer about themselves:
 *
 *  1. Is the production gateway about to be deployed with no signing keys?
 *     `SIGNING_PUBLIC_KEYS` ships as `"[]"` so that a gateway deployed before
 *     the keys are known accepts nothing. Deploying production that way is a
 *     wasted deploy at best and a false "hosted" signal at worst, so it is
 *     refused.
 *  2. Are the committed production keys the ones the app actually signs with?
 *     The app serves the public half of its upload signer at
 *     `/.well-known/inherit-upload-jwks.json`. Every committed key must match
 *     a served key on `kid`, `x` and `y`. A gateway trusting a key the app
 *     does not use either accepts nothing or accepts something else; neither
 *     is a deployment worth making. A 404 is a failure like any other: the
 *     route not existing yet is exactly the case the comparison must catch.
 *
 * A preview deploy skips both: the preview gateway may legitimately ship
 * without keys, and there is no preview JWKS to compare against. Its keys are
 * still parsed, so a malformed list fails there too.
 *
 * The guard reads no secret and prints only key ids, which are public.
 */

export const GATEWAY_CONFIG = "workers/prepared-artifacts/wrangler.json";
export const PRODUCTION_JWKS_URL = "https://www.inherit.bio/.well-known/inherit-upload-jwks.json";
export type DeployTarget = "production" | "preview";

export interface PublicSigningKey {
  kid: string;
  x: string;
  y: string;
}

/** The gateway's own requirement (workers/prepared-artifacts/worker.mjs): a version-4 uuid. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** A P-256 coordinate in base64url, as the upload signer's own schema accepts it. */
const COORDINATE = /^[A-Za-z0-9_-]{43}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function publicKey(key: unknown, where: string): PublicSigningKey {
  if (!isRecord(key)) throw new Error(`${where} is not an object`);
  if (key.kty !== "EC" || key.crv !== "P-256") throw new Error(`${where} is not a P-256 EC key`);
  if (typeof key.kid !== "string" || !UUID.test(key.kid)) throw new Error(`${where} has no version-4 uuid kid`);
  if (typeof key.x !== "string" || typeof key.y !== "string" || !COORDINATE.test(key.x) || !COORDINATE.test(key.y)) {
    throw new Error(`${where} (kid ${key.kid}) has malformed coordinates`);
  }
  if ("d" in key) throw new Error(`${where} (kid ${key.kid}) carries a private component`);
  return { kid: key.kid, x: key.x, y: key.y };
}

/** The keys a `SIGNING_PUBLIC_KEYS` value commits the gateway to. */
export function parseSigningKeys(text: string, source: string): PublicSigningKey[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${source}: SIGNING_PUBLIC_KEYS is not JSON`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${source}: SIGNING_PUBLIC_KEYS is not an array`);
  return parsed.map((key, index) => publicKey(key, `${source}: key ${index}`));
}

/** The keys the gateway configuration commits for one target. */
export function committedSigningKeys(config: unknown, target: DeployTarget): PublicSigningKey[] {
  if (!isRecord(config)) throw new Error(`${GATEWAY_CONFIG} is not a JSON object`);
  const scope = target === "production" ? config : isRecord(config.env) ? config.env.preview : undefined;
  if (!isRecord(scope) || !isRecord(scope.vars) || typeof scope.vars.SIGNING_PUBLIC_KEYS !== "string") {
    throw new Error(`${GATEWAY_CONFIG} has no SIGNING_PUBLIC_KEYS string for ${target}`);
  }
  return parseSigningKeys(scope.vars.SIGNING_PUBLIC_KEYS, `${GATEWAY_CONFIG} (${target})`);
}

/** The keys a served JWKS document carries: the standard `{ keys: [...] }`, or a bare array. */
export function servedSigningKeys(document: unknown): PublicSigningKey[] {
  const keys = Array.isArray(document) ? document
    : isRecord(document) && Array.isArray(document.keys) ? document.keys : undefined;
  if (!keys) throw new Error("served JWKS is neither { keys: [...] } nor an array");
  return keys.map((key, index) => publicKey(key, `served key ${index}`));
}

export interface GuardInput {
  target: DeployTarget;
  config: unknown;
  fetchJwks: () => Promise<{ status: number; body: unknown }>;
}

/** Every reason this deploy must not proceed. Empty means go. */
export async function deployGuardFailures(input: GuardInput): Promise<string[]> {
  let committed: PublicSigningKey[];
  try {
    committed = committedSigningKeys(input.config, input.target);
  } catch (error) {
    return [reason(error)];
  }
  if (input.target !== "production") return [];
  if (committed.length === 0) {
    return [`${GATEWAY_CONFIG}: production SIGNING_PUBLIC_KEYS is empty, so the gateway would accept nothing`];
  }
  let response: { status: number; body: unknown };
  try {
    response = await input.fetchJwks();
  } catch (error) {
    return [`${PRODUCTION_JWKS_URL} could not be fetched: ${reason(error)}`];
  }
  if (response.status !== 200) {
    return [`${PRODUCTION_JWKS_URL} answered ${response.status}; the app does not serve its signing keys there`];
  }
  let served: PublicSigningKey[];
  try {
    served = servedSigningKeys(response.body);
  } catch (error) {
    return [`${PRODUCTION_JWKS_URL}: ${reason(error)}`];
  }
  return committed
    .filter((key) => !served.some((candidate) => candidate.kid === key.kid && candidate.x === key.x && candidate.y === key.y))
    .map((key) => `committed key ${key.kid} is not served by ${PRODUCTION_JWKS_URL}`);
}

async function main(): Promise<void> {
  const target = process.argv[2];
  if (target !== "production" && target !== "preview") {
    console.error("usage: tsx scripts/cloudflare-deploy-guard.ts <production|preview>");
    process.exitCode = 2;
    return;
  }
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const config: unknown = JSON.parse(readFileSync(path.join(repositoryRoot, GATEWAY_CONFIG), "utf8"));
  const failures = await deployGuardFailures({
    target,
    config,
    fetchJwks: async () => {
      const response = await fetch(PRODUCTION_JWKS_URL, {
        cache: "no-store",
        redirect: "error",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      const text = await response.text();
      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      return { status: response.status, body };
    },
  });
  if (failures.length > 0) {
    console.error(`CLOUDFLARE DEPLOY GUARD FAILED (${target}, ${failures.length}):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(`cloudflare deploy guard passed for ${target}`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  void main();
}
