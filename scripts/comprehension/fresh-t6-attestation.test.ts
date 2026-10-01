import { generateKeyPairSync, sign } from "node:crypto";
import { expect, it } from "vitest";
import { verifyWorkflowAttestation } from "./fresh-t6-attestation";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwks = { keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid: "unit-key", use: "sig", alg: "RS256" }] };
const expected = { head: "a".repeat(40), ref: "refs/heads/unit", runId: "10", attempt: "1" };
const claims = { iss: "https://token.actions.githubusercontent.com", aud: "inherit-fresh-t6-v1", repository: "themariodiego/Inherit.bio",
  event_name: "workflow_dispatch", runner_environment: "github-hosted", workflow_ref: `themariodiego/Inherit.bio/.github/workflows/participant-c-smoke.yml@${expected.ref}`,
  workflow_sha: expected.head, sha: expected.head, ref: expected.ref, run_id: expected.runId, run_attempt: expected.attempt,
  iat: 900, nbf: 900, exp: 1200, jti: "unit-proof" };
const token = (value = claims, header = { alg: "RS256", typ: "JWT", kid: "unit-key" }) => {
  const input = [header, value].map(item => Buffer.from(JSON.stringify(item)).toString("base64url")).join(".");
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), pair.privateKey).toString("base64url")}`;
};
it("validates the exact signed workflow/source/run (authored key only; no genuine job claim)", () => {
  expect(verifyWorkflowAttestation(token(), jwks, expected, 1000)).toEqual(expected);
});
it.each([{ aud: "wrong" }, { repository: "fork/repo" }, { event_name: "pull_request" }, { runner_environment: "self-hosted" },
  { workflow_ref: "themariodiego/Inherit.bio/.github/workflows/ci.yml@refs/heads/unit" }, { workflow_sha: "b".repeat(40) },
  { sha: "b".repeat(40) }, { ref: "refs/heads/main" }, { run_id: "11" }, { run_attempt: "2" },
  { exp: 1000 }, { nbf: 1001 }, { iat: 1001 }, { exp: 1901 }])("refuses wrong or stale signed claims %j", patch => {
  expect(() => verifyWorkflowAttestation(token({ ...claims, ...patch }), jwks, expected, 1000)).toThrow();
});
it("refuses altered payload, unknown key, unsigned or confused algorithm despite valid environment-like claims", () => {
  const parts = token().split("."); parts[1] = Buffer.from(JSON.stringify({ ...claims, run_id: "11" })).toString("base64url");
  expect(() => verifyWorkflowAttestation(parts.join("."), jwks, expected, 1000)).toThrow("signature");
  expect(() => verifyWorkflowAttestation(token(claims, { alg: "none", typ: "JWT", kid: "unit-key" }), jwks, expected, 1000)).toThrow();
  expect(() => verifyWorkflowAttestation(token(), { keys: [{ ...jwks.keys[0], kid: "other" }] }, expected, 1000)).toThrow("signing key");
  expect(() => verifyWorkflowAttestation(token(), { keys: [jwks.keys[0], jwks.keys[0]] }, expected, 1000)).toThrow("signing key");
});
