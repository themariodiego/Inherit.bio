import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createEmbryoFixtureSigner } from "./ci-browser/embryo-fragment-fixture";
import { EMBRYO_GATEWAY_CONFIG, embryoPreviewSourceFailures, expectedEmbryoGatewayConfig } from "./embryo-preview-source-guard";

// Only generated synthetic signing material; no hosted capability or provider call.
function fixture() {
  const signer = createEmbryoFixtureSigner();
  const keys = [signer.publicJwk];
  const config = expectedEmbryoGatewayConfig(JSON.stringify(keys));
  return { signer, keys, config, jwks: { keys } };
}

describe("preview-only embryo gateway source", () => {
  it("connects the real strict JSON to the exact preview scope and public identities", () => {
    const config = JSON.parse(readFileSync(new URL(`../${EMBRYO_GATEWAY_CONFIG}`, import.meta.url), "utf8"));
    const keys = JSON.parse(config.env.preview.vars.SIGNING_PUBLIC_KEYS);
    expect(embryoPreviewSourceFailures({ target: "preview", config, jwks: { keys } })).toEqual([]);
    // This validates committed source only; the independent authenticated fetch is separate evidence.
    expect(config.vars).toEqual({ BUCKET_NAME: "", TOKEN_ISSUER: "", SIGNING_PUBLIC_KEYS: "[]" });
    expect(config.r2_buckets).toEqual([]);
    expect(config.workers_dev).toBe(false);
    expect(config.routes).toEqual([]);
  });

  it("refuses production, defaults and unknown targets without inspecting their input", () => {
    for (const target of ["production", "", "Preview", "preview ", "other"]) {
      expect(embryoPreviewSourceFailures({ target, config: null, jwks: null })).toEqual([
        "Only the preview TEST-LOCAL source may be qualified; production remains held",
      ]);
    }
  });

  it("rejects wrong accounts, mixed scopes, unsafe default admission and extra services", () => {
    const f = fixture(), c = f.config, p = c.env.preview;
    const mutations = [
      { ...c, account_id: "0".repeat(32) },
      { ...c, name: "inherit-prepared-artifacts" },
      { ...c, workers_dev: true },
      { ...c, routes: ["https://outside.example/*"] },
      { ...c, observability: { enabled: true } },
      { ...c, vars: { ...c.vars, SIGNING_PUBLIC_KEYS: JSON.stringify(f.keys) } },
      { ...c, vars: { ...c.vars, BUCKET_NAME: "inherit-embryo-production" } },
      { ...c, r2_buckets: [{ binding: "FRAGMENTS", bucket_name: "inherit-embryo-production" }] },
      { ...c, env: { ...c.env, production: p } },
      { ...c, env: { preview: { ...p, name: "inherit-embryo-fragments" } } },
      { ...c, env: { preview: { ...p, preview_urls: true } } },
      { ...c, env: { preview: { ...p, routes: ["https://outside.example/*"] } } },
      { ...c, env: { preview: { ...p, vars: { ...p.vars, BUCKET_NAME: "inherit-prepared-preview" } } } },
      { ...c, env: { preview: { ...p, vars: { ...p.vars, TOKEN_ISSUER: "https://wrong.example/auth/v1" } } } },
      { ...c, env: { preview: { ...p, vars: { ...p.vars, SUPABASE_SERVICE_ROLE_KEY: "YOUR-SERVICE-ROLE-KEY" } } } },
      { ...c, env: { preview: { ...p, r2_buckets: [{ binding: "FRAGMENTS", bucket_name: "inherit-prepared-preview" }] } } },
      { ...c, env: { preview: { ...p, r2_buckets: [{ binding: "ARTIFACTS", bucket_name: "inherit-embryo-preview" }] } } },
      { ...c, env: { preview: { ...p, r2_buckets: [...p.r2_buckets, ...p.r2_buckets] } } },
      { ...c, services: [{ binding: "UNREVIEWED", service: "other" }] },
      { ...c, triggers: { crons: ["* * * * *"] } },
    ];
    for (const config of mutations) {
      expect(embryoPreviewSourceFailures({ target: "preview", config, jwks: f.jwks })).toEqual([
        "Preview configuration must have the exact closed account, issuer, bucket, routes and production-empty shape",
      ]);
    }
  });

  it("refuses empty, private, unknown, duplicate and malformed public key lists", () => {
    const f = fixture(), key = f.keys[0];
    const refused = [[], [f.signer.privateJwk], [{ ...key, secret: "synthetic" }], [key, key],
      [{ ...key, alg: "HS256" }], [{ ...key, use: "enc" }], [{ ...key, kid: "not-a-version-4-uuid" }],
      [{ ...key, crv: "P-384" }], [{ ...key, x: "short" }], [{ ...key, x: "a".repeat(43), y: "b".repeat(43) }]];
    for (const keys of refused) {
      const config = expectedEmbryoGatewayConfig(JSON.stringify(keys));
      expect(embryoPreviewSourceFailures({ target: "preview", config, jwks: f.jwks })).toHaveLength(1);
      expect(embryoPreviewSourceFailures({ target: "preview", config: f.config, jwks: { keys } })).toHaveLength(1);
    }
    for (const value of ["[", "null", "{}", "[]"]) {
      expect(embryoPreviewSourceFailures({ target: "preview", config: expectedEmbryoGatewayConfig(value), jwks: f.jwks })).toHaveLength(1);
    }
  });

  it("requires the complete same identity set, including coordinates, on both sides", () => {
    const f = fixture(), other = createEmbryoFixtureSigner().publicJwk;
    for (const keys of [[other], [f.keys[0], other], [{ ...other, kid: f.keys[0].kid }]]) {
      expect(embryoPreviewSourceFailures({ target: "preview", config: f.config, jwks: { keys } })).toEqual([
        "Preview public signing identities must exactly match the independently obtained current app JWKS",
      ]);
    }
    const config = expectedEmbryoGatewayConfig(JSON.stringify([...f.keys, other]));
    expect(embryoPreviewSourceFailures({ target: "preview", config, jwks: { keys: [other, ...f.keys] } })).toEqual([]);
  });

  it("refuses disconnected served shapes and unknown JWKS metadata", () => {
    const f = fixture();
    for (const jwks of [null, f.keys, { jwks: f.keys }, { keys: f.keys, source: "traffic" }, { keys: [] }]) {
      expect(embryoPreviewSourceFailures({ target: "preview", config: f.config, jwks })).toEqual([
        "Both signing lists must be nonempty unique public P-256 keys, with no private or unknown fields",
      ]);
    }
  });

  it("keeps both inputs unchanged while validating the original preview scope", () => {
    const f = fixture(), before = JSON.stringify({ config: f.config, jwks: f.jwks });
    expect(embryoPreviewSourceFailures({ target: "preview", config: f.config, jwks: f.jwks })).toEqual([]);
    expect(JSON.stringify({ config: f.config, jwks: f.jwks })).toBe(before);
  });
});
