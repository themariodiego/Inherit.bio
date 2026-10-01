/** GitHub-signed job proof, separate from environment strings. Token and
 * request bearer stay in host memory; neither enters a receipt or child. */
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import type { JsonWebKey } from "node:crypto";
import { z } from "zod";
const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "inherit-fresh-t6-v1";
const REPOSITORY = "themariodiego/Inherit.bio";
const WORKFLOW = `${REPOSITORY}/.github/workflows/participant-c-smoke.yml`;
const claimsSchema = z.object({ iss: z.literal(ISSUER), aud: z.literal(AUDIENCE),
  repository: z.literal(REPOSITORY), event_name: z.literal("workflow_dispatch"), runner_environment: z.literal("github-hosted"),
  workflow_ref: z.string(), workflow_sha: z.string().regex(/^[a-f0-9]{40}$/), sha: z.string().regex(/^[a-f0-9]{40}$/),
  ref: z.string().regex(/^refs\/heads\/.+/), run_id: z.string().regex(/^[1-9][0-9]*$/), run_attempt: z.string().regex(/^[1-9][0-9]*$/),
  exp: z.number().int(), nbf: z.number().int(), iat: z.number().int(), jti: z.string().min(1) });
export type WorkflowIdentity = { head: string; ref: string; runId: string; attempt: string };
export function verifyWorkflowAttestation(token: string, jwks: unknown, expected: WorkflowIdentity, now = Math.floor(Date.now() / 1000)) {
  assert(typeof token === "string" && token.length < 32_768, "Bounded workflow proof required");
  const parts = token.split(".");
  assert(parts.length === 3 && parts.every(part => /^[A-Za-z0-9_-]+$/.test(part)), "Invalid workflow proof");
  const header = z.object({ alg: z.literal("RS256"), typ: z.literal("JWT"), kid: z.string().min(1) }).strict()
    .parse(JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")));
  const keys = z.object({ keys: z.array(z.object({ kty: z.literal("RSA"), kid: z.string(), use: z.literal("sig"),
    alg: z.literal("RS256"), n: z.string(), e: z.string() }).passthrough()).min(1).max(20) }).parse(jwks).keys;
  const matching = keys.filter(key => key.kid === header.kid);
  assert(matching.length === 1, "Exact workflow signing key required");
  const key = matching[0];
  assert(verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`),
    createPublicKey({ key: { kty: key.kty, n: key.n, e: key.e } as JsonWebKey, format: "jwk" }), Buffer.from(parts[2], "base64url")),
  "Workflow signature refused");
  const claims = claimsSchema.parse(JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")));
  assert(claims.nbf <= now && claims.iat <= now && now < claims.exp && claims.exp - claims.iat <= 900, "Workflow proof expired or premature");
  assert(claims.sha === expected.head && claims.workflow_sha === expected.head && claims.ref === expected.ref
    && claims.workflow_ref === `${WORKFLOW}@${expected.ref}` && claims.run_id === expected.runId && claims.run_attempt === expected.attempt,
  "Workflow source or run identity differs");
  return { head: claims.sha, ref: claims.ref, runId: claims.run_id, attempt: claims.run_attempt };
}
async function boundedJson(url: URL, headers: Record<string, string> = {}) {
  const response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(10_000) });
  assert(response.ok, "Workflow issuer request refused");
  const reader = response.body!.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length;
      assert(size <= 1_048_576, "Workflow proof response too large"); chunks.push(next.value); }
  } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function attestFreshT6Workflow(expected: WorkflowIdentity) {
  try {
    const endpoint = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL!);
    assert(endpoint.protocol === "https:" && endpoint.hostname.endsWith(".actions.githubusercontent.com")
      && !endpoint.username && !endpoint.password && !endpoint.hash, "GitHub token request origin required");
    assert(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, "Actual workflow issuer credential required");
    endpoint.searchParams.set("audience", AUDIENCE);
    const issued = await boundedJson(endpoint, { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` });
    const keys = await boundedJson(new URL(`${ISSUER}/.well-known/jwks`));
    return verifyWorkflowAttestation(issued.value, keys, expected);
  } catch { throw new Error("Actual signed fresh-T6 workflow attestation unavailable; no runtime may be created"); }
}
