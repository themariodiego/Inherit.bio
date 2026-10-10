import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { drainMailUntil, JOBS_SECRET } from "../../e2e/helpers";
import { APP_ENV_NAMES } from "../ci-browser-config";
import { freshT6AppEnvironments } from "./fresh-t6-app-environment";

const queue = vi.hoisted(() => ({ due: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({
  from: () => ({ select: () => ({ eq: () => ({ lte: () => ({ gt: queue.due }) }) }) }),
}) }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
const parent = { ...Object.fromEntries(APP_ENV_NAMES.map(name => [name, `synthetic-${name.toLowerCase()}`])),
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", RESEND_BASE_URL: "http://127.0.0.1:8124" };
const response = (status: number) => ({ status: () => status,
  json: async () => ({ status: "complete", outcome: "completed" }) });

it("passes the selected current app secret at call time instead of the hosted or ambient value", async () => {
  vi.stubEnv("JOBS_SECRET", "unrelated-ambient-job-secret");
  const app = freshT6AppEnvironments(parent, "synthetic-signer")[3105];
  expect(app.JOBS_SECRET).not.toBe(JOBS_SECRET);
  let message: string | undefined;
  const post = vi.fn(async (_url: string, options: { headers: Record<string, string> }) => {
    const authorized = options.headers.authorization === `Bearer ${app.JOBS_SECRET}`;
    if (authorized) message = "public-synthetic-mail-control";
    return response(authorized ? 200 : 401);
  });
  await expect(drainMailUntil({ post }, () => message, "synthetic parent invitation", app.JOBS_SECRET))
    .resolves.toBe("public-synthetic-mail-control");
  expect(post).toHaveBeenCalledExactlyOnceWith("/api/jobs/mail", { headers: { authorization: `Bearer ${app.JOBS_SECRET}` } });
  expect(process.env.JOBS_SECRET).toBe("unrelated-ambient-job-secret");
  expect(queue.due).not.toHaveBeenCalled();
});
it("retains the original 200 assertion when a hosted credential targets the different native configuration", async () => {
  const post = vi.fn(async () => response(401));
  await expect(drainMailUntil({ post }, () => undefined, "synthetic parent invitation")).rejects.toThrow();
  expect(post).toHaveBeenCalledExactlyOnceWith("/api/jobs/mail", { headers: { authorization: `Bearer ${JOBS_SECRET}` } });
  expect(queue.due).not.toHaveBeenCalled();
});
it("retains the explicit fixed hosted configuration without inheriting an ambient secret", async () => {
  vi.stubEnv("JOBS_SECRET", "unrelated-ambient-job-secret");
  let message: string | undefined;
  const post = vi.fn(async (_url: string, options: { headers: Record<string, string> }) => {
    if (options.headers.authorization === "Bearer e2e-jobs-secret") message = "public-hosted-mail-control";
    return response(message ? 200 : 401);
  });
  await expect(drainMailUntil({ post }, () => message)).resolves.toBe("public-hosted-mail-control");
  expect(post).toHaveBeenCalledExactlyOnceWith("/api/jobs/mail", { headers: { authorization: "Bearer e2e-jobs-secret" } });
});
it("refuses an explicitly empty secret before any drain instead of substituting the hosted value", async () => {
  const post = vi.fn();
  await expect(drainMailUntil({ post }, () => undefined, "synthetic parent invitation", ""))
    .rejects.toThrow(/^Explicit mail-job secret required$/);
  expect(post).not.toHaveBeenCalled(); expect(queue.due).not.toHaveBeenCalled();
});
it("retains the forty-attempt bound and uses the same selected secret for every drain", async () => {
  queue.due.mockResolvedValue({ count: 1 });
  const post = vi.fn(async () => response(200));
  await expect(drainMailUntil({ post }, () => undefined, "synthetic parent invitation", "synthetic-current-job-secret"))
    .rejects.toThrow();
  expect(post).toHaveBeenCalledTimes(40); expect(queue.due).toHaveBeenCalledTimes(40);
  expect(post.mock.calls.every(call => JSON.stringify(call) === JSON.stringify(["/api/jobs/mail", {
    headers: { authorization: "Bearer synthetic-current-job-secret" },
  }]))).toBe(true);
});
it("binds the native seed and its invitation drain to the selected embryo app value", () => {
  const native = readFileSync(new URL("./fresh-t6-browser.ts", import.meta.url), "utf8");
  const seed = readFileSync(new URL("../../e2e/participant-c-journey.ts", import.meta.url), "utf8");
  expect(native).toContain("jobsSecret: appEnvironments[3105].JOBS_SECRET");
  expect(seed).toContain('"the parent invitation this journey requested", options.jobsSecret');
});
