import { describe, expect, it } from "vitest";
import { browserDiscoveryArguments, browserDiscoveryEnvironment } from "./browser-discovery-gate";

describe("complete local browser discovery preflight", () => {
  it("never inherits credentials, provider authority, debug hooks or optional case selectors", () => {
    const env = browserDiscoveryEnvironment({ PATH: "synthetic-path", HOME: "synthetic-home", TMPDIR: "synthetic-temp", NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid", SUPABASE_SERVICE_ROLE_KEY: "EXAMPLE_PRIVATE_VALUE",
      NODE_OPTIONS: "--import private-hook", GITHUB_ACTIONS: "true", GITHUB_SHA: "EXAMPLE_PRIVATE_VALUE",
      INHERIT_DENSITY_CAPTURE: "1", INHERIT_COMPREHENSION_RUN: "1", PWDEBUG: "1",
      INHERIT_CI_BROWSER_RUNTIME: "ready", INHERIT_UPLOAD_SIGNING_JWK: "EXAMPLE_PRIVATE_VALUE", VERCEL: "1" });
    expect(env.PATH).toBe("synthetic-path");
    expect(env.HOME).toBe("synthetic-home");
    expect(env.TMPDIR).toBe("synthetic-temp");
    expect(env.NODE_ENV).toBe("test");
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe("EXAMPLE_SYNTHETIC_DISCOVERY_SERVICE_KEY");
    expect(JSON.stringify(env)).not.toMatch(/EXAMPLE_PRIVATE_VALUE|private-hook|example.invalid/);
    for (const key of ["NODE_OPTIONS", "GITHUB_ACTIONS", "GITHUB_SHA", "INHERIT_DENSITY_CAPTURE", "INHERIT_COMPREHENSION_RUN",
      "PWDEBUG", "INHERIT_CI_BROWSER_RUNTIME", "INHERIT_UPLOAD_SIGNING_JWK", "VERCEL"]) expect(env).not.toHaveProperty(key);
  });
  it("fixes real listing, standard config and all six native partitions without execution or selectors", () => {
    const full = ["synthetic-cli", "test", "--config=playwright.config.ts", "--list", "--reporter=json"];
    expect(browserDiscoveryArguments("synthetic-cli", null)).toEqual(full);
    for (let index = 1; index <= 6; index++)
      expect(browserDiscoveryArguments("synthetic-cli", index)).toEqual([...full, `--shard=${index}/6`]);
    for (const index of [0, 7, 1.5, NaN]) expect(() => browserDiscoveryArguments("synthetic-cli", index)).toThrow();
  });
});
