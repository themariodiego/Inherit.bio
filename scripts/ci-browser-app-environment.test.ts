import { describe, expect, it } from "vitest";
import { appServerEnvironment } from "./ci-browser-app-environment";
import { APP_ENV_NAMES, checkedAppEnvironment } from "./ci-browser-config";

describe("app server configuration for the fixed local variants", () => {
  // A synthetic job environment: every shared name carries a placeholder
  // derived from its own name, plus the exact values the validator pins.
  const job: Record<string, string> = Object.fromEntries(APP_ENV_NAMES.map(name => [name, `synthetic-${name.toLowerCase()}`]));
  job.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  job.RESEND_BASE_URL = "http://127.0.0.1:8124";
  // Values the job also carries for its own steps, which a variant must override rather than inherit.
  job.NEXT_PUBLIC_SITE_URL = "http://localhost:3100";
  job.NEXT_PUBLIC_APP_URL = "http://localhost:3100";
  job.INHERIT_TEST_JURISDICTION = "1";
  job.INHERIT_CANONICAL_UPLOADS_PAUSED = "true";
  it("is admitted by the container's validator for every fixed variant, with the variant fields fixed here", () => {
    for (const port of [3100, 3101, 3102] as const) {
      const env = appServerEnvironment(job, port);
      expect(checkedAppEnvironment(env, port)).toEqual(env);
      expect(env.NEXT_PUBLIC_APP_URL).toBe(`http://localhost:${port}`);
      expect(env.INHERIT_TEST_JURISDICTION).toBe(port === 3101 ? "" : "1");
      expect(env.INHERIT_CANONICAL_UPLOADS_PAUSED).toBe(port === 3102 ? "true" : "false");
      // Shared values pass through untouched from the job environment.
      expect(env.INHERIT_UPLOAD_SIGNING_JWK).toBe(job.INHERIT_UPLOAD_SIGNING_JWK);
    }
  });
  it("refuses to describe an app without its ephemeral signer or keys rather than inventing them", () => {
    for (const name of ["INHERIT_UPLOAD_SIGNING_JWK", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "JOBS_SECRET"]) {
      expect(() => appServerEnvironment({ ...job, [name]: "" }, 3100)).toThrow(name);
      expect(() => appServerEnvironment({ ...job, [name]: undefined }, 3100)).toThrow(name);
    }
  });
});
