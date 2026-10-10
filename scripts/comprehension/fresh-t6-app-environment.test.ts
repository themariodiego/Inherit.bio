import { describe, expect, it } from "vitest";
import { APP_ENV_NAMES, checkedAppEnvironment, checkedCiLauncherEnvironment, EMBRYO_APP_ENV } from "../ci-browser-config";
import { appServerEnvironment } from "../ci-browser-app-environment";
import { freshT6AppEnvironments } from "./fresh-t6-app-environment";

const parent = {
  ...Object.fromEntries(APP_ENV_NAMES.map(name => [name, `synthetic-${name.toLowerCase()}`])),
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  RESEND_BASE_URL: "http://127.0.0.1:8124",
};
const hosted = { CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted",
  INHERIT_DISPOSABLE_LOCAL_E2E: "true", INHERIT_CI_BROWSER_RUNTIME: "ready" };

describe("fresh T6 app bootstrap (configuration only)", () => {
  it("fixes the missing verifier refusal through the actual strict launcher contract", () => {
    const previous = { ...appServerEnvironment(parent, 3105), ...EMBRYO_APP_ENV };
    expect(() => checkedAppEnvironment(previous, 3105)).toThrow("Incomplete app configuration");
    const apps = freshT6AppEnvironments(parent, "synthetic-persona-signer");
    for (const port of [3100, 3105] as const) {
      expect(() => checkedCiLauncherEnvironment({ ...hosted, ...apps[port] }, port, "linux")).not.toThrow();
      expect(apps[port].INHERIT_UPLOAD_SIGNING_JWK).toBe("synthetic-persona-signer");
      expect(apps[port].NEXT_PUBLIC_APP_URL).toBe(`http://localhost:${port}`);
      expect(apps[port].INHERIT_TEST_JURISDICTION).toBe("1");
    }
  });
  it("creates a distinct ephemeral verifier per persona only on the embryo variant", () => {
    const first = freshT6AppEnvironments(parent, "synthetic-first-signer");
    const second = freshT6AppEnvironments(parent, "synthetic-second-signer");
    expect(/^whsec_[A-Za-z0-9+/]{43}=$/.test(first[3105].RESEND_WEBHOOK_SECRET)).toBe(true);
    expect(Buffer.from(first[3105].RESEND_WEBHOOK_SECRET.slice(6), "base64").length).toBe(32);
    expect(first[3105].RESEND_WEBHOOK_SECRET === second[3105].RESEND_WEBHOOK_SECRET).toBe(false);
    expect(Object.hasOwn(first[3100], "RESEND_WEBHOOK_SECRET")).toBe(false);
    expect(Object.hasOwn(first[3100], "INHERIT_EMBRYO_R2_ORIGIN")).toBe(false);
  });
  it("does not inherit an ambient verifier or inference credential", () => {
    const apps = freshT6AppEnvironments({ ...parent, RESEND_WEBHOOK_SECRET: "untrusted-ambient-verifier",
      INHERIT_CI_SYNTHETIC_WEBHOOK_SECRET: "untrusted-ambient-verifier",
      COMPREHENSION_MODEL_API_KEY: "EXAMPLE_NO_REAL_CREDENTIAL" }, "synthetic-persona-signer");
    expect(apps[3105].RESEND_WEBHOOK_SECRET === "untrusted-ambient-verifier").toBe(false);
    for (const port of [3100, 3105] as const) {
      expect(Object.hasOwn(apps[port], "COMPREHENSION_MODEL_API_KEY")).toBe(false);
      expect(Object.hasOwn(apps[port], "INHERIT_CI_SYNTHETIC_WEBHOOK_SECRET")).toBe(false);
    }
  });
  it("retains refusal of missing signer, shared keys and an external mail destination", () => {
    expect(() => freshT6AppEnvironments(parent, "")).toThrow("INHERIT_UPLOAD_SIGNING_JWK");
    expect(() => freshT6AppEnvironments({ ...parent, SUPABASE_SERVICE_ROLE_KEY: "" }, "synthetic-signer")).toThrow("SUPABASE_SERVICE_ROLE_KEY");
    expect(() => freshT6AppEnvironments({ ...parent, RESEND_BASE_URL: "https://api.resend.com" }, "synthetic-signer")).toThrow("App scope");
  });
});
