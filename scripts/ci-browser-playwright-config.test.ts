import { afterEach, describe, expect, it, vi } from "vitest";
import { localBrowserTarget } from "./local-storage-browser-config";
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
describe("standard Playwright server readiness", () => {
  async function config(ci: boolean) {
    vi.resetModules();
    vi.stubEnv("CI", ci ? "true" : undefined);
    vi.stubEnv("INHERIT_CI_BROWSER_RUNTIME", ci ? "ready" : undefined);
    vi.stubEnv("INHERIT_LOCAL_E2E_PROJECT", undefined);
    vi.stubEnv("INHERIT_LOCAL_E2E_WORKDIR", undefined);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("INHERIT_LOCAL_BROWSER_STORAGE_PROXY", "http://127.0.0.1:45678");
    vi.stubEnv("INHERIT_UPLOAD_SIGNING_JWK", "EXAMPLE_SIGNER");
    return (await import("../playwright.config")).default;
  }
  it("requires actual sign-in HTTP readiness for every published container port", async () => {
    const value = await config(true);
    const servers = [value.webServer].flat();
    expect(servers).toHaveLength(4);
    for (const [index, server] of servers.entries()) {
      expect(server?.url).toBe(`http://localhost:${3100 + index}/auth/sign-in`);
      expect(server?.port).toBeUndefined();
      expect(server?.reuseExistingServer).toBe(false);
      expect(server?.command).toContain(`server.mts host ${3100 + index}`);
      // Readiness probes bypass Chromium's proxy; the browser must also be
      // allowed to reach every app that the launcher reports ready.
      expect(localBrowserTarget(server!.url!).href).toBe(server?.url);
    }
    expect(value.workers).toBe(1); expect(value.retries).toBe(0);
    expect(value.projects).toHaveLength(3); expect(value.use?.trace).toBe("off");
    // The local-model variant carries the fixed attestation and the others do not.
    const environments = servers.map(server => (server as { env?: Record<string, string> }).env ?? {});
    expect(environments[3].ALLOW_LOCAL_MODEL_ENDPOINTS).toBe("1");
    expect(environments[3].INHERIT_LOCAL_MODEL_ORIGINS).toBe(JSON.stringify(["http://127.0.0.1:8127"]));
    for (const env of environments.slice(0, 3)) expect(env.ALLOW_LOCAL_MODEL_ENDPOINTS).toBeUndefined();
    const local = value.projects?.find(project => project.name === "copilot-local");
    expect(local?.use?.baseURL).toBe("http://localhost:3103");
    expect(String(local?.testMatch)).toContain("copilot-redteam");
    expect(String(value.projects?.[0]?.testIgnore)).toContain("copilot-redteam");
    for (const project of value.projects ?? []) {
      const origin = project.use?.baseURL ?? value.use?.baseURL;
      const signIn = new URL("/auth/sign-in", origin).href;
      expect(localBrowserTarget(signIn).href).toBe(signIn);
    }
  });
  it("preserves local production-build and port readiness behavior", async () => {
    const value = await config(false);
    const servers = [value.webServer].flat();
    for (const [index, server] of servers.entries()) {
      expect(server?.port).toBe(3100 + index); expect(server?.url).toBeUndefined();
      expect(server?.reuseExistingServer).toBe(false);
    }
    expect(servers[0]?.command).toBe("corepack pnpm build && corepack pnpm start --port 3100 --keepAliveTimeout 65000");
  });
});
