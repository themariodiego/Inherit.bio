import { describe, expect, it, vi } from "vitest";

// `cloudflare:workers` exists only inside the Workers runtime. The base class
// here does what the real one does for this Worker: keep ctx and env.
vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(readonly ctx: unknown, readonly env: unknown) {}
  },
}));

import preparationWorkerHost, { PreparationWorker } from "./index.mjs";

const CONTAINER_ENV_NAMES = [
  "INHERIT_PREPARED_R2_BUCKET",
  "INHERIT_PREPARED_R2_ORIGIN",
  "INHERIT_PREPARED_WGS_ENABLED",
  "INHERIT_UPLOAD_SIGNING_JWK",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

interface StartOptions { env: Record<string, string>; enableInternet: boolean }

// The module is plain JavaScript over a base class TypeScript cannot resolve
// here, so the constructor is typed the way the runtime calls it.
const Host = PreparationWorker as unknown as new (ctx: unknown, env: unknown) => { wake(): Promise<string>; alarm(): Promise<void> };

function host(running: boolean, monitor: () => Promise<void> = () => Promise.resolve()) {
  const start = vi.fn<(options: StartOptions) => void>();
  const container = { running, start, monitor: vi.fn(monitor) };
  const setAlarm = vi.fn<(at: number) => Promise<void>>(() => Promise.resolve());
  // The Worker's own env carries more than the container may see: an
  // unrelated binding and a var must both stay behind.
  const env = {
    INHERIT_PREPARED_WGS_ENABLED: "true",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "example-service-role",
    INHERIT_PREPARED_R2_ORIGIN: "https://example.workers.dev",
    INHERIT_PREPARED_R2_BUCKET: "inherit-prepared-example",
    INHERIT_UPLOAD_SIGNING_JWK: "example-private-jwk",
    PREPARATION_WORKER: { idFromName: vi.fn(), get: vi.fn() },
    UNRELATED_VAR: "must-not-be-forwarded",
  };
  const object = new Host({ container, storage: { setAlarm } }, env) as { wake(): Promise<string>; alarm(): Promise<void> };
  return { object, start, container, env, setAlarm };
}

describe("PreparationWorker.wake", () => {
  it("leaves a running container alone", async () => {
    const { object, start, container } = host(true);
    await expect(object.wake()).resolves.toBe("running");
    expect(start).not.toHaveBeenCalled();
    expect(container.monitor).not.toHaveBeenCalled();
  });

  it("starts a stopped container with exactly the six worker variables and internet access", async () => {
    const { object, start, container, env } = host(false);
    await expect(object.wake()).resolves.toBe("started");
    expect(start).toHaveBeenCalledTimes(1);
    const options = start.mock.calls[0][0];
    expect(options.enableInternet).toBe(true);
    expect(Object.keys(options.env).sort()).toEqual(CONTAINER_ENV_NAMES);
    for (const name of CONTAINER_ENV_NAMES) {
      expect(options.env[name]).toBe(env[name as keyof typeof env]);
    }
    expect(container.monitor).toHaveBeenCalledTimes(1);
  });

  it("forwards a missing variable as an empty string rather than dropping the key", async () => {
    const { object, start, env } = host(false);
    delete (env as Partial<typeof env>).INHERIT_PREPARED_R2_ORIGIN;
    await object.wake();
    const options = start.mock.calls[0][0];
    expect(Object.keys(options.env).sort()).toEqual(CONTAINER_ENV_NAMES);
    expect(options.env.INHERIT_PREPARED_R2_ORIGIN).toBe("");
  });

  /**
   * Measured on the preview stack on 20 September 2026: the object returned as
   * soon as the container had started, was evicted while idle, and took the
   * container with it about ninety seconds in, so every preparation longer
   * than that died mid-run and its job sat claimed until its deadline. The
   * wake now stays open for the whole run and keeps the object resident.
   */
  it("stays open until the container exits and keeps the object resident while it runs", async () => {
    let finish = () => {};
    const { object, setAlarm, container } = host(false, () => new Promise<void>(resolve => { finish = resolve; }));
    let settled = false;
    const wake = object.wake().then(value => { settled = true; return value; });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(settled, "the wake must not resolve while the container is still running").toBe(false);
    expect(setAlarm).toHaveBeenCalledTimes(1);
    container.running = true;
    await object.alarm();
    expect(setAlarm, "an alarm while the container runs re-arms the next one").toHaveBeenCalledTimes(2);
    container.running = false;
    await object.alarm();
    expect(setAlarm, "a stopped container stops the re-arming").toHaveBeenCalledTimes(2);
    finish();
    await expect(wake).resolves.toBe("started");
  });

  it("does not let a failed run reject the wake or escape as an unhandled rejection", async () => {
    const { object } = host(false, () => Promise.reject(new Error("exit 1")));
    await expect(object.wake()).resolves.toBe("started");
    // Let the rejected monitor promise settle under the attached handler.
    await new Promise(resolve => setTimeout(resolve, 0));
  });
});

describe("the scheduled handler", () => {
  it("wakes the one named object and keeps the invocation open until it answers", async () => {
    const wake = vi.fn(() => Promise.resolve("started"));
    const id = { name: "preparation-worker" };
    const namespace = { idFromName: vi.fn(() => id), get: vi.fn(() => ({ wake })) };
    const waited: Promise<unknown>[] = [];
    const ctx = { waitUntil: (promise: Promise<unknown>) => { waited.push(promise); } };
    await preparationWorkerHost.scheduled({}, { PREPARATION_WORKER: namespace }, ctx);
    expect(namespace.idFromName).toHaveBeenCalledWith("preparation-worker");
    expect(namespace.get).toHaveBeenCalledWith(id);
    expect(wake).toHaveBeenCalledTimes(1);
    expect(waited).toHaveLength(1);
    await expect(waited[0]).resolves.toBe("started");
  });
});

describe("the fetch handler", () => {
  it("answers every request with an empty 404", async () => {
    const response = await preparationWorkerHost.fetch();
    expect(response.status).toBe(404);
    expect(response.body).toBeNull();
  });
});
